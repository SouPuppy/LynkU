#!/bin/bash
# Deploy built artifacts with CloudBase CLI. Authentication must already be configured.
set -euo pipefail

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
source "$PROJECT/scripts/functions.sh"
FUNCTIONS=("${CORE_FUNCTIONS[@]}")

export NODE_OPTIONS="--dns-result-order=ipv4first"

cd "$PROJECT"
node "$PROJECT/tooling/build-cloud-functions.mjs"
node "$PROJECT/tooling/check-cloud-artifacts.mjs"

for fn in "${FUNCTIONS[@]}"; do
  tcb fn deploy "$fn" --install-dependency true
done

echo ""
echo "All ${#FUNCTIONS[@]} production functions created and deployed."
echo "To update code later: ./scripts/deploy-functions.sh"
