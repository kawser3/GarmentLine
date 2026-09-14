#!/usr/bin/env bash
# Generate a self-signed cert for the local dev domain and (optionally) trust it.
#
# Why this is necessary: the Blocks SSO callback sets a Secure, domain-scoped session
# cookie. A browser will not store that cookie on http://localhost, so the dev server has
# to serve HTTPS on the project's real domain. That needs a cert whose subjectAltName
# contains the exact domain.
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"

DOMAIN="${1:-calculator.seliselocal.com}"
DIR=.cert
mkdir -p "$DIR"

if [ -f "$DIR/dev-cert.pem" ] && openssl x509 -in "$DIR/dev-cert.pem" -noout -checkend 86400 >/dev/null 2>&1 \
   && openssl x509 -in "$DIR/dev-cert.pem" -noout -text | grep -q "DNS:$DOMAIN"; then
  echo "cert for $DOMAIN already valid: $DIR/dev-cert.pem"
  openssl x509 -in "$DIR/dev-cert.pem" -noout -subject -enddate | sed 's/^/  /'
  exit 0
fi

echo "==> generating a self-signed cert for $DOMAIN"
openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes \
  -keyout "$DIR/dev-key.pem" -out "$DIR/dev-cert.pem" \
  -subj "/CN=$DOMAIN/O=Blocks Calculator Local Dev" \
  -addext "subjectAltName=DNS:$DOMAIN" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth" 2>/dev/null
chmod 600 "$DIR/dev-key.pem"
echo "  wrote $DIR/dev-cert.pem and $DIR/dev-key.pem"

# The hosts entry must point the domain at this machine.
if getent hosts "$DOMAIN" | grep -qE '^(127\.0\.0\.1|::1)'; then
  echo "==> hosts entry OK: $DOMAIN -> $(getent hosts "$DOMAIN" | awk '{print $1}' | head -1)"
else
  cat <<EOF
==> hosts entry MISSING. Add it yourself (needs sudo):
      echo "127.0.0.1 $DOMAIN" | sudo tee -a /etc/hosts
EOF
fi

cat <<EOF

==> trust the cert so the browser doesn't warn (optional but recommended):

  Linux (system store, then restart the browser):
      sudo cp $DIR/dev-cert.pem /usr/local/share/ca-certificates/$DOMAIN.crt
      sudo update-ca-certificates

  Firefox and Chrome keep their own stores — you may still need to accept the
  warning once, or import $DIR/dev-cert.pem under Settings > Certificates.

Then: npm run dev   ->   https://$DOMAIN:5173
EOF
