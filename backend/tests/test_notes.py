"""The note, patient and telemetry endpoints, against a real database.

Uses the note API fixtures from conftest.py: 60 seeded notes, and every test
runs in a transaction that is rolled back afterwards.
"""

import base64
import json
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Text, literal, select, text, update
from sqlalchemy.orm import Session

from clinical_notes_api.db import (
    ClientMutation,
    ClinicalSession,
    Note,
    NoteVersion,
    ReviewEvent,
    User,
)
from clinical_notes_api.notes.queries import (
    EMPTY_PREVIEW,
    MAX_SEARCH_TERMS,
    content_preview_expression,
    full_text_query,
    search_terms,
)
from clinical_notes_api.seed.mock_data import (
    generate_note_detail,
    generate_note_summaries,
)
from tests.note_api import NOTE_COUNT, SEED, content, current_version_id

SUMMARIES = generate_note_summaries(NOTE_COUNT, SEED)
SUMMARIES_BY_ID = {summary["id"]: summary for summary in SUMMARIES}

# Seeded notes this module relies on (see generate_note_summaries(60, 42)).
APPROVED_NOTE = "note-000001"  # approved long ago: outside the amend window
FAILED_NOTE = "note-000002"
IN_REVIEW_NOTE = "note-000003"  # reviewer-1
LOCKED_NOTE = "note-000006"
REJECTED_NOTE = "note-000008"  # reviewer-2
READY_NOTE = "note-000012"  # reviewer-2


def expected_detail(note_id: str) -> dict[str, Any]:
    """The mock server's detail for a seeded note, as the database holds it."""
    detail = generate_note_detail(SUMMARIES_BY_ID[note_id])
    # users is the one source of names; the mock detail calls admin-1
    # "Jordan Taylor".
    for event in detail["timeline"]:
        if event["actorId"] == "admin-1":
            event["actorDisplayName"] = "Jordan Lee"
    return {**detail, "presence": []}


# --- Authentication --------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/notes"),
        ("GET", f"/api/notes/{READY_NOTE}"),
        ("GET", "/api/patients"),
        ("POST", f"/api/notes/{READY_NOTE}/versions"),
        ("POST", f"/api/notes/{READY_NOTE}/transitions"),
        ("POST", "/api/notes/bulk/assign-reviewer"),
        ("POST", "/api/notes/bulk/regenerate"),
        ("POST", "/api/telemetry"),
    ],
)
def test_every_endpoint_requires_sign_in(
    client: TestClient,
    method: str,
    path: str,
) -> None:
    response = client.request(method, path, json={})

    assert response.status_code == 401
    assert response.json()["error"] == "unauthenticated"


# --- List ------------------------------------------------------------------


def all_notes(client: TestClient, headers: dict, **params: Any) -> list[dict]:
    response = client.get(
        "/api/notes",
        params={"limit": 100, **params},
        headers=headers,
    )
    assert response.status_code == 200
    return response.json()["items"]


def test_list_items_match_the_mock_server(client: TestClient, as_user) -> None:
    items = all_notes(client, as_user("clinician-1"))

    assert len(items) == NOTE_COUNT
    for item in items:
        assert item == SUMMARIES_BY_ID[item["id"]]


def test_list_defaults_to_twenty_by_latest_update(
    client: TestClient,
    as_user,
) -> None:
    body = client.get("/api/notes", headers=as_user("clinician-1")).json()

    expected = sorted(SUMMARIES, key=lambda s: (s["updatedAt"], s["id"]), reverse=True)
    assert [item["id"] for item in body["items"]] == [s["id"] for s in expected[:20]]
    assert body["cursor"]["hasMore"] is True
    assert body["cursor"]["next"]
    assert body["meta"] == {"total": NOTE_COUNT, "returned": 20}


@pytest.mark.parametrize("sort_by", ["createdAt", "updatedAt", "patientName", "status"])
@pytest.mark.parametrize("sort_order", ["asc", "desc"])
def test_cursor_pages_cover_every_note_once_in_order(
    client: TestClient,
    as_user,
    sort_by: str,
    sort_order: str,
) -> None:
    headers = as_user("clinician-1")
    params = {"sortBy": sort_by, "sortOrder": sort_order}
    one_page = [item["id"] for item in all_notes(client, headers, **params)]

    paged: list[str] = []
    cursor = None
    while True:
        body = client.get(
            "/api/notes",
            params={**params, "limit": 7, **({"cursor": cursor} if cursor else {})},
            headers=headers,
        ).json()
        paged.extend(item["id"] for item in body["items"])
        cursor = body["cursor"]["next"]
        if not body["cursor"]["hasMore"]:
            assert cursor is None
            break

    assert paged == one_page
    assert len(set(paged)) == NOTE_COUNT


