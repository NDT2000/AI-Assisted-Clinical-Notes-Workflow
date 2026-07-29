import { http, HttpResponse } from "msw";

import { getNotes } from "./noteStore";
import {
  simulateNetwork,
  SimulatedNetworkFailure,
} from "./mockNetwork";

const MAX_RESULTS = 20;

/*
 * There's no separate patient table in this mock backend — patients
 * only exist embedded inside NoteSummary objects. Real backends would
 * have a dedicated patients table and this would be a straightforward
 * indexed query; here, deduplication happens by scanning the store.
 * This is called out as a documented simplification, not hidden: a
 * production version would need patients to exist independently of
 * whether they currently have a note.
 */
export const getPatientsHandler = http.get(
  "*/api/patients",
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

    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();

    const notes = getNotes();

    const uniquePatients = new Map<
      string,
      { id: string; displayName: string }
    >();

    for (const note of notes) {
      if (uniquePatients.has(note.patient.id)) {
        continue;
      }

      if (
        query !== "" &&
        !note.patient.displayName.toLowerCase().includes(query)
      ) {
        continue;
      }

      uniquePatients.set(note.patient.id, note.patient);

      if (uniquePatients.size >= MAX_RESULTS) {
        break;
      }
    }

    return HttpResponse.json({
      items: Array.from(uniquePatients.values()),
    });
  },
);