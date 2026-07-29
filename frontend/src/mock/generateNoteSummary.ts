import type { NoteStatus } from "../domain/noteAttributes";
import type { NoteSummary } from "../domain/noteSummary";

type RandomFunction = () => number;

function createSeededRandom(seed: number) {
  let state = seed;

  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;

    return state / 4294967296;
  };
}

function pickRandom<T>(
  items: readonly T[],
  random: () => number,
): T {
  const index = Math.floor(random() * items.length);

  return items[index];
}

const FIRST_NAMES = [
  "Avery",
  "Jordan",
  "Morgan",
  "Taylor",
  "Cameron",
  "Riley",
  "Casey",
  "Quinn",
  "Parker",
  "Jamie",
] as const;

const LAST_NAMES = [
  "Brooks",
  "Lee",
  "Reed",
  "Morgan",
  "Hayes",
  "Bennett",
  "Carter",
  "Foster",
  "Gray",
  "Sullivan",
] as const;

const REVIEWERS = [
  {
    id: "reviewer-1",
    displayName: "Alex Kim",
  },
  {
    id: "reviewer-2",
    displayName: "Sam Rivera",
  },
  {
    id: "reviewer-3",
    displayName: "Drew Patel",
  },
  {
    id: "reviewer-4",
    displayName: "Robin Chen",
  },
  {
    id: "reviewer-5",
    displayName: "Jules Martin",
  },
] as const;

const STATUS_POOL: readonly NoteStatus[] = [
  "APPROVED",
  "APPROVED",
  "APPROVED",
  "READY_FOR_REVIEW",
  "READY_FOR_REVIEW",
  "READY_FOR_REVIEW",
  "IN_REVIEW",
  "IN_REVIEW",
  "REJECTED",
  "FAILED",
  "GENERATING",
  "AMENDED",
  "LOCKED",
];

interface MockPatient {
  id: string;
  displayName: string;
}

function generatePatients(
  count: number,
  random: RandomFunction,
): MockPatient[] {
  return Array.from({ length: count }, (_, index) => {
    const firstName = pickRandom(FIRST_NAMES, random);
    const lastName = pickRandom(LAST_NAMES, random);

    return {
      id: `patient-${index + 1}`,
      displayName: `${firstName} ${lastName}`,
    };
  });
}

function generateStatus(random: RandomFunction): NoteStatus {
  return pickRandom(STATUS_POOL, random);
}

function generateReviewer(
  status: NoteStatus,
  random: RandomFunction,
): (typeof REVIEWERS)[number] | null {
  const statusesRequiringReviewer: readonly NoteStatus[] = [
    "IN_REVIEW",
    "APPROVED",
    "REJECTED",
    "AMENDED",
    "LOCKED",
  ];

  if (!statusesRequiringReviewer.includes(status)) {
    return null;
  }

  return pickRandom(REVIEWERS, random);
}

function generateCurrentVersion(
  noteIndex: number,
  status: NoteStatus,
  random: RandomFunction,
): {
  id: string;
  revision: number;
} {
  let revision: number;

  if (status === "GENERATING" || status === "FAILED") {
    revision = 1;
  } else if (status === "AMENDED") {
    revision = randomInteger(2, 4, random);
  } else {
    revision = randomInteger(1, 3, random);
  }

  return {
    id: `note-version-${noteIndex + 1}-${revision}`,
    revision,
  };
}

function randomInteger(
  minimum: number,
  maximum: number,
  random: RandomFunction,
): number {
  return Math.floor(random() * (maximum - minimum + 1)) + minimum;
}

function generateCreatedDate(
  random: RandomFunction,
  referenceDate: Date,
): Date {
  const maximumAgeInDays = 180;
  const daysAgo = randomInteger(0, maximumAgeInDays, random);

  const createdAt = new Date(referenceDate);
  createdAt.setUTCDate(createdAt.getUTCDate() - daysAgo);

  const randomHour = randomInteger(8, 17, random);
  const randomMinute = randomInteger(0, 59, random);

  createdAt.setUTCHours(randomHour, randomMinute, 0, 0);

  return createdAt;
}

function generateUpdatedDate(
  createdAt: Date,
  random: RandomFunction,
  referenceDate: Date,
): Date {
  const maximumDifferenceInMinutes = 14 * 24 * 60;

  const minutesAfterCreation = randomInteger(
    0,
    maximumDifferenceInMinutes,
    random,
  );

  const updatedAt = new Date(
    createdAt.getTime() + minutesAfterCreation * 60_000,
  );

  if (updatedAt > referenceDate) {
    return new Date(referenceDate);
  }

  return updatedAt;
}

export function generateNoteSummaries(
  count = 5_000,
  seed = 42,
): NoteSummary[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(
      "Note summary count must be a non-negative integer.",
    );
  }

  const random = createSeededRandom(seed);

  const patientCount = Math.max(
    1,
    Math.min(1_000, Math.ceil(count / 10)),
  );

  const patients = generatePatients(
    patientCount,
    random,
  );

  const referenceDate = new Date("2026-07-01T17:00:00.000Z");

  return Array.from({ length: count }, (_, index) => {
    const status = generateStatus(random);
    const patient = pickRandom(patients, random);
    const assignedReviewer = generateReviewer(
      status,
      random,
    );

    const createdAt = generateCreatedDate(
      random,
      referenceDate,
    );

    const updatedAt = generateUpdatedDate(
      createdAt,
      random,
      referenceDate,
    );

    return {
      id: `note-${String(index + 1).padStart(6, "0")}`,
      patient,
      status,
      currentVersion: generateCurrentVersion(
        index,
        status,
        random,
      ),
      assignedReviewer,
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    };
  });
}