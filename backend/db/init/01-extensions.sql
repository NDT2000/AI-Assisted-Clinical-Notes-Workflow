-- Runs once, when the database volume is first created.
-- pgvector stores the embeddings used for retrieval (Phase 4).
CREATE EXTENSION IF NOT EXISTS vector;
