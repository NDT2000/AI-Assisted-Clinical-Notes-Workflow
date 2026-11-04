"""The note workflow rules, read from contract/note-workflow.json.

The frontend implements the same rules from the same file, and both are
tested against contract/note-workflow.cases.json, so the server and the UI
always agree on what is allowed and why.
"""

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import cache
from pathlib import Path
from typing import Any

from clinical_notes_api.config import REPOSITORY_ROOT

WORKFLOW_PATH = REPOSITORY_ROOT / "contract" / "note-workflow.json"


@dataclass(frozen=True)
class Actor:
    id: str
    role: str
    mfa_verified: bool = False


@dataclass(frozen=True)
class NoteState:
    """The parts of a note the rules look at."""

    status: str
    assigned_reviewer_id: str | None
    approved_at: datetime | None = None


@dataclass(frozen=True)
class SoapContent:
    subjective: str
    objective: str
    assessment: str
    plan: str

    def is_complete(self) -> bool:
        return all(
            section.strip()
            for section in (self.subjective, self.objective, self.assessment, self.plan)
        )


@dataclass(frozen=True)
class Decision:
    """allowed with next_status (for transitions), or denied with a reason."""

    allowed: bool
    next_status: str | None = None
    reason: str | None = None


def _allow(next_status: str | None = None) -> Decision:
    return Decision(allowed=True, next_status=next_status)


def _deny(reason: str | None) -> Decision:
    return Decision(allowed=False, reason=reason or "This action is not allowed.")


@cache
def load_workflow(path: Path = WORKFLOW_PATH) -> Mapping[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _format(template: str, **values: str) -> str:
    return re.sub(
        r"\{(\w+)\}",
        lambda match: values.get(match.group(1), match.group(0)),
        template,
    )


def _check_guard(
    guard: Mapping[str, Any],
    note: NoteState,
    actor: Actor,
    content: SoapContent,
    rejection_reason: str | None,
    now: datetime,
) -> Decision:
    """Role first, then reviewer ownership, then the trigger's conditions."""
    messages = guard["messages"]

    if actor.role not in guard["roles"]:
        return _deny(messages["role"])

    reviewer_rule = guard.get("reviewer")
    if reviewer_rule == "assigned" and note.assigned_reviewer_id != actor.id:
        return _deny(messages.get("reviewer"))
    if (
        reviewer_rule == "unassignedOrAssigned"
        and note.assigned_reviewer_id is not None
        and note.assigned_reviewer_id != actor.id
    ):
        return _deny(messages.get("reviewer"))

    if guard.get("requireMfa") and not actor.mfa_verified:
        return _deny(messages.get("mfa"))

    if guard.get("requireRejectionReason") and not (rejection_reason or "").strip():
        return _deny(messages.get("rejectionReason"))

    if guard.get("requireCompleteContent") and not content.is_complete():
        return _deny(messages.get("content"))

    hours = guard.get("withinHoursOfApproval")
    if hours is not None:
        if note.approved_at is None:
            return _deny(messages.get("approvalMissing"))
        if now > note.approved_at + timedelta(hours=hours):
            return _deny(messages.get("approvalWindow"))

    return _allow()


def can_transition(
    note: NoteState,
    trigger: str,
    actor: Actor,
    content: SoapContent,
    now: datetime,
    rejection_reason: str | None = None,
) -> Decision:
    workflow = load_workflow()

    if note.status == workflow["lockedStatus"]:
        return _deny(workflow["messages"]["locked"])

    next_status = workflow["transitions"].get(note.status, {}).get(trigger)
    if next_status is None:
        return _deny(
            _format(
                workflow["messages"]["notAllowed"],
                trigger=trigger,
                status=note.status,
            )
        )

    guard = workflow["guards"].get(trigger)
    if guard is not None:
        decision = _check_guard(guard, note, actor, content, rejection_reason, now)
        if not decision.allowed:
            return decision

    return _allow(next_status)


def can_edit_note_content(note: NoteState, actor: Actor) -> Decision:
    rules = load_workflow()["contentEditing"]

    denied_message = rules["deniedRoles"].get(actor.role)
    if denied_message is not None:
        return _deny(denied_message)

    if note.status == load_workflow()["lockedStatus"]:
        return _deny(rules["lockedMessage"])

    rule = rules["byRole"].get(actor.role)
    if rule is None:
        return _deny(rules["defaultMessage"])

    if note.status not in rule["statuses"]:
        return _deny(rule["statusMessage"])

    if rule.get("assignedReviewerOnly") and note.assigned_reviewer_id != actor.id:
        return _deny(rule.get("assignedReviewerMessage"))

    return _allow()


def can_manage_reviewer_assignments(role: str) -> Decision:
    rule = load_workflow()["reviewerAssignment"]
    if role not in rule["roles"]:
        return _deny(rule["roleMessage"])
    return _allow()


def can_assign_reviewer(status: str, role: str) -> Decision:
    role_decision = can_manage_reviewer_assignments(role)
    if not role_decision.allowed:
        return role_decision

    rule = load_workflow()["reviewerAssignment"]
    if status not in rule["statuses"]:
        return _deny(rule["statusMessage"])
    return _allow()


def can_request_regeneration(status: str, role: str) -> Decision:
    """For bulk regeneration, where only the status and role are known."""
    workflow = load_workflow()
    rule = workflow["regeneration"]
    trigger = rule["trigger"]

    next_status = workflow["transitions"].get(status, {}).get(trigger)
    if next_status is None:
        return _deny(rule["statusMessage"])

    guard = workflow["guards"].get(trigger)
    if guard is not None and role not in guard["roles"]:
        return _deny(guard["messages"]["role"])

    return _allow(next_status)
