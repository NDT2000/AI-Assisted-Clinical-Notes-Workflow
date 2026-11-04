"""Synthetic notes, identical to the frontend's mock data generator.

A line-for-line port of frontend/src/mock-data/generateNoteSummary.ts and
generateNoteDetail.ts. The same seed yields the same notes, ids and
timestamps, so the real API serves exactly what the mock backend did.
tests/test_mock_data.py checks this against a sample exported from the
TypeScript generator.

All data is synthetic; none of it describes real people.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from math import ceil, floor, trunc
from typing import Any

Random = Callable[[], float]
Json = dict[str, Any]

STATUSES = (
    "GENERATING",
    "FAILED",
    "READY_FOR_REVIEW",
    "IN_REVIEW",
    "REJECTED",
    "APPROVED",
    "AMENDED",
    "LOCKED",
)

REVIEWERS = (
    {"id": "reviewer-1", "displayName": "Alex Kim"},
    {"id": "reviewer-2", "displayName": "Sam Rivera"},
    {"id": "reviewer-3", "displayName": "Drew Patel"},
    {"id": "reviewer-4", "displayName": "Robin Chen"},
    {"id": "reviewer-5", "displayName": "Jules Martin"},
)

CLINICIANS = (
    {"id": "clinician-1", "displayName": "Dr. Maya Brooks", "role": "CLINICIAN"},
    {"id": "clinician-2", "displayName": "Dr. Noah Chen", "role": "CLINICIAN"},
    {"id": "clinician-3", "displayName": "Dr. Elena Patel", "role": "CLINICIAN"},
)

# Locks notes when the amendment grace period expires.
ADMIN = {"id": "admin-1", "displayName": "Jordan Taylor", "role": "ADMIN"}

FIRST_NAMES = (
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
)

LAST_NAMES = (
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
)

CONTENT_PREVIEW_FRAGMENTS = (
    "Patient reports improvement in symptoms since last visit.",
    "Discussed medication adherence and side effects.",
    "Physical exam unremarkable, vitals stable.",
    "Follow-up recommended in two weeks to reassess.",
    "Patient presents with continued discomfort, plan adjusted.",
    "Reviewed lab results, no acute concerns noted.",
    "Counseled patient on lifestyle modifications.",
    "Symptoms consistent with prior assessment, treatment continued.",
)

STATUSES_WITH_REVIEWER = frozenset(
    {"READY_FOR_REVIEW", "IN_REVIEW", "APPROVED", "REJECTED", "AMENDED", "LOCKED"}
)
APPROVED_STATUSES = frozenset({"APPROVED", "AMENDED", "LOCKED"})

REFERENCE_DATE = datetime(2026, 7, 1, 17, 0, tzinfo=UTC)


def create_seeded_random(seed: int) -> Random:
    """The frontend's linear congruential generator, bit for bit."""
    state = seed

    def random() -> float:
        nonlocal state
        state = (state * 1664525 + 1013904223) % 4294967296
        return state / 4294967296

    return random


def pick_random[T](items: Sequence[T], random: Random) -> T:
    return items[floor(random() * len(items))]


def random_integer(minimum: int, maximum: int, random: Random) -> int:
    return floor(random() * (maximum - minimum + 1)) + minimum


def to_iso(value: datetime) -> str:
    """Matches JavaScript's Date.prototype.toISOString()."""
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.") + (
        f"{value.microsecond // 1000:03d}Z"
    )


def from_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _epoch_ms(value: datetime) -> int:
    return round(value.timestamp() * 1000)


def _from_epoch_ms(milliseconds: int) -> datetime:
    return datetime(1970, 1, 1, tzinfo=UTC) + timedelta(milliseconds=milliseconds)


def _extract_numeric_id(value: str) -> int:
    digits = ""
    for character in reversed(value):
        if not character.isdigit():
            break
        digits = character + digits
    return int(digits) if digits else 1


# --- Summaries (generateNoteSummary.ts) -------------------------------------


def _generate_created_date(random: Random) -> datetime:
    days_ago = random_integer(0, 180, random)
    day = REFERENCE_DATE - timedelta(days=days_ago)
    hour = random_integer(8, 17, random)
    minute = random_integer(0, 59, random)
    created_at = day.replace(hour=hour, minute=minute, second=0, microsecond=0)
    return min(created_at, REFERENCE_DATE)