def test_list_filters_match_the_mock_server(client: TestClient, as_user) -> None:
    headers = as_user("clinician-1")

    def ids(**params: Any) -> set[str]:
        return {item["id"] for item in all_notes(client, headers, **params)}

    def expected(predicate) -> set[str]:
        return {s["id"] for s in SUMMARIES if predicate(s)}

    assert ids(status=["FAILED", "LOCKED"]) == expected(
        lambda s: s["status"] in ("FAILED", "LOCKED")
    )
    assert ids(reviewerId=["reviewer-1", "reviewer-2"]) == expected(
        lambda s: (
            s["assignedReviewer"]
            and s["assignedReviewer"]["id"] in ("reviewer-1", "reviewer-2")
        )
    )
    patient = SUMMARIES[0]["patient"]
    assert ids(patientId=patient["id"]) == expected(
        lambda s: s["patient"]["id"] == patient["id"]
    )

    day = SUMMARIES[0]["createdAt"][:10]
    assert ids(createdFrom=day, createdTo=day) == expected(
        lambda s: s["createdAt"][:10] == day
    )
    assert ids(createdFrom=day) == expected(lambda s: s["createdAt"][:10] >= day)


def search(client: TestClient, headers: dict, q: str) -> set[str]:
    return {item["id"] for item in all_notes(client, headers, q=q)}


def name_words(summary: dict) -> list[str]:
    return summary["patient"]["displayName"].lower().split()


def test_search_matches_names_by_word_prefix(client: TestClient, as_user) -> None:
    headers = as_user("clinician-1")
    first, last = SUMMARIES[0]["patient"]["displayName"].split()

    full_name = search(client, headers, f"{first.upper()} {last}")
    prefix = search(client, headers, last[:-2])

    assert full_name == {
        s["id"] for s in SUMMARIES if s["patient"]["displayName"] == f"{first} {last}"
    }
    assert prefix == {
        s["id"]
        for s in SUMMARIES
        if any(word.startswith(last[:-2].lower()) for word in name_words(s))
    }


@pytest.mark.parametrize(
    ("q", "fragment_word"),
    [
        ("adherence", "adherence"),
        ("improving", "improvement"),  # stemmed: both become "improv"
        ("LAB results", "lab"),
    ],
)
def test_search_matches_note_text_with_stemming(
    client: TestClient,
    as_user,
    q: str,
    fragment_word: str,
) -> None:
    found = search(client, as_user("clinician-1"), q)

    expected = {
        s["id"] for s in SUMMARIES if fragment_word in s["contentPreview"].lower()
    }
    assert expected
    assert found == expected


def test_every_search_word_must_match(client: TestClient, as_user) -> None:
    headers = as_user("clinician-1")
    first = SUMMARIES[0]["patient"]["displayName"].split()[0]

    found = search(client, headers, f"{first} adherence")

    assert found == search(client, headers, first) & search(
        client, headers, "adherence"
    )


@pytest.mark.parametrize("q", ["%", "  ", "'&|!:*()"])
def test_search_without_words_lists_everything(
    client: TestClient,
    as_user,
    q: str,
) -> None:
    assert len(search(client, as_user("clinician-1"), q)) == NOTE_COUNT


def test_search_follows_the_current_version(client: TestClient, as_user) -> None:
    headers = as_user("clinician-1")
    old_word = max(
        SUMMARIES_BY_ID[REJECTED_NOTE]["contentPreview"].strip(".,").split(),
        key=len,
    )
    assert REJECTED_NOTE in search(client, headers, old_word)

    save(
        client,
        headers,
        REJECTED_NOTE,
        baseVersionId=current_version_id(client, headers, REJECTED_NOTE),
        clientMutationId="search-me",
        content=content(plan="Refer to the zebrafish clinic."),
    )

    assert search(client, headers, "zebrafish") == {REJECTED_NOTE}
    assert REJECTED_NOTE not in search(client, headers, old_word)


def test_search_terms_are_words_only() -> None:
    assert search_terms("Avery O'Brien, follow_up 2x!") == [
        "avery",
        "o",
        "brien",
        "follow",
        "up",
        "2x",
    ]
    assert len(search_terms(" ".join(["word"] * 50))) == MAX_SEARCH_TERMS


