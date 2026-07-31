import type { NoteStatus, SoapContent, } from "../domain/noteAttributes";
import type { NoteDetail, NoteVersionDetail, PatientInformation, PresenceUser, ReviewTimelineEvent, SessionInformation, UserSummary, } from "../domain/noteDetail";
import type { NoteSummary } from "../domain/noteSummary";

const CLINICIANS: readonly UserSummary[] = [
  {
    id: "clinician-1",
    displayName: "Dr. Maya Brooks",
    role: "CLINICIAN",
  },
  {
    id: "clinician-2",
    displayName: "Dr. Noah Chen",
    role: "CLINICIAN",
  },
  {
    id: "clinician-3",
    displayName: "Dr. Elena Patel",
    role: "CLINICIAN",
  },
];

const ADMIN: UserSummary = {
  id: "admin-1",
  displayName: "Jordan Taylor",
  role: "ADMIN",
};

interface TimelineStep {
  fromStatus: NoteStatus;
  toStatus: NoteStatus;
  actor: UserSummary;
  reason?: string;
}

function extractNumericId(id: string): number {
  const match = id.match(/(\d+)$/);

  if (!match) {
    return 1;
  }

  return Number(match[1]);
}

function getClinician(noteId: string): UserSummary {
  const noteNumber = extractNumericId(noteId);
  const index = (noteNumber - 1) % CLINICIANS.length;

  return CLINICIANS[index];
}

function createReviewer(
  summary: NoteSummary,
): UserSummary | null {
  if (!summary.assignedReviewer) {
    return null;
  }

  return {
    ...summary.assignedReviewer,
    role: "REVIEWER",
  };
}

function generatePatientInformation(
  summary: NoteSummary,
): PatientInformation {
  const patientNumber = extractNumericId(
    summary.patient.id,
  );

  const birthYear = 1945 + (patientNumber % 55);
  const birthMonth = String(
    (patientNumber % 12) + 1,
  ).padStart(2, "0");
  const birthDay = String(
    (patientNumber % 28) + 1,
  ).padStart(2, "0");

  return {
    id: summary.patient.id,
    displayName: summary.patient.displayName,
    dateOfBirth: `${birthYear}-${birthMonth}-${birthDay}`,
    medicalRecordNumber: `MRN-${String(
      patientNumber,
    ).padStart(7, "0")}`,
  };
}

function generateSessionInformation(
  summary: NoteSummary,
  clinician: UserSummary,
): SessionInformation {
  const noteNumber = extractNumericId(summary.id);

  const endedAt = new Date(summary.createdAt);
  const startedAt = new Date(
    endedAt.getTime() - 45 * 60 * 1_000,
  );

  return {
    id: `session-${String(noteNumber).padStart(
      6,
      "0",
    )}`,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    clinician,
  };
}

function generateSoapContent(
  summary: NoteSummary,
  revisionNumber: number,
): SoapContent {
  return {
    subjective:
      `${summary.contentPreview} ` +
      `The patient described the current symptoms ` +
      `and relevant changes since the previous visit.`,

    objective:
      `Vital signs were reviewed and were stable. ` +
      `The examination findings were documented ` +
      `for revision ${revisionNumber}.`,

    assessment:
      `The presentation remains consistent with ` +
      `the documented clinical assessment. ` +
      `No urgent concerns were identified.`,

    plan:
      `Continue the current care plan, monitor ` +
      `symptoms, and complete the recommended ` +
      `follow-up.`,
  };
}

function createVersionId(
  summary: NoteSummary,
  revisionNumber: number,
): string {
  if (
    revisionNumber ===
    summary.currentVersion.revision
  ) {
    return summary.currentVersion.id;
  }

  const currentSuffix =
    `-${summary.currentVersion.revision}`;

  if (
    summary.currentVersion.id.endsWith(
      currentSuffix,
    )
  ) {
    return (
      summary.currentVersion.id.slice(
        0,
        -currentSuffix.length,
      ) + `-${revisionNumber}`
    );
  }

  return `${summary.id}-version-${revisionNumber}`;
}

function generateVersions(
  summary: NoteSummary,
  clinician: UserSummary,
  reviewer: UserSummary | null,
): NoteVersionDetail[] {
  const revisionCount =
    summary.currentVersion.revision;

  return Array.from(
    { length: revisionCount },
    (_, index) => {
      const revisionNumber = index + 1;
      const versionId = createVersionId(
        summary,
        revisionNumber,
      );

      const previousVersionId =
        revisionNumber === 1
          ? null
          : createVersionId(
              summary,
              revisionNumber - 1,
            );

      const author =
        revisionNumber === 1 || !reviewer
          ? clinician
          : reviewer;

      const createdAt = new Date(
        new Date(summary.createdAt).getTime() +
          index * 5 * 60 * 1_000,
      ).toISOString();

      return {
        versionId,
        noteId: summary.id,
        revisionNumber,
        parentVersionId: previousVersionId,
        content: generateSoapContent(
          summary,
          revisionNumber,
        ),
        authorId: author.id,
        authorRole: author.role,
        authorDisplayName: author.displayName,
        createdAt,
      };
    },
  );
}

