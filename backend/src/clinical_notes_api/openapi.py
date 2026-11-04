"""Write the API's OpenAPI description to contract/openapi.json.

The frontend generates its API types from that file (`npm run api:types`).
Run after changing a route or response model:

    uv run clinical-notes-openapi
"""

import json
import sys
from typing import Any

from clinical_notes_api.config import REPOSITORY_ROOT, Settings
from clinical_notes_api.main import create_app

OPENAPI_PATH = REPOSITORY_ROOT / "contract" / "openapi.json"


def build_openapi_document() -> dict[str, Any]:
    # Fixed settings, so the document does not depend on the local .env.
    return create_app(Settings(_env_file=None)).openapi()


def render(document: dict[str, Any]) -> str:
    return json.dumps(document, indent=2, sort_keys=True) + "\n"


def main() -> int:
    # LF on every OS, so the file is byte-identical wherever it is generated.
    OPENAPI_PATH.write_text(
        render(build_openapi_document()),
        encoding="utf-8",
        newline="\n",
    )
    print(f"Wrote {OPENAPI_PATH.relative_to(REPOSITORY_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
