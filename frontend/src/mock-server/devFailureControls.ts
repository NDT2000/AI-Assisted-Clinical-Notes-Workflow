export interface DevFailureState {
  failNextSave: boolean;
  delayNextSaveMs: number | null;
  conflictNextSave: boolean;
  rejectNextTransition: boolean;
}

export interface ConsumedSaveFailureControls {
  shouldFail: boolean;
  delayMs: number | null;
  shouldConflict: boolean;
}

export interface ConsumedTransitionFailureControls {
  shouldReject: boolean;
}

type DevFailureListener = () => void;

function createInitialState(): DevFailureState {
  return {
    failNextSave: false,
    delayNextSaveMs: null,
    conflictNextSave: false,
    rejectNextTransition: false,
  };
}

let state = createInitialState();

const listeners =
  new Set<DevFailureListener>();

function publish(
  nextState: DevFailureState,
): void {
  state = nextState;

  listeners.forEach((listener) => {
    listener();
  });
}

function updateState(
  changes: Partial<DevFailureState>,
): void {
  publish({
    ...state,
    ...changes,
  });
}

export const devFailureControls = {
  getSnapshot(): DevFailureState {
    return state;
  },

  subscribe(
    listener: DevFailureListener,
  ): () => void {
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  },

  armFailNextSave(): void {
    updateState({
      failNextSave: true,
    });
  },

  armDelayNextSave(
    delayMs: number,
  ): void {
    if (
      !Number.isFinite(delayMs) ||
      delayMs <= 0
    ) {
      throw new RangeError(
        "Save delay must be greater than zero",
      );
    }

    updateState({
      delayNextSaveMs: delayMs,
    });
  },

  armConflictNextSave(): void {
    updateState({
      conflictNextSave: true,
    });
  },

  armRejectNextTransition(): void {
    updateState({
      rejectNextTransition: true,
    });
  },

  consumeSaveControls():
    ConsumedSaveFailureControls {
    const consumed = {
      shouldFail:
        state.failNextSave,

      delayMs:
        state.delayNextSaveMs,

      shouldConflict:
        state.conflictNextSave,
    };

    if (
      consumed.shouldFail ||
      consumed.delayMs !== null ||
      consumed.shouldConflict
    ) {
      publish({
        ...state,
        failNextSave: false,
        delayNextSaveMs: null,
        conflictNextSave: false,
      });
    }

    return consumed;
  },

  consumeTransitionControls():
    ConsumedTransitionFailureControls {
    const consumed = {
      shouldReject:
        state.rejectNextTransition,
    };

    if (consumed.shouldReject) {
      publish({
        ...state,
        rejectNextTransition: false,
      });
    }

    return consumed;
  },

  reset(): void {
    publish(
      createInitialState(),
    );
  },
};