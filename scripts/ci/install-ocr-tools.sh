#!/usr/bin/env bash
# Installs the OCR tools the ingestion tests need (Tesseract with fas and eng, poppler) on a CI runner
# without letting a broken Ubuntu archive hold the job for as long as apt's own retries would.
#
# Why this script exists: when the runner cannot resolve the Ubuntu archive hosts, apt retries every
# package on every mirror with its own timeouts and fails only after about eleven minutes, and
# `apt-get update` even exits 0 on such failures. Here the hosts are checked first; while none
# resolves we wait in short steps, and apt only runs (with a hard time limit) when one does. A short
# outage is ridden out, a long one fails clearly after a fixed budget.
#
# Settings (environment, for tests): OCR_INSTALL_BUDGET seconds in total (480), OCR_INSTALL_POLL
# seconds between checks (20), OCR_INSTALL_APT_TIMEOUT seconds for one apt command (150),
# OCR_INSTALL_HOSTS the hosts apt may use (the Ubuntu archive and its mirrors), and
# OCR_INSTALL_TESSERACT / OCR_INSTALL_PDFTOPPM the names of the commands that show the tools are
# there (so a test does not depend on what the machine running it has installed).
set -uo pipefail

BUDGET="${OCR_INSTALL_BUDGET:-480}"
POLL="${OCR_INSTALL_POLL:-20}"
APT_TIMEOUT="${OCR_INSTALL_APT_TIMEOUT:-150}"
HOSTS="${OCR_INSTALL_HOSTS:-archive.ubuntu.com azure.archive.ubuntu.com security.ubuntu.com}"
TESSERACT="${OCR_INSTALL_TESSERACT:-tesseract}"
PDFTOPPM="${OCR_INSTALL_PDFTOPPM:-pdftoppm}"
PACKAGES=(tesseract-ocr tesseract-ocr-eng tesseract-ocr-fas poppler-utils)

installed() {
  command -v "$TESSERACT" >/dev/null 2>&1 && command -v "$PDFTOPPM" >/dev/null 2>&1 || return 1
  local langs
  langs="$("$TESSERACT" --list-langs 2>/dev/null)" || return 1
  grep -qx eng <<<"$langs" && grep -qx fas <<<"$langs"
}

reachable() {
  local host
  for host in $HOSTS; do
    if getent hosts "$host" >/dev/null 2>&1; then return 0; fi
  done
  return 1
}

if installed; then
  echo "OCR tools are already installed."
  exit 0
fi

# Fewer, shorter apt retries: the loop below is the retry that matters.
sudo tee /etc/apt/apt.conf.d/80-ci-resilience >/dev/null <<'EOF'
Acquire::Retries "2";
Acquire::http::Timeout "20";
Acquire::https::Timeout "20";
EOF

started="$(date +%s)"
attempt=0
while :; do
  if (( $(date +%s) - started >= BUDGET )); then break; fi
  attempt=$((attempt + 1))
  if reachable; then
    echo "OCR tools, attempt ${attempt}: installing."
    if sudo timeout "$APT_TIMEOUT" apt-get update \
      && sudo timeout "$APT_TIMEOUT" apt-get install -y --no-install-recommends "${PACKAGES[@]}" \
      && installed; then
      echo "OCR tools installed."
      exit 0
    fi
    echo "OCR tools, attempt ${attempt}: the install did not complete."
  else
    echo "OCR tools, attempt ${attempt}: none of the Ubuntu archive hosts resolves yet."
  fi
  if (( $(date +%s) - started + POLL >= BUDGET )); then break; fi
  sleep "$POLL"
done

echo "::error::The OCR tools could not be installed within ${BUDGET}s: the Ubuntu archive is unreachable from this runner."
exit 1
