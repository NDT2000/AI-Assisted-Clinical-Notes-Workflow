import type { SoapContent } from "../../../domain/noteAttributes";
import type { SaveNoteVersionRequestBody, SaveNoteVersionResponse, } from "../../../domain/noteSave";

export type AutosaveStatus =
  | "idle"
  | "changes-pending"
  | "saving"
  | "queued"
  | "save-failed"
  | "conflict";

export type AutosaveFailureKind =
  | "save-failed"
  | "conflict";

export interface AutosaveSnapshot {
  status: AutosaveStatus;
  hasPendingChanges: boolean;
  error: unknown | null;
}

export interface AutosaveSuccess {
  response: SaveNoteVersionResponse;
  savedContent: SoapContent;
}

export type AutosaveSaveResult =
  | {
      kind: "saved";
      response: SaveNoteVersionResponse;
    }
  | {
      kind: "queued";
    };

type AutosaveSaveOperationResult =
  | SaveNoteVersionResponse
  | AutosaveSaveResult;

export interface UnsavedAutosaveDraft {
  request: SaveNoteVersionRequestBody;
  failureKind: AutosaveFailureKind;
  error: unknown;
}

export interface AutosaveCoordinatorOptions {
  initialBaseVersionId: string;
  initialContent: SoapContent;

  save: (
    request: SaveNoteVersionRequestBody,
  ) => Promise<AutosaveSaveOperationResult>;

  debounceMs?: number;

  createClientMutationId?: () => string;

  classifyError?: (
    error: unknown,
  ) => AutosaveFailureKind;

  onStateChange?: (
    snapshot: AutosaveSnapshot,
  ) => void;

  onSaveSuccess?: (
    result: AutosaveSuccess,
  ) => void;

  /*
   * Called after detach() for a draft that could not be saved
   * (failed or conflicted), so it can be kept somewhere durable
   * instead of being lost with the editor.
   */
  onUnsavedAfterDetach?: (
    draft: UnsavedAutosaveDraft,
  ) => void;
}

interface SaveAttempt {
  request: SaveNoteVersionRequestBody;
  error?: unknown;
}

const DEFAULT_DEBOUNCE_MS = 500;

let fallbackMutationCounter = 0;

function cloneContent(
  content: SoapContent,
): SoapContent {
  return {
    subjective: content.subjective,
    objective: content.objective,
    assessment: content.assessment,
    plan: content.plan,
  };
}

function hasSameContent(
  first: SoapContent,
  second: SoapContent,
): boolean {
  return (
    first.subjective === second.subjective &&
    first.objective === second.objective &&
    first.assessment === second.assessment &&
    first.plan === second.plan
  );
}

function createDefaultMutationId(): string {
  if (
    typeof globalThis.crypto?.randomUUID ===
    "function"
  ) {
    return globalThis.crypto.randomUUID();
  }

  fallbackMutationCounter += 1;

  return [
    "note-save",
    Date.now(),
    fallbackMutationCounter,
  ].join("-");
}

function normalizeSaveResult(
  result: AutosaveSaveOperationResult,
): AutosaveSaveResult {
  if ("kind" in result) {
    return result;
  }

  return {
    kind: "saved",
    response: result,
  };
}

export class AutosaveCoordinator {
  private readonly save: AutosaveCoordinatorOptions["save"];

  private readonly debounceMs: number;

  private readonly createClientMutationId: () => string;

  private readonly classifyError: (
    error: unknown,
  ) => AutosaveFailureKind;

  private readonly onStateChange:
    | AutosaveCoordinatorOptions["onStateChange"]
    | undefined;

  private readonly onSaveSuccess:
    | AutosaveCoordinatorOptions["onSaveSuccess"]
    | undefined;

  private readonly onUnsavedAfterDetach:
    | AutosaveCoordinatorOptions["onUnsavedAfterDetach"]
    | undefined;

  private baseVersionId: string;

  private lastSavedContent: SoapContent;

  private queuedContent: SoapContent | null =
    null;

  private inFlightAttempt: SaveAttempt | null =
    null;

  private failedAttempt: SaveAttempt | null =
    null;

  private conflictAttempt: SaveAttempt | null =
    null;

  private debounceTimer:
    | ReturnType<typeof setTimeout>
    | null = null;

  private status: AutosaveStatus = "idle";

  private error: unknown | null = null;

  private hasDurableQueuedSave = false;

  private disposed = false;

  private detached = false;