def test_search_uses_the_gin_index(db: Session) -> None:
    db.execute(text("SET LOCAL enable_seqscan = off"))
    query = select(Note.id).where(
        Note.search_vector.op("@@")(full_text_query("avery adherence"))
    )
    compiled = query.compile(
        dialect=db.get_bind().dialect,
        compile_kwargs={"literal_binds": True},
    )

    plan = db.execute(text(f"EXPLAIN {compiled}")).scalars().all()

    assert any("ix_notes_search_vector" in line for line in plan)


def test_list_rejects_unknown_values_and_caps_the_limit(
    client: TestClient,
    as_user,
) -> None:
    headers = as_user("clinician-1")

    bad_status = client.get("/api/notes?status=DONE", headers=headers)
    assert bad_status.status_code == 400
    assert bad_status.json()["error"] == "invalid_request"

    capped = client.get("/api/notes?limit=500", headers=headers).json()
    assert capped["meta"]["returned"] == NOTE_COUNT  # under the cap of 100

    first_page = client.get("/api/notes", headers=headers).json()["items"]
    unreadable = client.get("/api/notes?cursor=not-a-cursor", headers=headers)
    assert unreadable.json()["items"] == first_page


def page_through(
    client: TestClient,
    headers: dict,
    sort_by: str,
    between_pages=None,
) -> list[str]:
    """Every id the list returns, page by page; runs between_pages once."""
    ids: list[str] = []
    cursor = None
    while True:
        params = {"sortBy": sort_by, "limit": 10}
        if cursor:
            params["cursor"] = cursor
        body = client.get("/api/notes", params=params, headers=headers).json()
        ids.extend(item["id"] for item in body["items"])
        if between_pages is not None:
            between_pages(ids)
            between_pages = None
        cursor = body["cursor"]["next"]
        if not body["cursor"]["hasMore"]:
            return ids


@pytest.mark.parametrize("sort_by", ["updatedAt", "createdAt"])
def test_pages_stay_consistent_while_a_note_changes(
    client: TestClient,
    as_user,
    sort_by: str,
) -> None:
    headers = as_user("clinician-1")
    order = [item["id"] for item in all_notes(client, headers, sortBy=sort_by)]
    # A note further down that a clinician may edit.
    changed = next(
        note_id
        for note_id in order[20:]
        if SUMMARIES_BY_ID[note_id]["status"] in ("REJECTED", "AMENDED")
    )

    def edit_changed_note(_seen: list[str]) -> None:
        save(
            client,
            headers,
            changed,
            baseVersionId=current_version_id(client, headers, changed),
            clientMutationId="edited-while-paging",
            content=content(),
        )

    ids = page_through(client, headers, sort_by, between_pages=edit_changed_note)

    assert len(ids) == len(set(ids)), "a note was listed twice"
    if sort_by == "updatedAt":
        # The edit moved the note to the top, behind the cursor: it is not
        # listed again, and nothing else is skipped.
        assert set(ids) == set(order) - {changed}
    else:
        # Creation time does not change, so every note is still listed once.
        assert set(ids) == set(order)


def test_note_without_content_is_not_listed_or_opened(
    client: TestClient,
    as_user,
    db: Session,
) -> None:
    template = db.get(Note, READY_NOTE)
    assert template is not None
    db.add(
        ClinicalSession(
            id="session-empty",
            patient_id=template.patient_id,
            clinician_id="clinician-1",
            started_at=template.created_at,
            ended_at=template.created_at,
        )
    )
    db.add(
        Note(
            id="note-empty",
            patient_id=template.patient_id,
            session_id="session-empty",
            # A status the clinician may edit, so a save gets past the
            # permission check to the missing content.
            status="REJECTED",
            current_version_id=None,
            created_at=template.created_at,
            updated_at=template.created_at,
        )
    )
    db.commit()
    headers = as_user("clinician-1")

    listed = {item["id"] for item in all_notes(client, headers)}
    detail = client.get("/api/notes/note-empty", headers=headers)
    saved = save(
        client,
        headers,
        "note-empty",
        baseVersionId="none",
        clientMutationId="m",
        content=content(),
    )

    assert "note-empty" not in listed
    assert detail.status_code == 404
    assert detail.json()["message"] == "Note note-empty has no content yet."
    assert saved.status_code == 404
    assert saved.json()["message"] == "Note note-empty has no content yet."


