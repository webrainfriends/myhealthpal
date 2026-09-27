#!/usr/bin/env bash
# Serves the app on its own domain (e.g. eyemyhealth.com + www.) on the
# standard ports 80/443, alongside - never instead of - the existing
# http://<host>:5250 site the deploy workflow already configures.
#
# It adds a separate nginx site that answers only for $DOMAIN and
# www.$DOMAIN and forwards every request to that existing :5250 site, so
# there's still exactly one place (the :5250 site) that knows how the web
# build and /api/ are served. HTTPS comes from a free Let's Encrypt
# certificate, requested once DNS for the domain points at this host and
# renewed automatically by certbot's own timer afterwards.
#
# Called by .github/workflows/deploy.yml on every deploy. Idempotent, and
# built so that it can never take the existing :5250 site (or any other app
# on this shared host) down with it:
#   - it only ever touches its own site file (sites-available/$SITE_NAME)
#     and never claims default_server, so other sites on ports 80/443 keep
#     answering for their own hostnames;
#   - if something other than nginx already holds port 80 or 443, it skips;
#   - every config change is checked with `nginx -t` first and rolled back
#     if it fails, so nginx is never reloaded with a broken config;
#   - a failed certificate request (DNS not pointed yet, port 80 closed in
#     the security group, Let's Encrypt rate limit) just leaves the domain
#     on plain HTTP until the next deploy - it never fails the deploy.
#
# Environment:
#   DOMAIN             e.g. eyemyhealth.com (empty -> do nothing)
#   UPSTREAM_PORT      the existing app port nginx serves on (5250)
#   LETSENCRYPT_EMAIL  optional - where Let's Encrypt sends expiry notices

set -euo pipefail

DOMAIN="${DOMAIN:-}"
UPSTREAM_PORT="${UPSTREAM_PORT:?UPSTREAM_PORT is required}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"

# Overridable only so this script can be exercised outside a real host.
NGINX_DIR="${NGINX_DIR:-/etc/nginx}"
ACME_ROOT="${ACME_ROOT:-/var/www/certbot}"
LE_DIR="${LE_DIR:-/etc/letsencrypt}"
SUDO="${SUDO-sudo}"
SKIP_PORT_CHECK="${SKIP_PORT_CHECK:-}"
SKIP_CERTBOT="${SKIP_CERTBOT:-}"
NGINX_RELOAD="${NGINX_RELOAD:-systemctl reload nginx}"

SITE_NAME=myhealthpal-domain
SITE_FILE="$NGINX_DIR/sites-available/$SITE_NAME"
SITE_LINK="$NGINX_DIR/sites-enabled/$SITE_NAME"

log() { echo "[domain] $*"; }

if [ -z "$DOMAIN" ]; then
  log "DOMAIN not set - skipping custom domain setup"
  exit 0
fi

# Something other than nginx (e.g. another app's Docker container) already
# bound to 80/443 would make nginx fail to start/reload - leave it alone.
port_taken_by_other() {
  local port="$1" owners
  owners="$($SUDO ss -ltnpH "sport = :$port" 2>/dev/null || true)"
  [ -n "$owners" ] && ! grep -q '"nginx"' <<<"$owners"
}
if [ -z "$SKIP_PORT_CHECK" ]; then
  for port in 80 443; do
    if port_taken_by_other "$port"; then
      log "port $port is already used by something other than nginx - skipping $DOMAIN setup so nothing else on this host breaks"
      exit 0
    fi
  done
fi

# Only include www.$DOMAIN when it actually resolves, so a missing www DNS
# record doesn't fail the whole certificate request.
NAMES=("$DOMAIN")
if getent hosts "www.$DOMAIN" >/dev/null 2>&1 || [ -n "${FORCE_WWW:-}" ]; then
  NAMES+=("www.$DOMAIN")
fi
SERVER_NAMES="${NAMES[*]}"

CERT_DIR="$LE_DIR/live/$DOMAIN"

