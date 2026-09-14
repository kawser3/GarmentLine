#!/bin/sh
# Write /config.js from container environment variables, before nginx starts.
#
# Why this exists: Vite inlines VITE_* values at BUILD time, but the Blocks pipeline
# supplies configuration as Kubernetes `env-vars` at RUNTIME. Without this step those
# variables would be invisible to the SPA and the deployment would silently use whatever
# was baked into the image. Writing config.js keeps one image usable across dev/stg/prod.
#
# Accepts each setting with or without the VITE_ prefix, since the portal's env-vars are
# plain container variables and the prefix only means something to Vite.
set -eu

TARGET=/usr/share/nginx/html/config.js

# Escape backslashes and double quotes so a value cannot break out of the JS string.
esc() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

pick() {
  # pick VAR_NAME -> value of VITE_<name> if set, else <name>, else empty
  eval "v=\${VITE_$1:-}"
  [ -n "${v:-}" ] || eval "v=\${$1:-}"
  printf '%s' "${v:-}"
}

API_URL=$(pick BLOCKS_API_URL)
PROJECT_KEY=$(pick BLOCKS_PROJECT_KEY)
CLIENT_ID=$(pick BLOCKS_OIDC_CLIENT_ID)
REDIRECT_URI=$(pick BLOCKS_REDIRECT_URI)

cat > "$TARGET" <<EOF
// Generated at container start by 30-blocks-runtime-config.sh — do not edit.
// Empty values fall back to the build-time value, then to a same-site default
// derived from the browser's hostname (see src/lib/env.ts).
window.__BLOCKS_CONFIG__ = {
  apiUrl: "$(esc "$API_URL")",
  projectKey: "$(esc "$PROJECT_KEY")",
  oidcClientId: "$(esc "$CLIENT_ID")",
  redirectUri: "$(esc "$REDIRECT_URI")"
};
EOF

echo "30-blocks-runtime-config: wrote $TARGET (apiUrl='${API_URL:-<derived>}' projectKey=$([ -n "$PROJECT_KEY" ] && echo set || echo '<build-time>'))"
