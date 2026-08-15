#!/usr/bin/env bash
# Lance les 6 suites e2e du bouclier avec un cooldown de 50s entre chacune,
# pour laisser le rate-limiter de registration (HTTP 429, per-IP) se
# ré-emplir entre les runs. Usage :
#   ./run-e2e.sh              # desktop (1280x900)
#   ./run-e2e.sh 390x844      # mobile Android (viewport 390x844)
set -u
cd /root/aetherlink/frontend
export E2E_BASE="${E2E_BASE:-http://localhost:3000}"
if [ -n "${1:-}" ]; then export E2E_VIEWPORT="$1"; fi

SUITES="ui-e2e.mjs ui-e2e-ephemeral.mjs ui-e2e-i18n.mjs ui-e2e-group.mjs ui-e2e-push.mjs ui-e2e-decline.mjs"
COOLDOWN=50
overall=0
for s in $SUITES; do
  echo "===== $s (viewport=${E2E_VIEWPORT:-1280x900}) ====="
  node "e2e/$s"; rc=$?
  if [ "$rc" -ne 0 ]; then overall=1; echo "!! $s FAILED (rc=$rc)"; else echo "ok $s"; fi
  echo "---- cooldown ${COOLDOWN}s ----"
  sleep "$COOLDOWN"
done
echo "OVERALL=$overall"
exit $overall