proxy_block() {
  cat <<EOF
    location / {
        proxy_pass http://127.0.0.1:${UPSTREAM_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        # Report uploads + AI extraction can take a while.
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
EOF
}

render_config() {
  local with_tls="$1"
  cat <<EOF
# Managed by scripts/configure-domain.sh - rewritten on every deploy.
# Forwards $SERVER_NAMES to the existing app site on port ${UPSTREAM_PORT}.
server {
    listen 80;
    server_name ${SERVER_NAMES};

    client_max_body_size 25m;

    # Let's Encrypt HTTP-01 challenges (issue + renew).
    location ^~ /.well-known/acme-challenge/ {
        root ${ACME_ROOT};
        default_type text/plain;
    }

EOF
  if [ "$with_tls" = yes ]; then
    cat <<'EOF'
    location / {
        return 301 https://$host$request_uri;
    }
}

EOF
    cat <<EOF
server {
    listen 443 ssl;
    server_name ${SERVER_NAMES};

    ssl_certificate ${CERT_DIR}/fullchain.pem;
    ssl_certificate_key ${CERT_DIR}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:myhealthpal_ssl:10m;
    ssl_session_timeout 1d;

    client_max_body_size 25m;

$(proxy_block)
}
EOF
  else
    proxy_block
    echo '}'
  fi
}

# Writes the config, validates it, and reloads nginx - or restores the
# previous state and returns non-zero if nginx rejects it.
apply_config() {
  local with_tls="$1" backup=""
  if $SUDO test -f "$SITE_FILE"; then
    backup="$(mktemp)"
    $SUDO cat "$SITE_FILE" >"$backup"
  fi
  render_config "$with_tls" | $SUDO tee "$SITE_FILE" >/dev/null
  $SUDO ln -sf "$SITE_FILE" "$SITE_LINK"
  if $SUDO nginx -t >/dev/null 2>&1; then
    [ -n "$backup" ] && rm -f "$backup"
    $SUDO $NGINX_RELOAD
    return 0
  fi
  log "nginx rejected the $DOMAIN config - rolling back"
  $SUDO nginx -t || true
  if [ -n "$backup" ]; then
    $SUDO tee "$SITE_FILE" <"$backup" >/dev/null
    rm -f "$backup"
  else
    $SUDO rm -f "$SITE_LINK" "$SITE_FILE"
  fi
  return 1
}

$SUDO mkdir -p "$ACME_ROOT"

have_cert() { $SUDO test -s "$CERT_DIR/fullchain.pem" && $SUDO test -s "$CERT_DIR/privkey.pem"; }

if have_cert; then
  if apply_config yes; then
    log "https://$DOMAIN is live (certificate renews automatically)"
  elif apply_config no; then
    log "the certificate for $DOMAIN was rejected - serving it over http for now"
  else
    log "could not enable $DOMAIN - the existing :$UPSTREAM_PORT site is unaffected"
  fi
  exit 0
fi

# No certificate yet: serve plain HTTP first (which also answers the
# Let's Encrypt challenge), then try to get one.
if ! apply_config no; then
  log "could not enable $DOMAIN - the existing :$UPSTREAM_PORT site is unaffected"
  exit 0
fi
log "http://$DOMAIN is live"

if [ -n "$SKIP_CERTBOT" ]; then
  exit 0
fi

# Asking Let's Encrypt before DNS points here only burns its failed-
# validation rate limit - check first.
public_ip="$(curl -fsS --max-time 5 https://checkip.amazonaws.com 2>/dev/null | tr -d '[:space:]' || true)"
domain_ip="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1 {print $1}' || true)"
if [ -z "$public_ip" ] || [ "$domain_ip" != "$public_ip" ]; then
  log "$DOMAIN resolves to '${domain_ip:-nothing}', this host is '${public_ip:-unknown}' - add a DNS A record for $DOMAIN (and www) pointing at this host; HTTPS will be set up on the next deploy after that"
  exit 0
fi

if ! command -v certbot >/dev/null 2>&1; then
  log "installing certbot"
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq certbot
fi

email_args=(--register-unsafely-without-email)
[ -n "$LETSENCRYPT_EMAIL" ] && email_args=(--email "$LETSENCRYPT_EMAIL")
domain_args=()
for name in "${NAMES[@]}"; do domain_args+=(-d "$name"); done

if $SUDO certbot certonly --webroot -w "$ACME_ROOT" "${domain_args[@]}" \
  --cert-name "$DOMAIN" --non-interactive --agree-tos "${email_args[@]}" \
  --keep-until-expiring --expand --deploy-hook "systemctl reload nginx"; then
  if apply_config yes; then
    log "https://$DOMAIN is live (certificate renews automatically)"
  fi
else
  log "certificate request failed (is port 80 open to the internet in the security group?) - $DOMAIN stays on http for now; will retry next deploy"
fi
