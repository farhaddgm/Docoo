-- ADR-0061: the title of a document and the heading of its section travel with each chunk when it is
-- searched, so a chunk that says "the buyer pays the freight" is still found by "return costs". The
-- chunk text itself is unchanged (a quote is checked against it); the context only joins the search
-- text and the embeddings. Chunks made before this migration have none.
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS context text;
