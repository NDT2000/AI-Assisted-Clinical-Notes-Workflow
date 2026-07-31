import type { SoapContent } from "../../../domain/noteAttributes";
import type { SaveNoteVersionRequestBody, SaveNoteVersionResponse, } from "../../../domain/noteSave";

export type AutosaveStatus =
  | "idle"
  | "changes-pending"
  | "saving"
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

export interface AutosaveCoordinatorOptions {
  initialBaseVersionId: string;
  initialContent: SoapContent;

  save: (
    request: SaveNoteVersionRequestBody,
  ) => Promise<SaveNoteVersionResponse>;

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
}

interface SaveAttempt {
  request: SaveNoteVersionRequestBody;
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

  private disposed = false;

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
  }

  updateDraft(content: SoapContent): void {
    if (this.disposed) {
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
      this.setStatus("idle");
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
      this.inFlightAttempt ||
      !this.failedAttempt
    ) {
      return;
    }

    const attempt = this.failedAttempt;

    this.failedAttempt = null;
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
        this.conflictAttempt !== null,
      error: this.error,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.clearDebounceTimer();
    this.queuedContent = null;
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
      .then((response) => {
        this.handleSaveSuccess(
          attempt,
          response,
        );
      })
      .catch((error: unknown) => {
        this.handleSaveFailure(
          attempt,
          error,
        );
      });
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

    this.baseVersionId =
      response.savedVersion.versionId;

    this.lastSavedContent = cloneContent(
      attempt.request.content,
    );

    this.onSaveSuccess?.({
      response,
      savedContent: cloneContent(
        attempt.request.content,
      ),
    });

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

    const failureKind =
      this.classifyError(error);

    if (failureKind === "conflict") {
      this.conflictAttempt = attempt;
      this.setStatus("conflict");
      return;
    }

    this.failedAttempt = attempt;
    this.setStatus("save-failed");
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
    this.onStateChange?.(
      this.getSnapshot(),
    );
  }
}