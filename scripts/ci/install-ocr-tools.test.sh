#!/usr/bin/env bash
# Tests scripts/ci/install-ocr-tools.sh against a fake sudo, apt-get, getent and tesseract, so the
# behaviour while the Ubuntu archive is down is checked without a network.
set -uo pipefail

script="$(cd "$(dirname "$0")" && pwd)/install-ocr-tools.sh"
failures=0
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT

# The fake tools apt "installs": a tesseract that lists eng and fas, and a pdftoppm. They have names
# no real machine has, and the script is told to look for those names, so the result does not
# depend on whether the machine running this test has the real tools (a CI runner does).
fake_tools() {
  local dir="$1/bin"
  printf '#!/usr/bin/env bash\nprintf "List of available languages (3):\\neng\\nfas\\nosd\\n"\n' >"$dir/fake-tesseract"
  printf '#!/usr/bin/env bash\nexit 0\n' >"$dir/fake-pdftoppm"
  chmod +x "$dir/fake-tesseract" "$dir/fake-pdftoppm"
}
export -f fake_tools

# A fresh fake world: bin/ first on PATH, counters in state/. Sets `world`.
new_world() {
  world="$(mktemp -d -p "$root")"
  mkdir -p "$world/bin" "$world/state"
  # sudo runs the command; tee goes to a scratch file instead of /etc.
  cat >"$world/bin/sudo" <<EOF
#!/usr/bin/env bash
if [[ "\$1" == "tee" ]]; then cat >"$world/state/apt.conf"; exit 0; fi
exec "\$@"
EOF
  # getent resolves only after FAKE_DNS_AFTER calls (a huge number: never).
  cat >"$world/bin/getent" <<EOF
#!/usr/bin/env bash
n=\$(( \$(cat "$world/state/dns" 2>/dev/null || echo 0) + 1 ))
echo "\$n" >"$world/state/dns"
(( n > \${FAKE_DNS_AFTER:-0} ))
EOF
  # apt-get: update always exits 0 (as the real one does on ignored failures); install fails with
  # 100 until its FAKE_INSTALL_OK-th call, then puts the fake tools on PATH (or "works" without
  # them when FAKE_INSTALL_EMPTY is set).
  cat >"$world/bin/apt-get" <<EOF
#!/usr/bin/env bash
echo "\$*" >>"$world/state/apt.log"
[[ "\$1" == "update" ]] && exit 0
n=\$(( \$(cat "$world/state/installs" 2>/dev/null || echo 0) + 1 ))
echo "\$n" >"$world/state/installs"
(( n < \${FAKE_INSTALL_OK:-1} )) && exit 100
if [[ -z "\${FAKE_INSTALL_EMPTY:-}" ]]; then fake_tools "$world"; fi
exit 0
EOF
  chmod +x "$world/bin/"*
  export PATH="$world/bin:$PATH"
  export OCR_INSTALL_BUDGET=3 OCR_INSTALL_POLL=1 OCR_INSTALL_APT_TIMEOUT=5
  export OCR_INSTALL_TESSERACT=fake-tesseract OCR_INSTALL_PDFTOPPM=fake-pdftoppm
}

run() {
  bash "$script" >"$world/out" 2>&1
  status=$?
}
installs() { cat "$world/state/installs" 2>/dev/null || echo 0; }
apt_calls() {
  if [[ -e "$world/state/apt.log" ]]; then wc -l <"$world/state/apt.log"; else echo 0; fi
}

case_already_installed() {
  new_world
  fake_tools "$world"
  run
  [[ $status -eq 0 && ! -e "$world/state/apt.log" ]]
}

case_reachable_at_once() {
  new_world
  FAKE_DNS_AFTER=0 run
  [[ $status -eq 0 && "$(installs)" == "1" && "$(apt_calls)" -eq 2 ]]
}

case_short_outage() {
  new_world
  # Three hosts per check: the archive is back on the third check, and apt must not run before.
  export FAKE_DNS_AFTER=7
  run
  [[ $status -eq 0 && "$(apt_calls)" -eq 2 ]]
}

case_long_outage() {
  new_world
  export FAKE_DNS_AFTER=100000
  local started took
  started="$(date +%s)"
  run
  took=$(( $(date +%s) - started ))
  [[ $status -ne 0 && $took -le 6 && ! -e "$world/state/apt.log" ]] \
    && grep -q "Ubuntu archive is unreachable" "$world/out"
}

case_failed_install_is_retried() {
  new_world
  export FAKE_INSTALL_OK=2
  run
  [[ $status -eq 0 && "$(installs)" == "2" ]]
}

case_apt_exit_code_is_not_trusted() {
  new_world
  export FAKE_INSTALL_EMPTY=1
  run
  [[ $status -ne 0 ]]
}

check() {
  local name="$1"
  shift
  if ( "$@" ); then
    echo "ok   - $name"
  else
    echo "FAIL - $name"
    failures=$((failures + 1))
  fi
}

check "does nothing when the tools are already there" case_already_installed
check "installs once when the archive is reachable" case_reachable_at_once
check "waits out a short outage without calling apt, then installs" case_short_outage
check "fails clearly within the budget when the archive never comes back" case_long_outage
check "tries again after a failed install" case_failed_install_is_retried
check "does not trust apt's exit code, it looks for the tools" case_apt_exit_code_is_not_trusted

if (( failures > 0 )); then
  echo "$failures check(s) failed."
  exit 1
fi
echo "All checks passed."
