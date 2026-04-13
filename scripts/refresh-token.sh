#!/usr/bin/env bash
# refresh-token.sh — Extract the Claude Code OAuth token from the macOS
# Keychain and write it into .env so docker compose can pick it up.
#
# Usage:
#   ./scripts/refresh-token.sh
#
# The script rewrites the CLAUDE_CODE_OAUTH_TOKEN line atomically (via a
# temp file + mv) so a failure mid-write cannot corrupt an existing .env.
# If .env does not yet exist, it is created from .env.example.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
ENV_EXAMPLE="$REPO_ROOT/.env.example"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "refresh-token.sh: this helper only supports macOS (uses 'security')." >&2
  echo "On other platforms set CLAUDE_CODE_OAUTH_TOKEN in .env manually." >&2
  exit 1
fi

if ! command -v security >/dev/null 2>&1; then
  echo "refresh-token.sh: 'security' command not found." >&2
  exit 1
fi

# Bootstrap .env from the template if it doesn't exist yet.
if [[ ! -f "$ENV_FILE" ]]; then
  if [[ ! -f "$ENV_EXAMPLE" ]]; then
    echo "refresh-token.sh: neither .env nor .env.example exists in $REPO_ROOT" >&2
    exit 1
  fi
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  echo "refresh-token.sh: created .env from .env.example"
fi

echo "refresh-token.sh: reading token from Keychain..."
RAW=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null || true)
if [[ -z "$RAW" ]]; then
  echo "refresh-token.sh: no 'Claude Code-credentials' entry found in the Keychain." >&2
  echo "Is Claude Code installed and signed in?" >&2
  exit 1
fi

TOKEN=$(printf '%s' "$RAW" | python3 -c '
import json, sys
data = json.loads(sys.stdin.read())
print(data["claudeAiOauth"]["accessToken"])
')

if [[ -z "$TOKEN" ]]; then
  echo "refresh-token.sh: extracted empty token, aborting." >&2
  exit 1
fi

# Atomic rewrite: build new file next to .env, then mv into place.
TMP=$(mktemp "${ENV_FILE}.XXXXXX")
trap 'rm -f "$TMP"' EXIT

if grep -q '^CLAUDE_CODE_OAUTH_TOKEN=' "$ENV_FILE"; then
  # Replace existing line. Use awk to avoid sed's escaping headaches with
  # the token value (which may contain characters sed treats specially).
  awk -v tok="$TOKEN" '
    /^CLAUDE_CODE_OAUTH_TOKEN=/ { print "CLAUDE_CODE_OAUTH_TOKEN=" tok; next }
    { print }
  ' "$ENV_FILE" > "$TMP"
else
  cp "$ENV_FILE" "$TMP"
  printf '\nCLAUDE_CODE_OAUTH_TOKEN=%s\n' "$TOKEN" >> "$TMP"
fi

mv "$TMP" "$ENV_FILE"
trap - EXIT

chmod 600 "$ENV_FILE"
echo "refresh-token.sh: CLAUDE_CODE_OAUTH_TOKEN refreshed in $ENV_FILE"
