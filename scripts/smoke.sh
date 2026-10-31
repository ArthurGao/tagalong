#!/usr/bin/env bash
# Post-deploy smoke (docs/RUNBOOK.md): asserts WHICH build answered and that the doors that must be shut are shut.
# Usage: scripts/smoke.sh <env> <api-base> [<web-base> <admin-base>]
#   scripts/smoke.sh staging https://api-staging.tagalong.nz https://staging.tagalong.nz https://admin-staging.tagalong.nz
# Exits non-zero on the first failure. Read-only: no request changes anything.
set -euo pipefail

env_name=${1:?env (development|staging|production)}
api=${2:?api base URL}
web=${3:-}
admin=${4:-}

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "ok:   $*"; }

# check <expected-status> <method> <url> [curl args…]; the response body lands in $body.
check() {
  local expected=$1 method=$2 url=$3
  shift 3
  local out
  out=$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" "$@" "$url") || fail "$method $url: no answer"
  body=$(cat "$tmp")
  [[ $out == "$expected" ]] || fail "$method $url: expected $expected, got $out: $body"
}

check 200 GET "$api/api/v1/health"
[[ $(jq -r .status <<<"$body") == ok ]] || fail "health status: $body"
[[ $(jq -r .env <<<"$body") == "$env_name" ]] || fail "health env is $(jq -r .env <<<"$body"), expected $env_name"
release=$(jq -r .release <<<"$body")
[[ $env_name == development || -n $release ]] || fail "health release is empty: not a Render build"
ok "health: $env_name, release ${release:-none}"

check 404 GET "$api/api/v1/public/listings/smoke-none"
[[ $(jq -r .code <<<"$body") == NOT_FOUND ]] || fail "unknown listing: $body"
ok "unknown listing: 404 NOT_FOUND"

check 401 GET "$api/api/v1/admin/stats"
[[ $(jq -r .code <<<"$body") == UNAUTHENTICATED ]] || fail "admin without session: $body"
ok "admin API without a session: 401"

for path in stripe/connect stripe/platform clerk; do
  check 400 POST "$api/api/v1/webhooks/$path" -H 'content-type: application/json' --data '{}'
done
ok "webhooks without a signature: 400"

if [[ -n $web ]]; then
  check 404 GET "$web/en/admin"
  ok "main host: /admin is 404"
  check 200 GET "$web/en/find-order"
  ok "main host: public page 200"
  check 200 GET "$web/api/v1/health"
  [[ $(jq -r .env <<<"$body") == "$env_name" ]] || fail "web → API rewrite reaches $(jq -r .env <<<"$body")"
  ok "main host: /api rewrite reaches the $env_name API"
fi
if [[ -n $admin ]]; then
  check 200 GET "$admin/en/login"
  ok "admin host: login page 200"
  check 404 GET "$admin/en/l/smoke-none"
  ok "admin host: public pages are 404"
fi
echo "smoke passed: $env_name"