  constructor(
    options: AutosaveCoordinatorOptions,
  ) {
    this.baseVersionId =
      options.initialBaseVersionId;

    this.lastSavedContent = cloneContent(
      options.initialContent,
    );

    this.save = options.save;

    this.debounceMs =
      options.debounceMs ??
      DEFAULT_DEBOUNCE_MS;

    this.createClientMutationId =
      options.createClientMutationId ??
      createDefaultMutationId;

    this.classifyError =
      options.classifyError ??
      (() => "save-failed");

    this.onStateChange =
      options.onStateChange;

    this.onSaveSuccess =
      options.onSaveSuccess;

    this.onUnsavedAfterDetach =
      options.onUnsavedAfterDetach;
  }

  updateDraft(content: SoapContent): void {
    if (this.disposed || this.detached) {
      return;
    }

    const nextContent =
      cloneContent(content);

    if (
      !this.inFlightAttempt &&
      !this.failedAttempt &&
      !this.conflictAttempt &&
      hasSameContent(
        nextContent,
        this.lastSavedContent,
      )
    ) {
      this.clearDebounceTimer();
      this.queuedContent = null;
      this.error = null;

      this.setStatus(
        this.hasDurableQueuedSave
          ? "queued"
          : "idle",
      );

      return;
    }

    if (this.inFlightAttempt) {
      this.queuedContent = hasSameContent(
        nextContent,
        this.inFlightAttempt.request.content,
      )
        ? null
        : nextContent;

      this.emitState();
      return;
    }

    if (this.failedAttempt) {
      this.queuedContent = hasSameContent(
        nextContent,
        this.failedAttempt.request.content,
      )
        ? null
        : nextContent;

      this.emitState();
      return;
    }

    if (this.conflictAttempt) {
      this.queuedContent = hasSameContent(
        nextContent,
        this.conflictAttempt.request.content,
      )
        ? null
        : nextContent;

      this.emitState();
      return;
    }

    this.queuedContent = nextContent;
    this.scheduleDebouncedSave();
  }

  retry(): void {
    if (
      this.disposed ||
      this.detached ||
      this.inFlightAttempt ||
      !this.failedAttempt
    ) {
      return;
    }

    const attempt = this.failedAttempt;

    this.failedAttempt = null;
    this.executeAttempt(attempt);
  }

  resolveConflict(
    resolvedContent: SoapContent,
    serverBaseVersionId: string,
  ): void {
    if (
      this.disposed ||
      this.detached ||
      this.inFlightAttempt ||
      !this.conflictAttempt
    ) {
      return;
    }

    this.clearDebounceTimer();

    this.conflictAttempt = null;
    this.failedAttempt = null;
    this.queuedContent = null;

    this.baseVersionId =
      serverBaseVersionId;

    const attempt: SaveAttempt = {
      request: {
        baseVersionId:
          serverBaseVersionId,

        clientMutationId:
          this.createClientMutationId(),

        content: cloneContent(
          resolvedContent,
        ),
      },
    };

    this.executeAttempt(attempt);
  }

  getSnapshot(): AutosaveSnapshot {
    return {
      status: this.status,
      hasPendingChanges:
        this.debounceTimer !== null ||
        this.queuedContent !== null ||
        this.inFlightAttempt !== null ||
        this.failedAttempt !== null ||
        this.conflictAttempt !== null ||
        this.hasDurableQueuedSave,
      error: this.error,
    };
  }

  /*
   * Starts a debounced save immediately, e.g. when the tab is
   * hidden and may be closed before the debounce fires.
   */
  flushNow(): void {
    if (
      this.disposed ||
      this.debounceTimer === null
    ) {
      return;
    }

    this.clearDebounceTimer();
    this.startQueuedSave();
  }

  /*
   * Releases the coordinator from its editor without losing work:
   * pending edits are saved now, an in-flight save is allowed to
   * finish (including its trailing save), and a failed or
   * conflicted draft is handed to onUnsavedAfterDetach.
   * No state or success callbacks fire after this call.
   */
  detach(): void {
    if (this.disposed || this.detached) {
      return;
    }

    this.detached = true;
    this.clearDebounceTimer();
    this.continueDetached();
  }

  dispose(): void {
    this.disposed = true;
    this.clearDebounceTimer();
    this.queuedContent = null;
  }

  private continueDetached(): void {
    if (this.inFlightAttempt) {
      return;
    }

    const unsavedAttempt =
      this.conflictAttempt ??
      this.failedAttempt;

    if (unsavedAttempt) {
      const failureKind: AutosaveFailureKind =
        this.conflictAttempt
          ? "conflict"
          : "save-failed";

      const latestContent =
        this.queuedContent ??
        unsavedAttempt.request.content;

      const contentChanged =
        !hasSameContent(
          latestContent,
          unsavedAttempt.request.content,
        );

      this.conflictAttempt = null;
      this.failedAttempt = null;
      this.queuedContent = null;

      this.onUnsavedAfterDetach?.({
        request: {
          baseVersionId:
            unsavedAttempt.request
              .baseVersionId,

          clientMutationId: contentChanged
            ? this.createClientMutationId()
            : unsavedAttempt.request
                .clientMutationId,

          content:
            cloneContent(latestContent),
        },
        failureKind,
        error: unsavedAttempt.error ?? null,
      });

      return;
    }

    if (this.queuedContent) {
      this.startQueuedSave();
    }
  }

