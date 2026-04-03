#!/usr/bin/env bash

set -euo pipefail

token="${CRAFTER8_SDK_GITHUB_PAT_TOKEN:-${GITHUB_TOKEN:-${GH_TOKEN:-}}}"

case "${1:-}" in
  *Username*)
    printf '%s\n' "x-access-token"
    ;;
  *Password*)
    printf '%s\n' "$token"
    ;;
  *)
    printf '\n'
    ;;
esac
