# Acceptance corpus

Versioned, synthetic and non-sensitive fixtures with ground truth for ingestion acceptance
(QA-002, `docs/06-delivery/05-acceptance-and-traceability.md`).

| Version | Items                                                                                      |
| ------- | ------------------------------------------------------------------------------------------ |
| `v0`    | Persian scanned brief (1 page), English scanned memo (2 pages), Persian and English speech |

Each item in `vN/manifest.json` records its language, the expected evidence (page count,
missing text layer, transcript, required phrases, minimum OCR/transcription accuracy,
pipeline stages) and SHA-256 checksums of the fixture and its transcript.

## Rules

- Fixtures are synthetic: no customer data, names, emails, phone numbers or account numbers.
- A published version is immutable. Corrections or additions go into a new folder (`v1`, …)
  generated with `python3 qa/acceptance-corpus/generate.py` after bumping `VERSION`.
- `pnpm qa:corpus` verifies checksums, image-only PDFs, audio properties and personal-data
  patterns; CI runs it on every pull request.
- Ingestion stories (`ING-*`) cite the item IDs (for example `scan-fa-001`) in their tests.
