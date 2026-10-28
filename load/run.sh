#!/usr/bin/env bash
# Runs one k6 script in load/ against the running stack, with the tokens the
# copies printed at startup. Run it from the repository root, after
#   docker compose up -d --build --scale api=2   (and ~8 s for the proxy)
#
#   bash load/run.sh tokens.js           # through the proxy, api-1's u-1 token
#   bash load/run.sh tokens.js 2         # the same with api-2's token
#   bash load/run.sh bookings.js         # api-1 (u-1) and api-2 (u-2), directly
#   bash load/run.sh bookings.js 1 1     # control: both people on api-1
#
# Anything after the copy numbers goes to k6 (for example -e KEEP=1).
set -euo pipefail

# Git Bash would otherwise rewrite /load/... into a Windows path.
export MSYS_NO_PATHCONV=1

script=${1:?usage: bash load/run.sh <script.js> [copyA] [copyB] [k6 args...]}
shift
copy_a=1; copy_b=2
if [[ ${1:-} =~ ^[0-9]+$ ]]; then copy_a=$1; shift; fi
if [[ ${1:-} =~ ^[0-9]+$ ]]; then copy_b=$1; shift; fi

mapfile -t copies < <(docker compose ps --format '{{.Name}}' api | sort -t- -k4 -n)
echo "api copies running: ${#copies[@]} (${copies[*]})"

name_of() { echo "${copies[$(($1 - 1))]:?no api copy number $1}"; }
# The startup lines read "  u-1 (member) <token>" and "  u-2 (admin)  <token>".
token_of() { docker logs "$1" 2>&1 | awk -v who="$2" '$1 == who { t = $3 } END { print t }'; }

case "$script" in
  tokens.js)
    issuer=$(name_of "$copy_a")
    echo "token: u-1's, as printed by $issuer"
    exec docker compose --profile load run --rm --no-deps \
      -e TOKEN="$(token_of "$issuer" u-1)" -e N="${#copies[@]}" \
      k6 run "$@" /load/tokens.js
    ;;
  bookings.js)
    a=$(name_of "$copy_a"); b=$(name_of "$copy_b")
    distinct=2; [ "$a" = "$b" ] && distinct=1
    echo "A: u-1 on $a    B: u-2 on $b"
    exec docker compose --profile load run --rm --no-deps \
      -e A="http://$a:8080" -e TOKEN_A="$(token_of "$a" u-1)" \
      -e B="http://$b:8080" -e TOKEN_B="$(token_of "$b" u-2)" \
      -e N="$distinct" \
      k6 run "$@" /load/bookings.js
    ;;
  *)
    echo "unknown script: $script" >&2
    exit 2
    ;;
esac
