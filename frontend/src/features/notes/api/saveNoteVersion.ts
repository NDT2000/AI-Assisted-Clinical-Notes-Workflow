import type {
  NoteVersionDetail,
} from "../../../domain/noteDetail";
import type {
  SaveNoteVersionActor,
  SaveNoteVersionErrorCode,
  SaveNoteVersionRequestBody,
  SaveNoteVersionResponse,
} from "../../../domain/noteSave";
import {
  track,
} from "../../../telemetry/telemetry";
import {
  mockRealtimeChannel,
} from "../realtime/mockRealtimeChannel";

interface SaveNoteVersionRequestErrorOptions {
  status: number;
  code: SaveNoteVersionErrorCode;
  message: string;
  currentVersion?: NoteVersionDetail;
  commonAncestor?:
    | NoteVersionDetail
    | null;
}

export class SaveNoteVersionRequestError
  extends Error {
  readonly status: number;

  readonly code: SaveNoteVersionErrorCode;

  readonly currentVersion:
    | NoteVersionDetail
    | undefined;

  readonly commonAncestor:
    | NoteVersionDetail
    | null
    | undefined;

  constructor(
    options:
      SaveNoteVersionRequestErrorOptions,
  ) {
    super(options.message);

    this.name =
      "SaveNoteVersionRequestError";
    this.status = options.status;
    this.code = options.code;
    this.currentVersion =
      options.currentVersion;
    this.commonAncestor =
      options.commonAncestor;

    Object.setPrototypeOf(
      this,
      new.target.prototype,
    );
  }
}

const SAVE_ERROR_CODES:
  readonly SaveNoteVersionErrorCode[] = [
    "invalid_request",
    "forbidden",
    "not_found",
    "version_conflict",
    "idempotency_conflict",
    "internal_error",
  ];

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isSaveErrorCode(
  value: unknown,
): value is SaveNoteVersionErrorCode {
  return (
    typeof value === "string" &&
    SAVE_ERROR_CODES.includes(
      value as SaveNoteVersionErrorCode,
    )
  );
}

function isSaveResponse(
  value: unknown,
): value is SaveNoteVersionResponse {
  return (
    isRecord(value) &&
    typeof value.clientMutationId ===
      "string" &&
    isRecord(value.note) &&
    isRecord(value.savedVersion)
  );
}

async function readResponseBody(
  response: Response,
): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function createRequestError(
  status: number,
  body: unknown,
): SaveNoteVersionRequestError {
  let code: SaveNoteVersionErrorCode =
    "internal_error";

  let message =
    `Unable to save the note. ` +
    `The server returned status ${status}.`;

  let currentVersion:
    | NoteVersionDetail
    | undefined;

  let commonAncestor:
    | NoteVersionDetail
    | null
    | undefined;

  if (isRecord(body)) {
    if (isSaveErrorCode(body.error)) {
      code = body.error;
    }

    if (
      typeof body.message === "string" &&
      body.message.trim().length > 0
    ) {
      message = body.message;
    }

    if (
      code === "version_conflict" &&
      isRecord(body.currentVersion)
    ) {
      currentVersion =
        body.currentVersion as unknown as
          NoteVersionDetail;

      if (body.commonAncestor === null) {
        commonAncestor = null;
      } else if (
        isRecord(body.commonAncestor)
      ) {
        commonAncestor =
          body.commonAncestor as unknown as
            NoteVersionDetail;
      }
    }
  }

  return new SaveNoteVersionRequestError({
    status,
    code,
    message,
    currentVersion,
    commonAncestor,
  });
}

export async function saveNoteVersion(
  noteId: string,
  actor: SaveNoteVersionActor,
  body: SaveNoteVersionRequestBody,
  signal?: AbortSignal,
): Promise<SaveNoteVersionResponse> {
  let response: Response;

  try {
    response = await fetch(
      `/api/notes/${encodeURIComponent(
        noteId,
      )}/versions`,
      {
        method: "POST",
        headers: {
          "content-type":
            "application/json",
          "x-actor-id": actor.id,
          "x-actor-role":
            actor.role,
          "x-actor-display-name":
            actor.displayName,
        },
        body:
          JSON.stringify(body),
        signal,
      },
    );
  } catch (error) {
    track(
      "note.version_save",
      {
        operation:
          "save_note_version",
        outcome:
          signal?.aborted === true
            ? "aborted"
            : "network_failure",
        errorCode:
          signal?.aborted === true
            ? "aborted"
            : "network_error",
        role: actor.role,
        source: "rest",
      },
    );

    throw error;
  }

  const responseBody =
    await readResponseBody(response);

  if (!response.ok) {
    const requestError =
      createRequestError(
        response.status,
        responseBody,
      );

    track(
      "note.version_save",
      {
        operation:
          "save_note_version",
        outcome: "failure",
        httpStatus:
          response.status,
        errorCode:
          requestError.code,
        role: actor.role,
        source: "rest",
      },
    );

    throw requestError;
  }

  if (!isSaveResponse(responseBody)) {
    track(
      "note.version_save",
      {
        operation:
          "save_note_version",
        outcome:
          "invalid_response",
        httpStatus:
          response.status,
        errorCode:
          "internal_error",
        role: actor.role,
        source: "rest",
      },
    );

    throw new SaveNoteVersionRequestError({
      status: response.status,
      code: "internal_error",
      message:
        "The server returned an invalid save response.",
    });
  }

  mockRealtimeChannel.publish({
    type:
      "note.version_added",
    noteId,
    response: responseBody,
  });

  track(
    "note.version_save",
    {
      operation:
        "save_note_version",
      outcome: "success",
      status:
        responseBody.note.status,
      revision:
        responseBody.savedVersion
          .revisionNumber,
      role: actor.role,
      source: "rest",
    },
  );

  await Promise.resolve();

  return responseBody;
}

export function classifySaveNoteVersionError(
  error: unknown,
): "conflict" | "save-failed" {
  if (
    error instanceof
      SaveNoteVersionRequestError &&
    error.code === "version_conflict"
  ) {
    return "conflict";
  }

  return "save-failed";
}
