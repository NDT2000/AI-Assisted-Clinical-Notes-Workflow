# Production image for the API. Build from the backend folder:
#   docker build -t clinical-notes-api backend
# Two stages: the first installs the locked dependencies with uv, the second
# copies only the finished install into a slim image without build tools.

# ---- Build stage -----------------------------------------------------------
FROM python:3.13-slim-bookworm AS build

COPY --from=ghcr.io/astral-sh/uv:0.13.7 /uv /bin/uv

# Compile bytecode now so the API starts faster; copy files instead of
# linking (the cache is not in the final image); use the image's Python.
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# Dependencies first, in their own layer, so code changes do not reinstall
# them. Exact versions from uv.lock; no dev tools (pytest, ruff).
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --locked --no-dev --no-install-project

# Then the application itself, installed as a regular package (not linked to
# the source folder).
COPY pyproject.toml uv.lock ./
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-editable

# ---- Run stage -------------------------------------------------------------
FROM python:3.13-slim-bookworm AS runtime

# A regular user with no login shell and no home directory to write to: if
# the API were ever broken into, it could not change the image's files.
RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --no-create-home \
       --shell /usr/sbin/nologin app

WORKDIR /app

# Root owns the files; the app user can only read and run them.
COPY --from=build /app/.venv /app/.venv
# Migrations run from the same image as a one-shot job:
#   docker run --rm ... clinical-notes-api alembic upgrade head
COPY alembic.ini ./
COPY migrations ./migrations

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ENVIRONMENT=production \
    API_HOST=0.0.0.0 \
    API_PORT=8000

USER app

EXPOSE 8000

# Docker marks the container healthy once the API answers. Uses Python, as
# the slim image has no curl.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen(f\"http://127.0.0.1:{os.environ.get('API_PORT', '8000')}/api/health\", timeout=2)"]

CMD ["clinical-notes-serve"]
