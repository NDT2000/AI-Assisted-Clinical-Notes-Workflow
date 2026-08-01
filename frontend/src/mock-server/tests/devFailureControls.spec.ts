import { beforeEach, describe, expect, it, vi, } from "vitest";

import { devFailureControls, } from "../devFailureControls";

describe("devFailureControls", () => {
  beforeEach(() => {
    devFailureControls.reset();
  });

  it(
    "consumes save controls only once",
    () => {
      devFailureControls
        .armFailNextSave();

      devFailureControls
        .armDelayNextSave(3000);

      devFailureControls
        .armConflictNextSave();

      devFailureControls
        .armRejectNextTransition();

      expect(
        devFailureControls
          .consumeSaveControls(),
      ).toEqual({
        shouldFail: true,
        delayMs: 3000,
        shouldConflict: true,
      });

      expect(
        devFailureControls.getSnapshot(),
      ).toEqual({
        failNextSave: false,
        delayNextSaveMs: null,
        conflictNextSave: false,
        rejectNextTransition: true,
      });

      expect(
        devFailureControls
          .consumeSaveControls(),
      ).toEqual({
        shouldFail: false,
        delayMs: null,
        shouldConflict: false,
      });
    },
  );

  it(
    "consumes transition rejection only once",
    () => {
      devFailureControls
        .armFailNextSave();

      devFailureControls
        .armRejectNextTransition();

      expect(
        devFailureControls
          .consumeTransitionControls(),
      ).toEqual({
        shouldReject: true,
      });

      expect(
        devFailureControls.getSnapshot(),
      ).toEqual({
        failNextSave: true,
        delayNextSaveMs: null,
        conflictNextSave: false,
        rejectNextTransition: false,
      });

      expect(
        devFailureControls
          .consumeTransitionControls(),
      ).toEqual({
        shouldReject: false,
      });
    },
  );

  it(
    "notifies subscribers when controls change",
    () => {
      const listener = vi.fn();

      const unsubscribe =
        devFailureControls.subscribe(
          listener,
        );

      devFailureControls
        .armFailNextSave();

      expect(listener)
        .toHaveBeenCalledTimes(1);

      devFailureControls
        .consumeSaveControls();

      expect(listener)
        .toHaveBeenCalledTimes(2);

      unsubscribe();

      devFailureControls
        .armConflictNextSave();

      expect(listener)
        .toHaveBeenCalledTimes(2);
    },
  );
});