def _generate_updated_date(created_at: datetime, random: Random) -> datetime:
    minutes_after = random_integer(0, 14 * 24 * 60, random)
    return min(created_at + timedelta(minutes=minutes_after), REFERENCE_DATE)


def _generate_current_version(
    note_index: int,
    status: str,
    random: Random,
) -> Json:
    if status in ("GENERATING", "FAILED"):
        revision = 1
    elif status == "AMENDED":
        revision = random_integer(2, 4, random)
    else:
        revision = random_integer(1, 3, random)

    return {"id": f"note-version-{note_index + 1}-{revision}", "revision": revision}


def generate_note_summaries(count: int = 5_000, seed: int = 42) -> list[Json]:
    if count < 0:
        raise ValueError("Note summary count must be a non-negative integer.")

    random = create_seeded_random(seed)
    patient_count = max(1, min(1_000, ceil(count / 10)))

    patients = []
    for index in range(patient_count):
        first_name = pick_random(FIRST_NAMES, random)
        last_name = pick_random(LAST_NAMES, random)
        patients.append(
            {"id": f"patient-{index + 1}", "displayName": f"{first_name} {last_name}"}
        )

    summaries = []
    for index in range(count):
        # The order of random draws must match the TypeScript generator.
        status = pick_random(STATUSES, random)
        patient = pick_random(patients, random)
        reviewer = (
            pick_random(REVIEWERS, random) if status in STATUSES_WITH_REVIEWER else None
        )
        created_at = _generate_created_date(random)
        updated_at = _generate_updated_date(created_at, random)
        current_version = _generate_current_version(index, status, random)
        content_preview = pick_random(CONTENT_PREVIEW_FRAGMENTS, random)

        summaries.append(
            {
                "id": f"note-{index + 1:06d}",
                "patient": dict(patient),
                "status": status,
                "currentVersion": current_version,
                "assignedReviewer": dict(reviewer) if reviewer else None,
                "contentPreview": content_preview,
                "createdAt": to_iso(created_at),
                "updatedAt": to_iso(updated_at),
            }
        )

    return summaries


# --- Details (generateNoteDetail.ts) ----------------------------------------


@dataclass(frozen=True)
class _TimelineStep:
    from_status: str
    to_status: str
    actor: Json
    reason: str | None = None


def _clinician_for(note_id: str) -> Json:
    return CLINICIANS[(_extract_numeric_id(note_id) - 1) % len(CLINICIANS)]


def _patient_information(summary: Json) -> Json:
    number = _extract_numeric_id(summary["patient"]["id"])
    return {
        "id": summary["patient"]["id"],
        "displayName": summary["patient"]["displayName"],
        "dateOfBirth": f"{1945 + number % 55}-{number % 12 + 1:02d}-"
        f"{number % 28 + 1:02d}",
        "medicalRecordNumber": f"MRN-{number:07d}",
    }


def _session_information(summary: Json, clinician: Json) -> Json:
    ended_at = from_iso(summary["createdAt"])
    return {
        "id": f"session-{_extract_numeric_id(summary['id']):06d}",
        "startedAt": to_iso(ended_at - timedelta(minutes=45)),
        "endedAt": to_iso(ended_at),
        "clinician": dict(clinician),
    }


def _soap_content(summary: Json, revision_number: int) -> Json:
    return {
        "subjective": f"{summary['contentPreview']} "
        "The patient described the current symptoms "
        "and relevant changes since the previous visit.",
        "objective": "Vital signs were reviewed and were stable. "
        "The examination findings were documented "
        f"for revision {revision_number}.",
        "assessment": "The presentation remains consistent with "
        "the documented clinical assessment. "
        "No urgent concerns were identified.",
        "plan": "Continue the current care plan, monitor "
        "symptoms, and complete the recommended "
        "follow-up.",
    }


def _version_id(summary: Json, revision_number: int) -> str:
    current = summary["currentVersion"]
    if revision_number == current["revision"]:
        return current["id"]

    suffix = f"-{current['revision']}"
    if current["id"].endswith(suffix):
        return current["id"][: -len(suffix)] + f"-{revision_number}"

    return f"{summary['id']}-version-{revision_number}"


