import { http, HttpResponse } from "msw";

import { reassignNotes, regenerateNotes } from "./noteStore";
import { simulateNetwork, SimulatedNetworkFailure, } from "./mockNetwork";
import type { UserRole } from "../domain/noteAttributes";

interface AssignReviewerBody {
  noteIds: string[];
  reviewerId: string | null;
  reviewerDisplayName: string | null;
}

interface RegenerateBody {
  noteIds: string[];
  actorRole: UserRole;
}

export const assignReviewerHandler = http.post(
  "*/api/notes/bulk/assign-reviewer",
  async ({ request }) => {
    try {
      await simulateNetwork();
    } catch (error) {
      if (error instanceof SimulatedNetworkFailure) {
        return HttpResponse.json(
          { error: "internal_error", message: "Simulated failure" },
          { status: 503 },
        );
      }
      throw error;
    }

    const body = (await request.json()) as AssignReviewerBody;

    const reviewer =
      body.reviewerId !== null && body.reviewerDisplayName !== null
        ? { id: body.reviewerId, displayName: body.reviewerDisplayName }
        : null;

    const updated = reassignNotes(body.noteIds, reviewer);

    return HttpResponse.json({ updated });
  },
);

export const regenerateHandler = http.post(
  "*/api/notes/bulk/regenerate",
  async ({ request }) => {
    try {
      await simulateNetwork();
    } catch (error) {
      if (error instanceof SimulatedNetworkFailure) {
        return HttpResponse.json(
          { error: "internal_error", message: "Simulated failure" },
          { status: 503 },
        );
      }
      throw error;
    }

    const body = (await request.json()) as RegenerateBody;

    const updated = regenerateNotes(body.noteIds, body.actorRole);

    const skipped = body.noteIds.filter(
      (id) => !updated.includes(id),
    );

    return HttpResponse.json({ updated, skipped });
  },
);