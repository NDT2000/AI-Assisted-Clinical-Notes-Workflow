import { useSyncExternalStore, } from "react";

import {devFailureControls, } from "../../../../mock-server/devFailureControls";

const NEXT_SAVE_DELAY_MS = 3000;

function DevelopmentControlsPanel() {
  const state = useSyncExternalStore(
    devFailureControls.subscribe,
    devFailureControls.getSnapshot,
  );

  const armedControls = [
    state.failNextSave
      ? "Fail next save"
      : null,

    state.delayNextSaveMs !== null
      ? `Delay next save by ${state.delayNextSaveMs} ms`
      : null,

    state.conflictNextSave
      ? "Cause version conflict"
      : null,

    state.rejectNextTransition
      ? "Reject next transition"
      : null,
  ].filter(
    (value): value is string =>
      value !== null,
  );

  return (
    <section
      className="development-controls"
      aria-labelledby="development-controls-heading"
    >
      <div className="development-controls-header">
        <h2 id="development-controls-heading">
          Development controls
        </h2>

        <p>
          Each control affects only the next
          matching request.
        </p>
      </div>

      <div className="development-controls-actions">
        <button
          type="button"
          disabled={state.failNextSave}
          onClick={() => {
            devFailureControls
              .armFailNextSave();
          }}
        >
          Fail next save
        </button>

        <button
          type="button"
          disabled={
            state.delayNextSaveMs !== null
          }
          onClick={() => {
            devFailureControls
              .armDelayNextSave(
                NEXT_SAVE_DELAY_MS,
              );
          }}
        >
          Delay next save
        </button>

        <button
          type="button"
          disabled={state.conflictNextSave}
          onClick={() => {
            devFailureControls
              .armConflictNextSave();
          }}
        >
          Cause version conflict
        </button>

        <button
          type="button"
          disabled={
            state.rejectNextTransition
          }
          onClick={() => {
            devFailureControls
              .armRejectNextTransition();
          }}
        >
          Reject next transition
        </button>
      </div>

      <p
        className="development-controls-status"
        role="status"
      >
        {armedControls.length > 0
          ? `Armed: ${armedControls.join(", ")}.`
          : "No failure is currently armed."}
      </p>
    </section>
  );
}

export function DevelopmentControls() {
  if (!import.meta.env.DEV) {
    return null;
  }

  return <DevelopmentControlsPanel />;
}