function getTimelineSteps(
  status: NoteStatus,
  clinician: UserSummary,
  reviewer: UserSummary | null,
): TimelineStep[] {
  const effectiveReviewer =
    reviewer ?? {
      id: "reviewer-unassigned",
      displayName: "Unassigned Reviewer",
      role: "REVIEWER" as const,
    };

  const generatedSuccessfully: TimelineStep = {
    fromStatus: "GENERATING",
    toStatus: "READY_FOR_REVIEW",
    actor: clinician,
  };

  const reviewStarted: TimelineStep = {
    fromStatus: "READY_FOR_REVIEW",
    toStatus: "IN_REVIEW",
    actor: effectiveReviewer,
  };

  switch (status) {
    case "GENERATING":
      return [];

    case "FAILED":
      return [
        {
          fromStatus: "GENERATING",
          toStatus: "FAILED",
          actor: clinician,
          reason:
            "The initial note generation failed.",
        },
      ];

    case "READY_FOR_REVIEW":
      return [generatedSuccessfully];

    case "IN_REVIEW":
      return [
        generatedSuccessfully,
        reviewStarted,
      ];

    case "REJECTED":
      return [
        generatedSuccessfully,
        reviewStarted,
        {
          fromStatus: "IN_REVIEW",
          toStatus: "REJECTED",
          actor: effectiveReviewer,
          reason:
            "Changes were requested before approval.",
        },
      ];

    case "APPROVED":
      return [
        generatedSuccessfully,
        reviewStarted,
        {
          fromStatus: "IN_REVIEW",
          toStatus: "APPROVED",
          actor: effectiveReviewer,
        },
      ];

    case "AMENDED":
      return [
        generatedSuccessfully,
        reviewStarted,
        {
          fromStatus: "IN_REVIEW",
          toStatus: "APPROVED",
          actor: effectiveReviewer,
        },
        {
          fromStatus: "APPROVED",
          toStatus: "AMENDED",
          actor: clinician,
          reason:
            "A post-approval amendment was created.",
        },
      ];

    case "LOCKED":
      return [
        generatedSuccessfully,
        reviewStarted,
        {
          fromStatus: "IN_REVIEW",
          toStatus: "APPROVED",
          actor: effectiveReviewer,
        },
        {
          fromStatus: "APPROVED",
          toStatus: "LOCKED",
          actor: ADMIN,
          reason:
            "The amendment grace period expired.",
        },
      ];
  }
}

function generateTimeline(
  summary: NoteSummary,
  clinician: UserSummary,
  reviewer: UserSummary | null,
): ReviewTimelineEvent[] {
  const steps = getTimelineSteps(
    summary.status,
    clinician,
    reviewer,
  );

  const createdAt = new Date(
    summary.createdAt,
  ).getTime();

  const updatedAt = new Date(
    summary.updatedAt,
  ).getTime();

  const availableDuration = Math.max(
    0,
    updatedAt - createdAt,
  );

  return steps.map((step, index) => {
    const progress =
      steps.length === 0
        ? 0
        : (index + 1) / steps.length;

    const occurredAt = new Date(
      createdAt + availableDuration * progress,
    ).toISOString();

    return {
      eventId:
        `${summary.id}-event-${index + 1}`,
      noteId: summary.id,
      versionId: summary.currentVersion.id,
      fromStatus: step.fromStatus,
      toStatus: step.toStatus,
      actorId: step.actor.id,
      actorRole: step.actor.role,
      actorDisplayName:
        step.actor.displayName,
      reason: step.reason,
      occurredAt,
    };
  });
}

function generatePresence(
  summary: NoteSummary,
  reviewer: UserSummary | null,
): PresenceUser[] {
  if (!reviewer) {
    return [];
  }

  const presenceStatuses: readonly NoteStatus[] = [
    "READY_FOR_REVIEW",
    "IN_REVIEW",
    "AMENDED",
  ];

  if (
    !presenceStatuses.includes(summary.status)
  ) {
    return [];
  }

  return [
    {
      user: reviewer,
      activity:
        summary.status === "IN_REVIEW"
          ? "EDITING"
          : "VIEWING",
      lastSeenAt: summary.updatedAt,
    },
  ];
}

export function generateNoteDetail(
  summary: NoteSummary,
): NoteDetail {
  const clinician = getClinician(summary.id);
  const assignedReviewer = createReviewer(summary);
  const patient = generatePatientInformation(summary);
  const session = generateSessionInformation(summary, clinician,);
  const versions = generateVersions(summary, clinician, assignedReviewer,);
  const currentVersion =
    versions[versions.length - 1];

  if (!currentVersion) {
    throw new Error(
      `Unable to generate a current version for ${summary.id}.`,
    );
  }

  const approvedStatuses:
    readonly NoteStatus[] = [
      "APPROVED",
      "AMENDED",
      "LOCKED",
    ];

  return {
    note: {
      id: summary.id,
      patientId: patient.id,
      sessionId: session.id,
      status: summary.status,
      currentVersionId:
        currentVersion.versionId,
      assignedReviewerId:
        assignedReviewer?.id ?? null,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
      approvedAt:
        approvedStatuses.includes(
          summary.status,
        )
          ? summary.updatedAt
          : undefined,
    },

    patient,
    session,
    assignedReviewer,
    currentVersion,
    versions,

    timeline: generateTimeline(
      summary,
      clinician,
      assignedReviewer,
    ),

    presence: generatePresence(
      summary,
      assignedReviewer,
    ),
  };
}