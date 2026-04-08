#!/bin/sh
set -e

# Convert CLAUDE_CODE_OAUTH_TOKEN env var to credential file
if [ -n "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
  mkdir -p "$HOME/.claude"
  cat > "$HOME/.claude/.credentials.json" << EOF
{"claudeAiOauth":{"accessToken":"${CLAUDE_CODE_OAUTH_TOKEN}","refreshToken":"","expiresAt":"2027-01-01T00:00:00.000Z","scopes":["user:inference","user:profile"],"subscriptionType":"claude_pro"}}
EOF
fi

exec "$@"