def _versions(summary: Json, clinician: Json, reviewer: Json | None) -> list[Json]:
    created_at = from_iso(summary["createdAt"])
    versions = []

    for index in range(summary["currentVersion"]["revision"]):
        revision_number = index + 1
        author = clinician if revision_number == 1 or reviewer is None else reviewer
        versions.append(
            {
                "versionId": _version_id(summary, revision_number),
                "noteId": summary["id"],
                "revisionNumber": revision_number,
                "parentVersionId": None
                if revision_number == 1
                else _version_id(summary, revision_number - 1),
                "content": _soap_content(summary, revision_number),
                "authorId": author["id"],
                "authorRole": author["role"],
                "authorDisplayName": author["displayName"],
                "createdAt": to_iso(created_at + timedelta(minutes=5 * index)),
            }
        )

    return versions


def _timeline_steps(
    status: str,
    clinician: Json,
    reviewer: Json | None,
) -> list[_TimelineStep]:
    if status == "GENERATING":
        return []
    if status == "FAILED":
        return [
            _TimelineStep(
                "GENERATING",
                "FAILED",
                clinician,
                "The initial note generation failed.",
            )
        ]

    if reviewer is None:
        raise ValueError(f"A {status} note needs an assigned reviewer.")

    generated = _TimelineStep("GENERATING", "READY_FOR_REVIEW", clinician)
    review_started = _TimelineStep("READY_FOR_REVIEW", "IN_REVIEW", reviewer)
    approved = _TimelineStep("IN_REVIEW", "APPROVED", reviewer)

    steps_by_status = {
        "READY_FOR_REVIEW": [generated],
        "IN_REVIEW": [generated, review_started],
        "REJECTED": [
            generated,
            review_started,
            _TimelineStep(
                "IN_REVIEW",
                "REJECTED",
                reviewer,
                "Changes were requested before approval.",
            ),
        ],
        "APPROVED": [generated, review_started, approved],
        "AMENDED": [
            generated,
            review_started,
            approved,
            _TimelineStep(
                "APPROVED",
                "AMENDED",
                clinician,
                "A post-approval amendment was created.",
            ),
        ],
        "LOCKED": [
            generated,
            review_started,
            approved,
            _TimelineStep(
                "APPROVED",
                "LOCKED",
                ADMIN,
                "The amendment grace period expired.",
            ),
        ],
    }
    return steps_by_status[status]


def _timeline(summary: Json, clinician: Json, reviewer: Json | None) -> list[Json]:
    steps = _timeline_steps(summary["status"], clinician, reviewer)
    created_ms = _epoch_ms(from_iso(summary["createdAt"]))
    updated_ms = _epoch_ms(from_iso(summary["updatedAt"]))
    duration = max(0, updated_ms - created_ms)

    events = []
    for index, step in enumerate(steps):
        progress = (index + 1) / len(steps)
        # JavaScript's Date truncates fractional milliseconds.
        occurred_ms = trunc(created_ms + duration * progress)
        event = {
            "eventId": f"{summary['id']}-event-{index + 1}",
            "noteId": summary["id"],
            "versionId": summary["currentVersion"]["id"],
            "fromStatus": step.from_status,
            "toStatus": step.to_status,
            "actorId": step.actor["id"],
            "actorRole": step.actor["role"],
            "actorDisplayName": step.actor["displayName"],
            "occurredAt": to_iso(_from_epoch_ms(occurred_ms)),
        }
        if step.reason is not None:
            event["reason"] = step.reason
        events.append(event)

    return events


def generate_note_detail(summary: Json) -> Json:
    """The stored part of a note's detail; live presence is not included."""
    clinician = _clinician_for(summary["id"])
    reviewer = (
        {**summary["assignedReviewer"], "role": "REVIEWER"}
        if summary["assignedReviewer"]
        else None
    )
    patient = _patient_information(summary)
    session = _session_information(summary, clinician)
    versions = _versions(summary, clinician, reviewer)
    current_version = versions[-1]

    note = {
        "id": summary["id"],
        "patientId": patient["id"],
        "sessionId": session["id"],
        "status": summary["status"],
        "currentVersionId": current_version["versionId"],
        "assignedReviewerId": reviewer["id"] if reviewer else None,
        "createdAt": summary["createdAt"],
        "updatedAt": summary["updatedAt"],
    }
    if summary["status"] in APPROVED_STATUSES:
        note["approvedAt"] = summary["updatedAt"]

    return {
        "note": note,
        "patient": patient,
        "session": session,
        "assignedReviewer": reviewer,
        "currentVersion": current_version,
        "versions": versions,
        "timeline": _timeline(summary, clinician, reviewer),
    }
