import type {
  NoteVersionDetail,
} from "../../../domain/noteDetail";
import type {
  TransitionNoteActor,
  TransitionNoteErrorCode,
  TransitionNoteRequestBody,
  TransitionNoteResponse,
} from "../../../domain/noteTransition";
import {
  track,
} from "../../../telemetry/telemetry";
import {
  mockRealtimeChannel,
} from "../realtime/mockRealtimeChannel";

interface TransitionNoteRequestErrorOptions {
  status: number;
  code: TransitionNoteErrorCode;
  message: string;
  currentVersion?: NoteVersionDetail;
}

export class TransitionNoteRequestError
  extends Error {
  readonly status: number;

  readonly code:
    TransitionNoteErrorCode;

  readonly currentVersion:
    | NoteVersionDetail
    | undefined;

  constructor(
    options:
      TransitionNoteRequestErrorOptions,
  ) {
    super(options.message);

    this.name =
      "TransitionNoteRequestError";
    this.status = options.status;
    this.code = options.code;
    this.currentVersion =
      options.currentVersion;

    Object.setPrototypeOf(
      this,
      new.target.prototype,
    );
  }
}

const TRANSITION_ERROR_CODES:
  readonly TransitionNoteErrorCode[] = [
    "invalid_request",
    "forbidden",
    "not_found",
    "version_conflict",
    "idempotency_conflict",
    "transition_not_allowed",
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

function isTransitionErrorCode(
  value: unknown,
): value is TransitionNoteErrorCode {
  return (
    typeof value === "string" &&
    TRANSITION_ERROR_CODES.includes(
      value as TransitionNoteErrorCode,
    )
  );
}

function isTransitionResponse(
  value: unknown,
): value is TransitionNoteResponse {
  return (
    isRecord(value) &&
    typeof value.clientMutationId ===
      "string" &&
    value.clientMutationId.length > 0 &&
    isRecord(value.note) &&
    isRecord(value.timelineEvent) &&
    isRecord(value.currentVersion)
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
): TransitionNoteRequestError {
  let code:
    TransitionNoteErrorCode =
      "internal_error";

  let message =
    `Unable to update the note status. ` +
    `The server returned status ${status}.`;

  let currentVersion:
    | NoteVersionDetail
    | undefined;

  if (isRecord(body)) {
    if (
      isTransitionErrorCode(
        body.error,
      )
    ) {
      code = body.error;
    }

    if (
      typeof body.message ===
        "string" &&
      body.message.trim().length > 0
    ) {
      message = body.message;
    }

    if (
      code === "version_conflict" &&
      isRecord(
        body.currentVersion,
      )
    ) {
      currentVersion =
        body.currentVersion as unknown as
          NoteVersionDetail;
    }
  }

  return new TransitionNoteRequestError({
    status,
    code,
    message,
    currentVersion,
  });
}

export async function transitionNote(
  noteId: string,
  actor: TransitionNoteActor,
  body: TransitionNoteRequestBody,
  signal?: AbortSignal,
): Promise<TransitionNoteResponse> {
  let response: Response;

  try {
    response = await fetch(
      `/api/notes/${encodeURIComponent(
        noteId,
      )}/transitions`,
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
          "x-mfa-verified": String(
            actor.mfaVerified ===
              true,
          ),
        },
        body:
          JSON.stringify(body),
        signal,
      },
    );
  } catch (error) {
    track(
      "note.status_transition",
      {
        operation:
          "transition_note",
        outcome:
          signal?.aborted === true
            ? "aborted"
            : "network_failure",
        errorCode:
          signal?.aborted === true
            ? "aborted"
            : "network_error",
        trigger: body.trigger,
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
      "note.status_transition",
      {
        operation:
          "transition_note",
        outcome: "failure",
        httpStatus:
          response.status,
        errorCode:
          requestError.code,
        trigger: body.trigger,
        role: actor.role,
        source: "rest",
      },
    );

    throw requestError;
  }

  if (
    !isTransitionResponse(
      responseBody,
    )
  ) {
    track(
      "note.status_transition",
      {
        operation:
          "transition_note",
        outcome:
          "invalid_response",
        httpStatus:
          response.status,
        errorCode:
          "internal_error",
        trigger: body.trigger,
        role: actor.role,
        source: "rest",
      },
    );

    throw new TransitionNoteRequestError({
      status: response.status,
      code: "internal_error",
      message:
        "The server returned an invalid transition response.",
    });
  }

  mockRealtimeChannel.publish({
    type:
      "note.status_changed",
    noteId,
    trigger: body.trigger,
    response: responseBody,
  });

  track(
    "note.status_transition",
    {
      operation:
        "transition_note",
      outcome: "success",
      trigger: body.trigger,
      previousStatus:
        responseBody.timelineEvent
          .fromStatus,
      nextStatus:
        responseBody.timelineEvent
          .toStatus,
      revision:
        responseBody.currentVersion
          .revisionNumber,
      role: actor.role,
      source: "rest",
    },
  );

  await Promise.resolve();

  return responseBody;
}
