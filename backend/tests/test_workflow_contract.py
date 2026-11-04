"""The backend's workflow rules must reproduce every decision recorded in
contract/note-workflow.cases.json. The frontend runs the same cases.

Case codes are turned into inputs the same way as in
contract/workflowCaseInputs.ts.
"""

import json
from datetime import datetime, timedelta

import pytest

from clinical_notes_api.config import REPOSITORY_ROOT
from clinical_notes_api.workflow import (
    Actor,
    Decision,
    NoteState,
    SoapContent,
    can_assign_reviewer,
    can_edit_note_content,
    can_request_regeneration,
    can_transition,
    load_workflow,
)

CASES = json.loads(
    (REPOSITORY_ROOT / "contract" / "note-workflow.cases.json").read_text(
        encoding="utf-8"
    )
)
NOW = datetime.fromisoformat(CASES["now"].replace("Z", "+00:00"))

ACTOR_ID = "actor-1"
OTHER_REVIEWER_ID = "reviewer-other"
APPROVAL_HOURS_AGO = {"1h": 1, "24h": 24, "25h": 25}
REJECTION_REASONS = {"given": "Vitals are missing.", "blank": "   ", "none": None}


def build_inputs(
    status: str,
    role: str,
    assignment: str,
    mfa: bool = True,
    approval: str = "1h",
    content: str = "complete",
) -> tuple[NoteState, Actor, SoapContent]:
    note = NoteState(
        status=status,
        assigned_reviewer_id={
            "none": None,
            "self": ACTOR_ID,
            "other": OTHER_REVIEWER_ID,
        }[assignment],
        approved_at=None
        if approval == "missing"
        else NOW - timedelta(hours=APPROVAL_HOURS_AGO[approval]),
    )
    soap = SoapContent(
        subjective="Reported symptoms.",
        objective="Stable vitals.",
        assessment="Improving.",
        plan="   " if content == "blankPlan" else "Follow up in two weeks.",
    )
    return note, Actor(id=ACTOR_ID, role=role, mfa_verified=mfa), soap


def encode(decision: Decision) -> str | int | bool:
    if decision.allowed:
        return decision.next_status or True
    if decision.reason not in CASES["messages"]:
        return f"unknown message: {decision.reason}"
    return CASES["messages"].index(decision.reason)


def test_definition_matches_the_case_dimensions() -> None:
    workflow = load_workflow()

    assert {row[0] for row in CASES["transitions"]} == set(workflow["statuses"])
    assert {row[1] for row in CASES["transitions"]} == set(workflow["triggers"])
    assert {row[2] for row in CASES["transitions"]} == set(workflow["roles"])


def test_every_transition_decision_matches() -> None:
    failures = []

    for row in CASES["transitions"]:
        status, trigger, role, assignment, mfa, reason, content, approval, expected = (
            row
        )
        note, actor, soap = build_inputs(
            status, role, assignment, mfa=mfa, approval=approval, content=content
        )
        actual = encode(
            can_transition(
                note,
                trigger,
                actor,
                soap,
                NOW,
                rejection_reason=REJECTION_REASONS[reason],
            )
        )
        if actual != expected:
            failures.append(f"{row[:-1]}: expected {expected}, got {actual}")

    assert failures[:20] == []


@pytest.mark.parametrize(
    "row",
    CASES["editing"],
    ids=lambda row: f"{row[0]}-{row[1]}-{row[2]}",
)
def test_content_editing_decision_matches(row: list) -> None:
    status, role, assignment, expected = row
    note, actor, _ = build_inputs(status, role, assignment)

    assert encode(can_edit_note_content(note, actor)) == expected


@pytest.mark.parametrize(
    "row",
    CASES["reviewerAssignment"],
    ids=lambda row: f"{row[0]}-{row[1]}",
)
def test_reviewer_assignment_decision_matches(row: list) -> None:
    status, role, expected = row

    assert encode(can_assign_reviewer(status, role)) == expected


@pytest.mark.parametrize(
    "row",
    CASES["regeneration"],
    ids=lambda row: f"{row[0]}-{row[1]}",
)
def test_regeneration_decision_matches(row: list) -> None:
    status, role, expected = row

    assert encode(can_request_regeneration(status, role)) == expected


def test_database_constraints_use_the_contract_values() -> None:
    from clinical_notes_api.db.models import NOTE_STATUSES, USER_ROLES

    workflow = load_workflow()

    assert list(NOTE_STATUSES) == workflow["statuses"]
    assert list(USER_ROLES) == workflow["roles"]