def test_cursor_from_another_sort_starts_over(client: TestClient, as_user) -> None:
    headers = as_user("clinician-1")
    cursor = base64.urlsafe_b64encode(
        json.dumps(
            {"sortBy": "createdAt", "sortValue": "Zed", "id": "note-000001"}
        ).encode()
    ).decode()

    response = client.get(
        "/api/notes",
        params={"sortBy": "patientName", "cursor": cursor},
        headers=headers,
    )

    first_page = client.get(
        "/api/notes", params={"sortBy": "patientName"}, headers=headers
    )
    assert response.json()["items"] == first_page.json()["items"]


@pytest.mark.parametrize(
    ("sections", "preview"),
    [
        (("First. Second.", "x", "x", "x"), "First."),
        (("  ", "\nObjective only", "x", "x"), "Objective only"),
        (("Why? Because.", "", "", ""), "Why?"),
        (("", "", "", ""), EMPTY_PREVIEW),
        (("a" * 130, "", "", ""), "a" * 117 + "..."),
    ],
)
def test_content_preview(db: Session, sections: tuple, preview: str) -> None:
    expression = content_preview_expression(
        [literal(section, type_=Text) for section in sections]
    )

    assert db.scalar(select(expression)) == preview


# --- Detail ----------------------------------------------------------------


def test_detail_matches_the_mock_server_for_every_note(
    client: TestClient,
    as_user,
) -> None:
    headers = as_user("auditor-1")

    for summary in SUMMARIES:
        response = client.get(f"/api/notes/{summary['id']}", headers=headers)
        assert response.status_code == 200
        assert response.json() == expected_detail(summary["id"])


def test_detail_of_unknown_note_is_not_found(client: TestClient, as_user) -> None:
    response = client.get("/api/notes/note-999999", headers=as_user("clinician-1"))

    assert response.status_code == 404
    assert response.json() == {
        "error": "not_found",
        "message": "Note note-999999 was not found.",
    }


# --- Saving a version ------------------------------------------------------


def save(client: TestClient, headers: dict, note_id: str, **body: Any):
    return client.post(f"/api/notes/{note_id}/versions", json=body, headers=headers)


def test_save_creates_the_next_version(
    client: TestClient,
    as_user,
    db: Session,
) -> None:
    headers = as_user("clinician-2")
    base = current_version_id(client, headers, REJECTED_NOTE)
    revision = int(base.rsplit("-", 1)[1])

    response = save(
        client,
        headers,
        REJECTED_NOTE,
        baseVersionId=base,
        clientMutationId="save-1",
        content=content(),
    )

    assert response.status_code == 201
    body = response.json()
    saved = body["savedVersion"]
    assert body["clientMutationId"] == "save-1"
    assert saved["versionId"] == f"note-version-8-{revision + 1}"
    assert saved["revisionNumber"] == revision + 1
    assert saved["parentVersionId"] == base
    assert saved["content"] == content()
    assert saved["authorId"] == "clinician-2"
    assert saved["authorRole"] == "CLINICIAN"
    assert saved["authorDisplayName"] == "Dr. Noah Chen"
    assert body["note"]["currentVersionId"] == saved["versionId"]
    assert body["note"]["updatedAt"] == saved["createdAt"]

    detail = client.get(f"/api/notes/{REJECTED_NOTE}", headers=headers).json()
    assert detail["currentVersion"] == saved
    assert detail["versions"][-1] == saved

    listed = all_notes(client, headers, patientId=detail["patient"]["id"])
    item = next(i for i in listed if i["id"] == REJECTED_NOTE)
    assert item["contentPreview"] == "Patient feels better."
    assert item["currentVersion"] == {
        "id": saved["versionId"],
        "revision": revision + 1,
    }


def test_retried_save_returns_the_first_answer(
    client: TestClient,
    as_user,
    db: Session,
) -> None:
    headers = as_user("clinician-1")
    body = {
        "baseVersionId": current_version_id(client, headers, REJECTED_NOTE),
        "clientMutationId": "retry-me",
        "content": content(),
    }

    first = save(client, headers, REJECTED_NOTE, **body)
    second = save(client, headers, REJECTED_NOTE, **body)

    assert second.status_code == 201
    assert second.json() == first.json()
    versions = db.scalars(
        select(NoteVersion).where(NoteVersion.note_id == REJECTED_NOTE)
    ).all()
    assert (
        len(versions)
        == SUMMARIES_BY_ID[REJECTED_NOTE]["currentVersion"]["revision"] + 1
    )
    assert db.get(ClientMutation, (REJECTED_NOTE, "SAVE_VERSION", "retry-me"))


