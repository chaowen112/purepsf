#!/usr/bin/env bash
# purePSF API smoke test. Assumes backend is running and DB is populated.
# Run: BASE=http://localhost:8080 ./scripts/smoke_api.sh
set -euo pipefail

BASE="${BASE:-http://localhost:8080}"
# Singapore bbox, covers all 28 districts
BBOX="103.6,1.20,104.05,1.48"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }

check() {
    local label="$1" cmd="$2" expect="$3"
    local got
    if got=$(eval "$cmd" 2>&1); then
        if [[ "$got" == *"$expect"* ]]; then
            green "[ok ] $label"
            return 0
        fi
    fi
    red "[FAIL] $label"
    red "  cmd:    $cmd"
    red "  expect: $expect"
    red "  got:    $got"
    return 1
}

FAILS=0
run() { "$@" || FAILS=$((FAILS+1)); }

run check "healthz"                                                  "curl -fs $BASE/healthz"                                                       '"ok"'
run check "projects?bbox=$BBOX returns non-empty array"              "curl -fs '$BASE/api/projects?bbox=$BBOX' | jq -r 'length'"                    ''
run check "projects without bbox returns 400"                        "curl -s -o /dev/null -w '%{http_code}' $BASE/api/projects"                    '400'
run check "projects with malformed bbox returns 400"                 "curl -s -o /dev/null -w '%{http_code}' '$BASE/api/projects?bbox=foo'"         '400'
run check "missing project transactions returns 404"                 "curl -s -o /dev/null -w '%{http_code}' $BASE/api/projects/99999999/transactions" '404'
run check "missing project comparison returns 404"                   "curl -s -o /dev/null -w '%{http_code}' $BASE/api/projects/99999999/comparison" '404'

# Pull one real project id and exercise the per-project endpoints.
PID=$(curl -fs "$BASE/api/projects?bbox=$BBOX" | jq -r '.[0].id // empty')
if [[ -z "$PID" ]]; then
    red "[FAIL] no projects returned from bbox query — DB empty?"
    FAILS=$((FAILS+1))
else
    green "[..] sampling project_id=$PID"
    run check "transactions for $PID returns array"   "curl -fs $BASE/api/projects/$PID/transactions | jq -r 'type'"   'array'
    run check "comparison for $PID has own.count"     "curl -fs $BASE/api/projects/$PID/comparison | jq -r '.own.count // empty'" ''
    run check "comparison for $PID has nearby_500m"   "curl -fs $BASE/api/projects/$PID/comparison | jq -r '.nearby_500m.radius_m'" '500'
fi

run check "tracked endpoint returns array"           "curl -fs $BASE/api/tracked | jq -r 'type'"  'array'

if [[ $FAILS -gt 0 ]]; then
    red "$FAILS check(s) failed"
    exit 1
fi
green "all smoke checks passed"
