"""The Python seed generator must match the frontend's mock data exactly.

The fixture is exported from the TypeScript generator; see
tests/fixtures/export_mock_sample.ts for how to regenerate it.
"""

import json
from pathlib import Path

import pytest

from clinical_notes_api.seed.mock_data import (
    generate_note_detail,
    generate_note_summaries,
)

SAMPLE = json.loads(
    (Path(__file__).parent / "fixtures" / "mock_data_sample.json").read_text(
        encoding="utf-8"
    )
)


def test_summaries_match_the_typescript_generator() -> None:
    summaries = generate_note_summaries(SAMPLE["count"], SAMPLE["seed"])

    assert summaries == SAMPLE["summaries"]


@pytest.mark.parametrize(
    "index",
    range(len(SAMPLE["details"])),
    ids=lambda index: SAMPLE["summaries"][index]["status"],
)
def test_details_match_the_typescript_generator(index: int) -> None:
    summary = SAMPLE["summaries"][index]

    assert generate_note_detail(summary) == SAMPLE["details"][index]


def test_sample_covers_every_status() -> None:
    statuses = {summary["status"] for summary in SAMPLE["summaries"]}

    assert statuses == {
        "GENERATING",
        "FAILED",
        "READY_FOR_REVIEW",
        "IN_REVIEW",
        "REJECTED",
        "APPROVED",
        "AMENDED",
        "LOCKED",
    }