def test_reused_mutation_id_with_other_content_is_refused(
    client: TestClient,
    as_user,
) -> None:
    headers = as_user("clinician-1")
    base = current_version_id(client, headers, REJECTED_NOTE)
    save(
        client,
        headers,
        REJECTED_NOTE,
        baseVersionId=base,
        clientMutationId="once",
        content=content(),
    )

    response = save(
        client,
        headers,
        REJECTED_NOTE,
        baseVersionId=base,
        clientMutationId="once",
        content=content(plan="Something else."),
    )

    assert response.status_code == 409
    assert response.json() == {
        "error": "idempotency_conflict",
        "message": "This clientMutationId has already been used for a different "
        "save request.",
    }


def test_same_mutation_id_from_another_user_is_refused(
    client: TestClient,
    as_user,
) -> None:
    body = {
        "baseVersionId": current_version_id(
            client, as_user("clinician-1"), REJECTED_NOTE
        ),
        "clientMutationId": "shared-id",
        "content": content(),
    }
    save(client, as_user("clinician-1"), REJECTED_NOTE, **body)

    response = save(client, as_user("clinician-2"), REJECTED_NOTE, **body)

    assert response.json()["error"] == "idempotency_conflict"


def test_save_on_a_stale_version_returns_the_conflict(
    client: TestClient,
    as_user,
) -> None:
    headers = as_user("clinician-1")
    base = current_version_id(client, headers, REJECTED_NOTE)
    first = save(
        client,
        headers,
        REJECTED_NOTE,
        baseVersionId=base,
        clientMutationId="first",
        content=content(),
    ).json()

    response = save(
        client,
        headers,
        REJECTED_NOTE,
        baseVersionId=base,
        clientMutationId="second",
        content=content(plan="Mine."),
    )

    assert response.status_code == 409
    body = response.json()
    assert body["error"] == "version_conflict"
    assert body["message"] == "The note has been updated since this draft was opened."
    assert body["currentVersion"] == first["savedVersion"]
    assert body["commonAncestor"]["versionId"] == base


def test_conflict_with_an_unknown_base_has_no_common_ancestor(
    client: TestClient,
    as_user,
) -> None:
    response = save(
        client,
        as_user("clinician-1"),
        REJECTED_NOTE,
        baseVersionId="not-a-version",
        clientMutationId="unknown-base",
        content=content(),
    )

    assert response.status_code == 409
    assert response.json()["commonAncestor"] is None


@pytest.mark.parametrize(
    ("user_id", "note_id", "message"),
    [
        ("auditor-1", REJECTED_NOTE, "Read-only auditors cannot edit note content."),
        ("clinician-1", LOCKED_NOTE, "Locked notes are read-only."),
        (
            "reviewer-2",
            IN_REVIEW_NOTE,
            "Only the assigned reviewer can edit this note.",
        ),
        (
            "clinician-1",
            IN_REVIEW_NOTE,
            "Clinicians can edit rejected or amended notes.",
        ),
    ],
)
def test_save_follows_the_editing_rules(
    client: TestClient,
    as_user,
    user_id: str,
    note_id: str,
    message: str,
) -> None:
    headers = as_user(user_id)

    response = save(
        client,
        headers,
        note_id,
        baseVersionId=current_version_id(client, headers, note_id),
        clientMutationId="not-allowed",
        content=content(),
    )

    assert response.status_code == 403
    assert response.json() == {"error": "forbidden", "message": message}


def test_assigned_reviewer_can_edit_a_note_in_review(
    client: TestClient,
    as_user,
) -> None:
    headers = as_user("reviewer-1")

    response = save(
        client,
        headers,
        IN_REVIEW_NOTE,
        baseVersionId=current_version_id(client, headers, IN_REVIEW_NOTE),
        clientMutationId="review-edit",
        content=content(),
    )

    assert response.status_code == 201
    assert response.json()["savedVersion"]["authorRole"] == "REVIEWER"


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"baseVersionId": "v", "clientMutationId": "m"},
        {"baseVersionId": " ", "clientMutationId": "m", "content": content()},
        {"baseVersionId": "v", "clientMutationId": "", "content": content()},
        {"baseVersionId": "v", "clientMutationId": "m", "content": {"plan": "x"}},
    ],
)
def test_save_rejects_malformed_requests(
    client: TestClient,
    as_user,
    body: dict,
) -> None:
    response = save(client, as_user("clinician-1"), REJECTED_NOTE, **body)

    assert response.status_code == 400
    assert response.json()["error"] == "invalid_request"
    assert response.json()["message"].startswith("The request is invalid.")