  private scheduleDebouncedSave(): void {
    this.clearDebounceTimer();

    this.error = null;
    this.setStatus("changes-pending");

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.startQueuedSave();
    }, this.debounceMs);
  }

  private startQueuedSave(): void {
    if (
      this.disposed ||
      this.inFlightAttempt ||
      this.failedAttempt ||
      this.conflictAttempt ||
      !this.queuedContent
    ) {
      return;
    }

    const content = this.queuedContent;

    this.queuedContent = null;

    if (
      hasSameContent(
        content,
        this.lastSavedContent,
      )
    ) {
      this.setStatus("idle");
      return;
    }

    const attempt: SaveAttempt = {
      request: {
        baseVersionId:
          this.baseVersionId,
        clientMutationId:
          this.createClientMutationId(),
        content: cloneContent(content),
      },
    };

    this.executeAttempt(attempt);
  }

  private executeAttempt(
    attempt: SaveAttempt,
  ): void {
    this.inFlightAttempt = attempt;
    this.error = null;
    this.setStatus("saving");

    void this.save(attempt.request)
      .then((operationResult) => {
        const result =
          normalizeSaveResult(
            operationResult,
          );

        if (result.kind === "queued") {
          this.handleSaveQueued(attempt);
          return;
        }

        this.handleSaveSuccess(
          attempt,
          result.response,
        );
      })
      .catch((error: unknown) => {
        this.handleSaveFailure(
          attempt,
          error,
        );
      });
  }

  private handleSaveQueued(
    attempt: SaveAttempt,
  ): void {
    if (
      this.disposed ||
      this.inFlightAttempt !== attempt
    ) {
      return;
    }

    this.inFlightAttempt = null;
    this.error = null;

    this.lastSavedContent = cloneContent(
      attempt.request.content,
    );

    this.hasDurableQueuedSave = true;

    if (
      this.queuedContent &&
      hasSameContent(
        this.queuedContent,
        this.lastSavedContent,
      )
    ) {
      this.queuedContent = null;
    }

    if (this.queuedContent) {
      this.startQueuedSave();
      return;
    }

    this.setStatus("queued");
  }

  private handleSaveSuccess(
    attempt: SaveAttempt,
    response: SaveNoteVersionResponse,
  ): void {
    if (
      this.disposed ||
      this.inFlightAttempt !== attempt
    ) {
      return;
    }

    this.inFlightAttempt = null;
    this.error = null;
    this.hasDurableQueuedSave = false;

    this.baseVersionId =
      response.savedVersion.versionId;

    this.lastSavedContent = cloneContent(
      attempt.request.content,
    );

    if (!this.detached) {
      this.onSaveSuccess?.({
        response,
        savedContent: cloneContent(
          attempt.request.content,
        ),
      });
    }

    if (
      this.queuedContent &&
      hasSameContent(
        this.queuedContent,
        this.lastSavedContent,
      )
    ) {
      this.queuedContent = null;
    }

    if (this.queuedContent) {
      this.startQueuedSave();
      return;
    }

    this.setStatus("idle");
  }

  private handleSaveFailure(
    attempt: SaveAttempt,
    error: unknown,
  ): void {
    if (
      this.disposed ||
      this.inFlightAttempt !== attempt
    ) {
      return;
    }

    this.inFlightAttempt = null;
    this.error = error;

    const failedAttempt: SaveAttempt = {
      ...attempt,
      error,
    };

    const failureKind =
      this.classifyError(error);

    if (failureKind === "conflict") {
      this.conflictAttempt = failedAttempt;
      this.setStatus("conflict");
    } else {
      this.failedAttempt = failedAttempt;
      this.setStatus("save-failed");
    }

    if (this.detached) {
      this.continueDetached();
    }
  }

  private clearDebounceTimer(): void {
    if (this.debounceTimer === null) {
      return;
    }

    clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
  }

  private setStatus(
    status: AutosaveStatus,
  ): void {
    this.status = status;
    this.emitState();
  }

  private emitState(): void {
    if (this.detached) {
      return;
    }

    this.onStateChange?.(
      this.getSnapshot(),
    );
  }
}