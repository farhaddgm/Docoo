# Docoo — working notes for Claude

## Delivery flow
- Run `/ship` at the end of a change; it checks which step is done and finishes the rest.
- Steps: commit → draft PR → CI green → merge → deploy → release → server update.
- Release is automatic: raising `version` in `package.json` on `main` (with a matching `CHANGELOG.md` section) triggers `.github/workflows/release.yml`.
- Deploy (`.github/workflows/deploy.yml`) runs automatically after a successful Release and runs `install.sh update` on the server, which rolls back if unhealthy. A change reaches servers only once its version is released.
- Docs/CI-only changes need no release or deploy.

## Cost-saving habits
- Batch related changes into one PR; release and deploy in batches, not per merge (except urgent fixes).
- Run local checks only for changed packages (`pnpm --filter <pkg>...`); full `pnpm verify` is CI's job.
- Don't poll CI; end the turn and wait for the event.