def test_save_to_unknown_note_is_not_found(client: TestClient, as_user) -> None:
    response = save(
        client,
        as_user("clinician-1"),
        "note-999999",
        baseVersionId="v",
        clientMutationId="m",
        content=content(),
    )

    assert response.status_code == 404


# --- Transitions -----------------------------------------------------------


def transition(
    client: TestClient,
    headers: dict,
    note_id: str,
    trigger: str,
    mutation_id: str = "action-1",
    **extra: Any,
):
    return client.post(
        f"/api/notes/{note_id}/transitions",
        json={
            "baseVersionId": current_version_id(client, headers, note_id),
            "clientMutationId": mutation_id,
            "trigger": trigger,
            **extra,
        },
        headers=headers,
    )


def test_start_review_assigns_the_reviewer_and_records_it(
    client: TestClient,
    as_user,
) -> None:
    headers = as_user("reviewer-2")

    response = transition(client, headers, READY_NOTE, "START_REVIEW")

    assert response.status_code == 200
    body = response.json()
    assert body["note"]["status"] == "IN_REVIEW"
    assert body["note"]["assignedReviewerId"] == "reviewer-2"
    event = body["timelineEvent"]
    assert event["fromStatus"] == "READY_FOR_REVIEW"
    assert event["toStatus"] == "IN_REVIEW"
    assert event["actorId"] == "reviewer-2"
    assert event["actorDisplayName"] == "Sam Rivera"
    assert event["versionId"] == body["currentVersion"]["versionId"]
    assert "reason" not in event
    assert event["occurredAt"] == body["note"]["updatedAt"]

    detail = client.get(f"/api/notes/{READY_NOTE}", headers=headers).json()
    assert detail["timeline"][-1] == event
    assert detail["note"] == body["note"]
    assert detail["assignedReviewer"] == {
        "id": "reviewer-2",
        "displayName": "Sam Rivera",
        "role": "REVIEWER",
    }


def test_rule_violations_get_the_workflow_reason(
    client: TestClient,
    as_user,
) -> None:
    response = transition(client, as_user("reviewer-1"), READY_NOTE, "START_REVIEW")

    assert response.status_code == 422
    assert response.json()["error"] == "transition_not_allowed"
    assert response.json()["message"]


def test_approve_sets_the_approval_time(client: TestClient, as_user) -> None:
    response = transition(client, as_user("reviewer-1"), IN_REVIEW_NOTE, "APPROVE")

    assert response.status_code == 200
    note = response.json()["note"]
    assert note["status"] == "APPROVED"
    assert note["approvedAt"] == note["updatedAt"]
    assert note["assignedReviewerId"] == "reviewer-1"


def test_approve_requires_mfa_from_the_database(
    client: TestClient,
    as_user,
    db: Session,
) -> None:
    db.execute(update(User).where(User.id == "reviewer-1").values(mfa_enabled=False))
    db.commit()

    response = transition(client, as_user("reviewer-1"), IN_REVIEW_NOTE, "APPROVE")

    assert response.status_code == 422
    assert response.json()["error"] == "transition_not_allowed"


def test_reject_needs_a_reason_and_records_it(client: TestClient, as_user) -> None:
    headers = as_user("reviewer-1")

    missing = transition(client, headers, IN_REVIEW_NOTE, "REJECT", "r1")
    rejected = transition(
        client,
        headers,
        IN_REVIEW_NOTE,
        "REJECT",
        "r2",
        rejectionReason="  Plan is incomplete.  ",
    )

    assert missing.status_code == 422
    assert rejected.status_code == 200
    assert rejected.json()["timelineEvent"]["reason"] == "Plan is incomplete."
    assert rejected.json()["note"]["status"] == "REJECTED"


def test_resubmit_releases_the_reviewer(client: TestClient, as_user) -> None:
    response = transition(client, as_user("clinician-1"), REJECTED_NOTE, "RESUBMIT")

    assert response.status_code == 200
    assert response.json()["note"]["status"] == "READY_FOR_REVIEW"
    assert response.json()["note"]["assignedReviewerId"] is None


