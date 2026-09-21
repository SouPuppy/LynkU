#!/bin/bash

# Production function names have one source: cloudbaserc.json.
if [ -z "$PROJECT" ]; then
  echo "PROJECT must point to the Lucky repository" >&2
  exit 1
fi
FUNCTION_NAMES="$(node -e "const c=require(process.argv[1]); for (const f of c.functions) { if (!/^[a-z][a-z0-9-]*$/.test(f.name)) throw Error('Invalid function name'); console.log(f.name) }" "$PROJECT/cloudbaserc.json")" || exit 1
CORE_FUNCTIONS=()
while IFS= read -r name; do
  if [ -n "$name" ]; then CORE_FUNCTIONS+=("$name"); fi
done <<< "$FUNCTION_NAMES"
