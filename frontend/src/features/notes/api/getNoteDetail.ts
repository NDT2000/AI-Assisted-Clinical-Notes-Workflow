import { apiFetch } from "../../../api/apiClient";
import type { NoteDetail, } from "../../../domain/noteDetail";

interface ErrorResponseBody {
  error?: string;
  message?: string;
}

export class NoteDetailRequestError
  extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor({
    status,
    code,
    message,
  }: {
    status: number;
    code?: string | null;
    message: string;
  }) {
    super(message);

    this.name =
      "NoteDetailRequestError";

    this.status = status;
    this.code = code ?? null;
  }
}

async function readErrorResponse(
  response: Response,
): Promise<ErrorResponseBody | null> {
  try {
    return (
      await response.json()
    ) as ErrorResponseBody;
  } catch {
    return null;
  }
}

/* Sent as the active demo identity. */
export async function getNoteDetail(
  noteId: string,
  signal?: AbortSignal,
): Promise<NoteDetail> {
  const response = await apiFetch(
    `/api/notes/${encodeURIComponent(
      noteId,
    )}`,
    { signal },
  );

  if (!response.ok) {
    const errorBody =
      await readErrorResponse(response);

    throw new NoteDetailRequestError({
      status: response.status,
      code: errorBody?.error,
      message:
        errorBody?.message ??
        "Unable to load note details.",
    });
  }

  return (
    await response.json()
  ) as NoteDetail;
}