def test_transition_on_a_stale_version_returns_the_current_one(
    client: TestClient,
    as_user,
) -> None:
    headers = as_user("reviewer-1")
    detail = client.get(f"/api/notes/{IN_REVIEW_NOTE}", headers=headers).json()

    response = client.post(
        f"/api/notes/{IN_REVIEW_NOTE}/transitions",
        json={
            "baseVersionId": "stale",
            "clientMutationId": "stale-action",
            "trigger": "APPROVE",
        },
        headers=headers,
    )

    assert response.status_code == 409
    assert response.json() == {
        "error": "version_conflict",
        "message": "The note version is stale. Save or reload the latest version "
        "before running this action.",
        "currentVersion": detail["currentVersion"],
    }


def test_retried_transition_returns_the_first_answer(
    client: TestClient,
    as_user,
    db: Session,
) -> None:
    headers = as_user("reviewer-2")
    body = {
        "baseVersionId": current_version_id(client, headers, READY_NOTE),
        "clientMutationId": "start-once",
        "trigger": "START_REVIEW",
    }
    path = f"/api/notes/{READY_NOTE}/transitions"

    first = client.post(path, json=body, headers=headers)
    # The note is IN_REVIEW now, so running it again would be refused.
    second = client.post(path, json=body, headers=headers)
    reused = client.post(path, json={**body, "trigger": "APPROVE"}, headers=headers)

    assert second.status_code == 200
    assert second.json() == first.json()
    assert reused.status_code == 409
    assert reused.json()["error"] == "idempotency_conflict"
    events = db.scalars(
        select(ReviewEvent).where(ReviewEvent.note_id == READY_NOTE)
    ).all()
    assert [event.to_status for event in events].count("IN_REVIEW") == 1


def test_transition_rejects_unknown_triggers(client: TestClient, as_user) -> None:
    response = transition(client, as_user("admin-1"), READY_NOTE, "GRACE_EXPIRED")

    assert response.status_code == 400
    assert response.json()["error"] == "invalid_request"


# --- Bulk actions ----------------------------------------------------------


def test_admin_assigns_a_reviewer_where_the_status_allows(
    client: TestClient,
    as_user,
    db: Session,
) -> None:
    response = client.post(
        "/api/notes/bulk/assign-reviewer",
        json={
            "noteIds": [READY_NOTE, LOCKED_NOTE, "note-999999", READY_NOTE],
            "reviewerId": "reviewer-5",
            "reviewerDisplayName": "Ignored Name",
        },
        headers=as_user("admin-1"),
    )

    assert response.status_code == 200
    assert response.json() == {"updated": [READY_NOTE]}
    assert db.get(Note, READY_NOTE).assigned_reviewer_id == "reviewer-5"
    assert db.get(Note, LOCKED_NOTE).assigned_reviewer_id != "reviewer-5"


def test_reviewer_can_be_unassigned(client: TestClient, as_user, db: Session) -> None:
    response = client.post(
        "/api/notes/bulk/assign-reviewer",
        json={"noteIds": [READY_NOTE], "reviewerId": None},
        headers=as_user("clinician-1"),
    )

    assert response.json() == {"updated": [READY_NOTE]}
    assert db.get(Note, READY_NOTE).assigned_reviewer_id is None


def test_only_clinicians_and_admins_assign_reviewers(
    client: TestClient,
    as_user,
) -> None:
    response = client.post(
        "/api/notes/bulk/assign-reviewer",
        json={"noteIds": [READY_NOTE], "reviewerId": "reviewer-1"},
        headers=as_user("reviewer-1"),
    )

    assert response.status_code == 403
    assert response.json() == {
        "error": "forbidden",
        "message": "Only a Clinician or an Administrator can assign reviewers.",
    }


def test_assigned_reviewer_must_be_a_reviewer(client: TestClient, as_user) -> None:
    response = client.post(
        "/api/notes/bulk/assign-reviewer",
        json={"noteIds": [READY_NOTE], "reviewerId": "clinician-2"},
        headers=as_user("admin-1"),
    )

    assert response.status_code == 400
    assert response.json()["error"] == "invalid_request"


