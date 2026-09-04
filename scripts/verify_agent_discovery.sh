#!/bin/sh
set -eu

base_url="${1:-https://purepsf.tet.sg}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

check_homepage() {
    method="$1"
    if [ "$method" = HEAD ]; then
        curl -fsSI -D "$tmp_dir/home-$method.headers" -o /dev/null "$base_url/"
    else
        curl -fsS -D "$tmp_dir/home-$method.headers" -o /dev/null "$base_url/"
    fi
    tr -d '\r' < "$tmp_dir/home-$method.headers" |
        grep -Eiq '^link: </\.well-known/api-catalog>; rel="api-catalog"; type="application/linkset\+json"$'
}

check_homepage GET
check_homepage HEAD

curl -fsS -D "$tmp_dir/catalog.headers" \
    -H 'Accept: application/linkset+json' \
    -o "$tmp_dir/catalog.json" \
    "$base_url/.well-known/api-catalog"

tr -d '\r' < "$tmp_dir/catalog.headers" |
    grep -Eiq '^content-type: application/linkset\+json; profile="https://www\.rfc-editor\.org/info/rfc9727"$'
grep -Fq '"linkset"' "$tmp_dir/catalog.json"
grep -Fq '"anchor": "https://purepsf.tet.sg/.well-known/api-catalog"' "$tmp_dir/catalog.json"
grep -Fq '"href": "https://purepsf.tet.sg/api/tracked"' "$tmp_dir/catalog.json"

printf 'Agent discovery verified at %s\n' "$base_url"
