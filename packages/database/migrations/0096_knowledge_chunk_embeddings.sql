-- ADR-0060: semantic (provider) embeddings of knowledge chunks, beside the local hash embedding.
-- Chunks are append-only, so the vectors live in a table of their own, one row per chunk and model:
-- a new model adds rows and never rewrites the old ones. Only chunks of `internal` knowledge are ever
-- embedded (the rule is in the indexing code and in KNOWLEDGE_EMBEDDING_ALLOW_INTERNAL); this table
-- holds numbers only, never the text.
ALTER TABLE knowledge_chunks
  ADD CONSTRAINT knowledge_chunks_id_workspace_uq UNIQUE (id, workspace_id);

CREATE TABLE knowledge_chunk_embeddings (
  chunk_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  model text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 100),
  embedding vector(1536) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chunk_id, model),
  FOREIGN KEY (chunk_id, workspace_id) REFERENCES knowledge_chunks (id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX knowledge_chunk_embeddings_workspace_idx ON knowledge_chunk_embeddings (workspace_id, model);
CREATE INDEX knowledge_chunk_embeddings_vector_idx
  ON knowledge_chunk_embeddings USING hnsw (embedding vector_cosine_ops);
--> statement-breakpoint
ALTER TABLE knowledge_chunk_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunk_embeddings FORCE ROW LEVEL SECURITY;
CREATE POLICY knowledge_chunk_embeddings_read ON knowledge_chunk_embeddings
  FOR SELECT USING (workspace_id = app.current_workspace_id());
CREATE POLICY knowledge_chunk_embeddings_append ON knowledge_chunk_embeddings
  FOR INSERT WITH CHECK (workspace_id = app.current_workspace_id());
-- No UPDATE or DELETE is granted, so the application cannot change a row. There is deliberately no
-- append-only trigger: it would also stop the cascade from a purged chunk (NFR-DATA-003).
REVOKE ALL ON knowledge_chunk_embeddings FROM PUBLIC, docoo_app;
GRANT SELECT, INSERT ON knowledge_chunk_embeddings TO docoo_app;