def test_regenerate_moves_failed_notes_and_records_it(
    client: TestClient,
    as_user,
    db: Session,
) -> None:
    response = client.post(
        "/api/notes/bulk/regenerate",
        json={"noteIds": [FAILED_NOTE, READY_NOTE, "note-999999"]},
        headers=as_user("clinician-3"),
    )

    assert response.status_code == 200
    assert response.json() == {
        "updated": [FAILED_NOTE],
        "skipped": [READY_NOTE, "note-999999"],
    }
    assert db.get(Note, FAILED_NOTE).status == "GENERATING"
    assert db.get(Note, READY_NOTE).status == "READY_FOR_REVIEW"
    newest = db.scalars(
        select(ReviewEvent)
        .where(ReviewEvent.note_id == FAILED_NOTE)
        .order_by(ReviewEvent.occurred_at.desc())
    ).first()
    assert (newest.from_status, newest.to_status, newest.actor_id) == (
        "FAILED",
        "GENERATING",
        "clinician-3",
    )


def test_reviewers_cannot_regenerate(client: TestClient, as_user) -> None:
    response = client.post(
        "/api/notes/bulk/regenerate",
        json={"noteIds": [FAILED_NOTE]},
        headers=as_user("reviewer-1"),
    )

    assert response.status_code == 403


def test_bulk_actions_need_note_ids(client: TestClient, as_user) -> None:
    response = client.post(
        "/api/notes/bulk/regenerate",
        json={"noteIds": []},
        headers=as_user("clinician-1"),
    )

    assert response.status_code == 400
    assert response.json()["error"] == "invalid_request"


# --- Patients --------------------------------------------------------------


def patients(client: TestClient, headers: dict, **params: Any) -> list[dict]:
    response = client.get("/api/patients", params=params, headers=headers)
    assert response.status_code == 200
    return response.json()["items"]


def test_patients_are_listed_by_name_up_to_twenty(
    client: TestClient,
    as_user,
) -> None:
    items = patients(client, as_user("clinician-1"))

    every_patient = {s["patient"]["id"]: s["patient"] for s in SUMMARIES}
    expected = sorted(every_patient.values(), key=lambda p: (p["displayName"], p["id"]))
    assert items == expected[:20]


def test_patients_follow_the_note_filters(client: TestClient, as_user) -> None:
    headers = as_user("clinician-1")
    name = SUMMARIES[0]["patient"]["displayName"]

    def expected(predicate) -> set[str]:
        return {s["patient"]["id"] for s in SUMMARIES if predicate(s)}

    assert {p["id"] for p in patients(client, headers, status="FAILED")} == expected(
        lambda s: s["status"] == "FAILED"
    )
    assert {p["id"] for p in patients(client, headers, q=name[:4].lower())} == (
        expected(lambda s: name[:4].lower() in s["patient"]["displayName"].lower())
    )
    assert patients(client, headers, patientId=SUMMARIES[0]["patient"]["id"]) == [
        SUMMARIES[0]["patient"]
    ]


# --- Telemetry -------------------------------------------------------------


def telemetry_batch(**properties: Any) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "sentAt": "2026-11-05T10:00:00.000Z",
        "reason": "interval",
        "events": [
            {
                "eventId": "event-1",
                "name": "note.saved",
                "occurredAt": "2026-11-05T09:59:00.000Z",
                "important": False,
                "properties": properties,
            }
        ],
    }


def test_telemetry_is_accepted(client: TestClient, as_user) -> None:
    response = client.post(
        "/api/telemetry",
        json=telemetry_batch(durationMs=120),
        headers=as_user("clinician-1"),
    )

    assert response.status_code == 202
    assert response.json() == {"accepted": 1}


@pytest.mark.parametrize(
    "properties",
    [{"noteId": "note-000001"}, {"context": {"patient": {"id": "x"}}}],
)
def test_telemetry_with_clinical_content_is_refused(
    client: TestClient,
    as_user,
    properties: dict,
) -> None:
    response = client.post(
        "/api/telemetry",
        json=telemetry_batch(**properties),
        headers=as_user("clinician-1"),
    )

    assert response.status_code == 400
    assert response.json()["error"] == "clinical_content_rejected"


def test_telemetry_must_be_a_valid_batch(client: TestClient, as_user) -> None:
    response = client.post(
        "/api/telemetry",
        json={"schemaVersion": 2, "events": []},
        headers=as_user("clinician-1"),
    )

    assert response.status_code == 400
    assert response.json()["error"] == "invalid_request"


# --- OpenAPI ---------------------------------------------------------------


def test_openapi_documents_invalid_requests_as_400(app: FastAPI) -> None:
    document = app.openapi()

    for path, operations in document["paths"].items():
        for method, operation in operations.items():
            responses = operation["responses"]
            assert "HTTPValidationError" not in json.dumps(responses), (method, path)
    assert "HTTPValidationError" not in document["components"]["schemas"]
