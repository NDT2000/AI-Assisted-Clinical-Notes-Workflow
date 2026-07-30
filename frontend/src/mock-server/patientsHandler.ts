import {
  http,
  HttpResponse,
} from "msw";

import {
  NOTE_STATUS,
  type NoteStatus,
} from "../domain/noteAttributes";
import { getNotes } from "./noteStore";
import {
  simulateNetwork,
  SimulatedNetworkFailure,
} from "./mockNetwork";

const MAX_RESULTS = 20;

function getStatuses(
  searchParams: URLSearchParams,
): NoteStatus[] {
  return searchParams
    .getAll("status")
    .filter(
      (status): status is NoteStatus =>
        NOTE_STATUS.includes(
          status as NoteStatus,
        ),
    );
}

function parseDate(
  value: string | null,
  endOfDay: boolean,
): number | null {
  if (value === null || value.trim() === "") {
    return null;
  }

  const time = endOfDay
    ? "T23:59:59.999Z"
    : "T00:00:00.000Z";

  const timestamp = new Date(
    `${value}${time}`,
  ).getTime();

  if (Number.isNaN(timestamp)) {
    return null;
  }

  return timestamp;
}

/*
 * Patients are embedded in generated notes in this mock
 * backend. We first narrow those notes using the selected
 * contextual filters, and then derive unique patients from
 * the matching notes.
 */
export const getPatientsHandler = http.get(
  "*/api/patients",
  async ({ request }) => {
    try {
      await simulateNetwork();
    } catch (error) {
      if (
        error instanceof
        SimulatedNetworkFailure
      ) {
        return HttpResponse.json(
          {
            error: "internal_error",
            message: "Simulated failure",
          },
          { status: 503 },
        );
      }

      throw error;
    }

    const url = new URL(request.url);

    const query = (
      url.searchParams.get("q") ?? ""
    )
      .trim()
      .toLowerCase();

    const patientId =
      url.searchParams.get("patientId") ?? "";

    const statuses = getStatuses(
      url.searchParams,
    );

    const reviewerId =
      url.searchParams.get(
        "reviewerId",
      ) ?? "";

    const createdFrom = parseDate(
      url.searchParams.get(
        "createdFrom",
      ),
      false,
    );

    const createdTo = parseDate(
      url.searchParams.get(
        "createdTo",
      ),
      true,
    );

    const uniquePatients = new Map<
      string,
      {
        id: string;
        displayName: string;
      }
    >();

    for (const note of getNotes()) {
      if (
        patientId !== "" &&
        note.patient.id !== patientId
      ) {
        continue;
      }
      if (
        statuses.length > 0 &&
        !statuses.includes(note.status)
      ) {
        continue;
      }

      if (
        reviewerId !== "" &&
        note.assignedReviewer?.id !==
          reviewerId
      ) {
        continue;
      }

      const createdAt = new Date(
        note.createdAt,
      ).getTime();

      if (
        createdFrom !== null &&
        createdAt < createdFrom
      ) {
        continue;
      }

      if (
        createdTo !== null &&
        createdAt > createdTo
      ) {
        continue;
      }

      if (
        query !== "" &&
        !note.patient.displayName
          .toLowerCase()
          .includes(query)
      ) {
        continue;
      }

      uniquePatients.set(
        note.patient.id,
        note.patient,
      );
      if (patientId !== "") {
        break;
      }

      if (
        uniquePatients.size >=
        MAX_RESULTS
      ) {
        break;
      }
    }

    const items = Array.from(
      uniquePatients.values(),
    ).sort((first, second) =>
      first.displayName.localeCompare(
        second.displayName,
      ),
    );

    return HttpResponse.json({
      items,
    });
  },
);