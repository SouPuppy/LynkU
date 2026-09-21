#!/bin/bash
# deploy-functions.sh — Upload production cloud functions via miniprogram-ci
# Prereq: Download private key from mp.weixin.qq.com → 开发设置 → 代码上传密钥
#         Uses global miniprogram-ci when available, otherwise falls back to npx.
set -e

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
APPID="$(node -p "require(process.argv[1]).appid" "$PROJECT/project.config.json")"
ENV="$(node -p "require(process.argv[1]).envId" "$PROJECT/cloudbaserc.json")"
KEY="$PROJECT/private.${APPID}.key"
source "$PROJECT/scripts/functions.sh"

native_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1"
    return
  fi

  case "$1" in
    /mnt/[a-zA-Z]/*)
      local drive rest upper
      drive="${1#/mnt/}"
      drive="${drive%%/*}"
      rest="${1#/mnt/$drive/}"
      upper="$(printf '%s' "$drive" | tr '[:lower:]' '[:upper:]')"
      printf '%s:\\%s' "$upper" "$(printf '%s' "$rest" | sed 's#/#\\#g')"
      ;;
    /[a-zA-Z]/*)
      local drive rest upper
      drive="${1#/}"
      drive="${drive%%/*}"
      rest="${1#/$drive/}"
      upper="$(printf '%s' "$drive" | tr '[:lower:]' '[:upper:]')"
      printf '%s:\\%s' "$upper" "$(printf '%s' "$rest" | sed 's#/#\\#g')"
      ;;
    *)
      printf '%s' "$1"
      ;;
  esac
}

if [ ! -f "$KEY" ]; then
  echo "ERROR: 密钥文件不存在: $KEY"
  echo "请去 mp.weixin.qq.com → 开发管理 → 开发设置 → 小程序代码上传 → 下载密钥"
  exit 1
fi

FUNCTIONS=("${CORE_FUNCTIONS[@]}")

# Build immutable upload inputs. The source tree is never modified during deployment.
node "$PROJECT/tooling/build-cloud-functions.mjs"
node "$PROJECT/tooling/check-cloud-artifacts.mjs"

if command -v miniprogram-ci >/dev/null 2>&1; then
  CI_CMD=(miniprogram-ci)
else
  CI_CMD=(npx -y miniprogram-ci)
fi

PROJECT_NATIVE="$(native_path "$PROJECT")"
KEY_NATIVE="$(native_path "$KEY")"

# Force IPv4 — avoids WeChat IP whitelist IPv6 issues
export NODE_OPTIONS="--dns-result-order=ipv4first"

FAILED=()
DEPLOYED=0
for fn in "${FUNCTIONS[@]}"; do
  echo "=== uploading $fn ==="
  FUNCTION_PATH_NATIVE="$(native_path "$PROJECT/dist/cloudfunctions/$fn")"
  if "${CI_CMD[@]}" cloud functions upload \
    --pp "$PROJECT_NATIVE" \
    --appid "$APPID" \
    --pkp "$KEY_NATIVE" \
    --env "$ENV" \
    --name "$fn" \
    --path "$FUNCTION_PATH_NATIVE" \
    --remote-npm-install true; then
    echo "=== $fn done ==="
    DEPLOYED=$((DEPLOYED + 1))
  else
    echo "=== $fn FAILED (may need to create it in CloudBase console first) ==="
    FAILED+=("$fn")
  fi
done

echo ""
echo "Deployed $DEPLOYED/${#FUNCTIONS[@]} functions."
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "FAILED: ${FAILED[*]} — create these in CloudBase console first."
  exit 1
fi
