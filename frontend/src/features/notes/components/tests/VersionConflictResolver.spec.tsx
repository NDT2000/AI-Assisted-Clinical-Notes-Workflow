import { cleanup, fireEvent, render, screen, } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, } from "vitest";

import type { SoapContent, } from "../../../../domain/noteAttributes";
import { VersionConflictResolver, } from "../note-detail/VersionConflictResolver";

afterEach(() => {
  cleanup();
});

const ancestorContent: SoapContent = {
  subjective:
    "Original subjective",
  objective:
    "Original objective",
  assessment:
    "Original assessment",
  plan: "Original plan",
};

describe(
  "VersionConflictResolver",
  () => {
    it(
      "requires every conflicting section to be resolved",
      () => {
        const localContent: SoapContent = {
          ...ancestorContent,
          plan: "Local plan",
        };

        const serverContent: SoapContent = {
          ...ancestorContent,
          plan: "Server plan",
        };

        render(
          <VersionConflictResolver
            ancestorContent={
              ancestorContent
            }
            localContent={localContent}
            serverContent={
              serverContent
            }
            onResolve={vi.fn()}
          />,
        );

        const saveButton =
          screen.getByRole(
            "button",
            {
              name: "Save resolved version",
            },
          );

        expect(
          saveButton,
        ).toBeDisabled();

        fireEvent.click(
          screen.getByRole(
            "radio",
            {
              name: "Keep my version for Plan",
            },
          ),
        );

        expect(
          saveButton,
        ).toBeEnabled();
      },
    );

    it(
      "combines automatic and selected resolutions",
      () => {
        const handleResolve =
          vi.fn();

        const localContent: SoapContent = {
          ...ancestorContent,
          subjective:
            "Local subjective",
          plan: "Local plan",
        };

        const serverContent: SoapContent = {
          ...ancestorContent,
          objective:
            "Server objective",
          plan: "Server plan",
        };

        render(
          <VersionConflictResolver
            ancestorContent={
              ancestorContent
            }
            localContent={localContent}
            serverContent={
              serverContent
            }
            onResolve={
              handleResolve
            }
          />,
        );

        fireEvent.click(
          screen.getByRole(
            "radio",
            {
              name: "Keep my version for Plan",
            },
          ),
        );

        fireEvent.click(
          screen.getByRole(
            "button",
            {
              name: "Save resolved version",
            },
          ),
        );

        expect(
          handleResolve,
        ).toHaveBeenCalledWith({
          subjective:
            "Local subjective",
          objective:
            "Server objective",
          assessment:
            "Original assessment",
          plan: "Local plan",
        });
      },
    );

    it(
      "allows a manually merged section",
      () => {
        const handleResolve =
          vi.fn();

        const localContent: SoapContent = {
          ...ancestorContent,
          plan: "Local plan",
        };

        const serverContent: SoapContent = {
          ...ancestorContent,
          plan: "Server plan",
        };

        render(
          <VersionConflictResolver
            ancestorContent={
              ancestorContent
            }
            localContent={localContent}
            serverContent={
              serverContent
            }
            onResolve={
              handleResolve
            }
          />,
        );

        fireEvent.click(
          screen.getByRole(
            "radio",
            {
              name: "Manually merge Plan",
            },
          ),
        );

        fireEvent.change(
          screen.getByRole(
            "textbox",
            {
              name: "Merged Plan",
            },
          ),
          {
            target: {
              value:
                "Combined local and server plan",
            },
          },
        );

        fireEvent.click(
          screen.getByRole(
            "button",
            {
              name: "Save resolved version",
            },
          ),
        );

        expect(
          handleResolve,
        ).toHaveBeenCalledWith({
          ...ancestorContent,
          plan:
            "Combined local and server plan",
        });
      },
    );
  },
);