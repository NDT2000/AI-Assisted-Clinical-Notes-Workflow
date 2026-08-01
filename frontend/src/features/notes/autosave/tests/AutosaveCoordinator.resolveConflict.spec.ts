import { afterEach, describe, expect, it, vi, } from "vitest";

import type { SoapContent, } from "../../../../domain/noteAttributes";
import type { SaveNoteVersionResponse, } from "../../../../domain/noteSave"; 
import { AutosaveCoordinator, } from "../AutosaveCoordinator";

const originalContent: SoapContent = {
  subjective: "Original subjective",
  objective: "Original objective",
  assessment: "Original assessment",
  plan: "Original plan",
};

const conflictingContent: SoapContent = {
  ...originalContent,
  plan: "My conflicting plan",
};

const resolvedContent: SoapContent = {
  ...originalContent,
  plan: "Combined resolved plan",
};

afterEach(() => {
  vi.useRealTimers();
});

describe(
  "AutosaveCoordinator conflict resolution",
  () => {
    it(
      "saves resolved content against the server head with a new mutation ID",
      async () => {
        vi.useFakeTimers();

        const conflictError =
          new Error(
            "Version conflict",
          );

        const successfulResponse = {
          savedVersion: {
            versionId:
              "version-resolved",
          },
        } as SaveNoteVersionResponse;

        const save = vi
          .fn()
          .mockRejectedValueOnce(
            conflictError,
          )
          .mockResolvedValueOnce(
            successfulResponse,
          );

        const createClientMutationId = vi
          .fn()
          .mockReturnValueOnce(
            "mutation-original",
          )
          .mockReturnValueOnce(
            "mutation-resolved",
          );

        const coordinator =
          new AutosaveCoordinator({
            initialBaseVersionId:
              "version-original",

            initialContent:
              originalContent,

            debounceMs: 500,

            save,

            createClientMutationId,

            classifyError: (error) =>
              error === conflictError
                ? "conflict"
                : "save-failed",
          });

        coordinator.updateDraft(
          conflictingContent,
        );

        await vi.advanceTimersByTimeAsync(
          500,
        );

        expect(
          coordinator.getSnapshot()
            .status,
        ).toBe("conflict");

        coordinator.resolveConflict(
          resolvedContent,
          "version-server-head",
        );

        expect(save).toHaveBeenCalledTimes(
          2,
        );

        expect(save).toHaveBeenLastCalledWith({
          baseVersionId:
            "version-server-head",

          clientMutationId:
            "mutation-resolved",

          content: resolvedContent,
        });

        coordinator.dispose();
      },
    );
  },
);