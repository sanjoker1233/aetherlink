#!/usr/bin/env bash
# Démarre le frontend aetherlink de façon fiable sur Android.
#
# IMPORTANT: -H 127.0.0.1 est OBLIGATOIRE ici.
# Sur le kernel Android de cet hôte, `next start` SANS -H énumère toutes les
# interfaces réseau (uv_interface_addresses) et crashe avec :
#   SystemError: uv_interface_addresses returned Unknown system error 13 (EACCES)
# Forcer l'bind sur 127.0.0.1 évite l'énumération et le crash.
#
# Le serveur sert le build strict-CSP (Next 15 nonce) validé par le bouclier.
set -euo pipefail

cd /root/aetherlink/frontend

export PORT=3000
export NEXT_PUBLIC_API_URL=http://localhost:9090

exec node_modules/.bin/next start -p 3000 -H 127.0.0.1
