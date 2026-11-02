#!/usr/bin/env bash
set -euo pipefail

say() { printf '%s\n' "$*"; }
fail() { printf 'Wawa: %s\n' "$*" >&2; exit 1; }
as_admin() {
  if [ "$(id -u)" = 0 ]; then
    "$@"
  elif command -v sudo >/dev/null; then
    sudo "$@"
  else
    fail 'An administrator needs to run this step.'
  fi
}
need_tty() {
  [ -r /dev/tty ] && [ -w /dev/tty ] || fail 'Run this command in an interactive terminal.'
}
confirm() {
  local answer
  need_tty
  printf '%s [Y/n] ' "$1" > /dev/tty
  IFS= read -r answer < /dev/tty
  case "$answer" in ''|y|Y|yes|YES) return 0;; *) return 1;; esac
}
ask() {
  local answer
  need_tty
  printf '%s' "$1" > /dev/tty
  IFS= read -r answer < /dev/tty
  printf '%s' "$answer"
}

[ "$(uname -s)" = Linux ] || fail 'Run this installer on your Linux server.'
command -v curl >/dev/null || fail 'Install curl, then run this command again.'
command -v python3 >/dev/null || fail 'Install Python 3, then run this command again.'
repo=${WAWA_REPO:-liongkj/wawa}
ref=${WAWA_INSTALL_REF:-main}
case "$ref" in *[!a-zA-Z0-9._/-]*|*..*|/*|'') fail 'The Wawa source version is invalid.';; esac
case "$repo" in *[!a-zA-Z0-9._/-]*|*..*|/*|*/|'') fail 'The Wawa repository name is invalid.';; esac
scratch=$(mktemp -d "${TMPDIR:-/tmp}/wawa-install.XXXXXXXX")
env_tmp=''
cleanup() {
  rm -rf "$scratch"
  [ -z "$env_tmp" ] || rm -f "$env_tmp"
}
trap cleanup EXIT
if ! command -v docker >/dev/null; then
  say 'Wawa uses Docker to run its server and WhatsApp connection.'
  confirm 'Install Docker from its official installer now?' || fail 'Docker is required.'
  curl -fsSL https://get.docker.com -o "$scratch/install-docker.sh"
  sh "$scratch/install-docker.sh"
  if command -v systemctl >/dev/null; then as_admin systemctl enable --now docker; fi
fi
docker compose version >/dev/null 2>&1 || fail 'Install the Docker Compose plugin, then run this command again.'
docker_cmd=(docker)
if ! docker info >/dev/null 2>&1; then
  [ "$(id -u)" != 0 ] || fail 'Docker is not running.'
  command -v sudo >/dev/null || fail 'Docker is not accessible; ask an administrator to start it.'
  docker_cmd=(sudo docker)
  "${docker_cmd[@]}" info >/dev/null || fail 'Docker is not running or is not accessible.'
fi

install_dir=${WAWA_INSTALL_DIR:-"$HOME/.local/share/wawa-server"}
if [ -e "$install_dir" ] && [ ! -f "$install_dir/.wawa-managed" ]; then
  fail "The installation folder already exists and is not managed by this installer: $install_dir"
fi
expected_project_dir="$install_dir/app/deploy/server"
existing_projects=$("${docker_cmd[@]}" ps -a --filter label=com.docker.compose.project=wawa-server \
  --format '{{.Label "com.docker.compose.project.working_dir"}}' | sort -u)
if [ -n "$existing_projects" ] && [ "$existing_projects" != "$expected_project_dir" ]; then
  fail 'Another Wawa server uses this Docker project name. Its containers and data were not changed.'
fi
if [ ! -f "$install_dir/.wawa-managed" ] && { [ -n "$existing_projects" ] || [ -n "$("${docker_cmd[@]}" volume ls -q --filter label=com.docker.compose.project=wawa-server)" ]; }; then
  fail 'Existing Wawa server data was found. It was left untouched; restore or move it explicitly.'
fi
env_file="$install_dir/.env"
saved() { [ -f "$env_file" ] && sed -n "s/^$1=//p" "$env_file" | head -n 1; }

# How other computers reach the server. Installations from before this choice used Tailscale.
fresh_install=false
[ -f "$env_file" ] || fresh_install=true
if [ "$fresh_install" = false ]; then
  route=$(saved WAWA_ROUTE || true)
  route=${route:-tailscale}
else
  route=${WAWA_ROUTE:-}
  if [ -z "$route" ]; then
    say 'How should your other computers reach this server?'
    say '  1) Privately through Tailscale. Recommended for a computer at home.'
    say '  2) Privately through Tailscale, at your own domain on Cloudflare.'
    say '  3) Publicly through a domain you own. Recommended for a rented server.'
    say '  4) Through Cloudflare Tunnel, with a domain on Cloudflare. For a computer at home'
    say '     that cannot forward ports.'
    case "$(ask 'Choice [1]: ')" in
      ''|1) route=tailscale;;
      2) route=tailscale-domain;;
      3) route=domain;;
      4) route=cloudflare;;
      *) fail 'Choose 1, 2, 3 or 4, then run this command again.';;
    esac
  fi
fi
case "$route" in tailscale|tailscale-domain|domain|cloudflare) ;; *) fail 'WAWA_ROUTE must be tailscale, tailscale-domain, domain or cloudflare.';; esac
on_tailnet=false
case "$route" in tailscale|tailscale-domain) on_tailnet=true;; esac

server_host='' domain=''
if [ "$on_tailnet" = true ]; then
  if ! command -v tailscale >/dev/null; then
    say 'Tailscale connects your devices privately.'
    confirm 'Install Tailscale from its official installer now?' || fail 'Tailscale is required for a private server.'
    curl -fsSL https://tailscale.com/install.sh -o "$scratch/install-tailscale.sh"
    sh "$scratch/install-tailscale.sh"
  fi
  if ! tailscale status --json > "$scratch/tailscale-status.json" 2>/dev/null ||
    ! python3 - "$scratch/tailscale-status.json" <<'PY'
import json, sys
with open(sys.argv[1]) as source:
    status = json.load(source)
sys.exit(0 if status.get('BackendState') == 'Running' else 1)
PY
  then
    need_tty
    say 'Sign in to Tailscale on this server when prompted. You can scan the code with your phone.'
    as_admin tailscale up --qr
    tailscale status --json > "$scratch/tailscale-status.json"
  fi
  server_host=$(python3 - "$scratch/tailscale-status.json" <<'PY'
import json, re, sys
with open(sys.argv[1]) as source:
    status = json.load(source)
self_node = status.get('Self') or {}
host = (self_node.get('DNSName') or '').rstrip('.')
if not self_node.get('Online') or not re.fullmatch(r'[a-zA-Z0-9.-]+\.ts\.net', host):
    raise SystemExit('Connect this server to Tailscale before installing Wawa.')
print(host)
PY
  )
fi

valid_domain() {
  [[ "$1" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]]
}
# Cloudflare API calls read the token from a private header file, never from arguments.
cloudflare() {
  local method=$1 path=$2 data=${3:-}
  local args=(-fsS --max-time 20 -X "$method" -H "@$scratch/cloudflare-auth" -H 'Content-Type: application/json')
  [ -z "$data" ] || args+=(--data "$data")
  curl "${args[@]}" "${CLOUDFLARE_API:-https://api.cloudflare.com/client/v4}$path"
}
point_domain_at_tailnet() {
  local name=$1 target=$2 zone='' suffix=$1 found
  # The zone is the longest suffix of the name that Cloudflare knows, such as example.com.
  while [[ "$suffix" == *.* ]]; do
    found=$(cloudflare GET "/zones?name=$suffix" | python3 -c 'import json,sys; r=json.load(sys.stdin).get("result") or []; print(r[0]["id"] if r else "")') ||
      fail 'Cloudflare refused the API token. Create one with Zone, DNS, Edit permission for your domain.'
    if [ -n "$found" ]; then zone=$found; break; fi
    suffix=${suffix#*.}
  done
  [ -n "$zone" ] || fail "No Cloudflare zone for $name is visible to this token."
  cloudflare GET "/zones/$zone/dns_records?name=$name" > "$scratch/records.json" ||
    fail 'Cloudflare refused to list DNS records. Give the token Zone, DNS, Edit permission.'
  local plan
  plan=$(python3 - "$scratch/records.json" "$target" <<'PY'
import json, sys
records = json.load(open(sys.argv[1])).get('result') or []
target = sys.argv[2]
others = [r for r in records if r.get('type') != 'CNAME']
cname = [r for r in records if r.get('type') == 'CNAME']
if others:
    print('conflict ' + others[0].get('type', 'record'))
elif not cname:
    print('create')
elif cname[0].get('content') == target and not cname[0].get('proxied'):
    print('keep')
else:
    print('update ' + cname[0]['id'])
PY
  )
  local record
  record=$(python3 -c 'import json,sys; print(json.dumps({"type":"CNAME","name":sys.argv[1],"content":sys.argv[2],"proxied":False,"ttl":1}))' "$name" "$target")
  case "$plan" in
    conflict*) fail "$name already has a ${plan#conflict } record in Cloudflare. Remove it or choose another name, then run this command again.";;
    create) cloudflare POST "/zones/$zone/dns_records" "$record" >/dev/null || fail 'Cloudflare refused to create the DNS record.';;
    update*) cloudflare PUT "/zones/$zone/dns_records/${plan#update }" "$record" >/dev/null || fail 'Cloudflare refused to update the DNS record.';;
  esac
  say "$name points to $target, which only your tailnet can reach."
}
check_domain_points_here() {
  local public_ip resolved
  public_ip=$(curl -4 -fsS --max-time 10 https://checkip.amazonaws.com | tr -d '[:space:]') ||
    fail "Could not find this server's public address. Check its internet connection."
  resolved=$(getent ahostsv4 "$1" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ' || true)
  case " $resolved " in
    *" $public_ip "*) ;;
    *) fail "Point an A record for $1 to $public_ip at your DNS provider, wait until it takes effect, then run this command again. It now resolves to: ${resolved:-nothing}";;
  esac
}

if [ ! -d "$install_dir" ]; then
  mkdir -p "$install_dir"
  chmod 700 "$install_dir"
  printf 'wawa-server-v1\n' > "$install_dir/.wawa-managed"
fi

# The server runs from the image published by GitHub Actions. Only the Compose
# file is fetched from the repository, and it is refreshed on every run so an
# update picks up service changes along with the new image.
say 'Fetching the Wawa server definition…'
curl -fsSL "https://raw.githubusercontent.com/$repo/$ref/deploy/server/compose.yml" -o "$scratch/compose.yml"
grep -q '^services:' "$scratch/compose.yml" || fail 'That Wawa version does not include the server installer.'
grep -q 'ghcr.io/' "$scratch/compose.yml" || fail 'That Wawa version does not publish a server image. Use a newer version.'
if [ "$route" != tailscale ]; then
  grep -q "profiles: \[$route\]" "$scratch/compose.yml" || fail 'That Wawa version does not support this connection route. Use a newer version.'
fi
mkdir -p "$expected_project_dir"
install -m 600 "$scratch/compose.yml" "$expected_project_dir/compose.yml"
find "$install_dir/app" -mindepth 1 -maxdepth 1 ! -name deploy -exec rm -rf {} +

if [ "$fresh_install" = true ]; then
  local_port=$(python3 - <<'PY'
import socket
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    print(sock.getsockname()[1])
PY
  )
  tls_port=''
  engine=${WAWA_ENGINE:-whatsapp-web.js}
  case "$engine" in whatsapp-web.js|baileys) ;; *) fail 'WAWA_ENGINE must be whatsapp-web.js or baileys.';; esac
  domain='' tunnel_token='' api_token='' proxies=''
  case "$route" in
    tailscale)
      tailscale serve status --json > "$scratch/serve.json"
      https_port=$(python3 - "$scratch/serve.json" <<'PY'
import json, sys
with open(sys.argv[1]) as source:
    used = (json.load(source).get('TCP') or {})
for port in range(8443, 8543):
    if str(port) not in used:
        print(port)
        break
else:
    raise SystemExit('No free Tailscale HTTPS port was found.')
PY
      )
      origin="https://$server_host:$https_port"
      ;;
    tailscale-domain|domain|cloudflare)
      domain=${WAWA_DOMAIN:-}
      [ -n "$domain" ] || domain=$(ask 'Domain for this server, such as tasks.example.com: ')
      domain=$(printf '%s' "$domain" | tr '[:upper:]' '[:lower:]')
      valid_domain "$domain" || fail 'Enter a domain such as tasks.example.com, without https:// or a path.'
      origin="https://$domain"
      # Every request reaches Wawa through the proxy container, so lockouts must count the
      # forwarded client. Only containers on Docker's private networks may set that header.
      proxies='172.16.0.0/12,192.168.0.0/16'
      if [ "$route" = tailscale-domain ]; then
        tailscale serve status --json > "$scratch/serve.json"
        python3 - "$scratch/serve.json" <<'PY' || fail 'Port 443 on this server is already served by Tailscale. Free it, or choose the Tailscale route, then run this command again.'
import json, sys
sys.exit(1 if '443' in (json.load(open(sys.argv[1])).get('TCP') or {}) else 0)
PY
        tls_port=$(python3 - <<'PY'
import socket
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    print(sock.getsockname()[1])
PY
        )
        say "Create a Cloudflare API token with Zone, DNS, Edit permission for $domain's zone."
        api_token=${WAWA_CLOUDFLARE_API_TOKEN:-}
        if [ -z "$api_token" ]; then
          need_tty
          printf 'Cloudflare API token: ' > /dev/tty
          IFS= read -r -s api_token < /dev/tty
          printf '\n' > /dev/tty
        fi
        [[ "$api_token" =~ ^[A-Za-z0-9_-]+$ ]] && [ "${#api_token}" -ge 30 ] && [ "${#api_token}" -le 200 ] ||
          fail 'That does not look like a Cloudflare API token. Copy it again from your Cloudflare profile.'
        ( umask 077; printf 'Authorization: Bearer %s\n' "$api_token" > "$scratch/cloudflare-auth" )
        point_domain_at_tailnet "$domain" "$server_host"
      elif [ "$route" = domain ]; then
        check_domain_points_here "$domain"
      else
        say "In Cloudflare Zero Trust, create a tunnel, add the public hostname $domain with the"
        say 'service http://wawa:2786, and copy the tunnel token.'
        tunnel_token=${WAWA_TUNNEL_TOKEN:-}
        if [ -z "$tunnel_token" ]; then
          need_tty
          printf 'Tunnel token: ' > /dev/tty
          IFS= read -r -s tunnel_token < /dev/tty
          printf '\n' > /dev/tty
        fi
        [[ "$tunnel_token" =~ ^[A-Za-z0-9+/=_-]+$ ]] && [ "${#tunnel_token}" -ge 40 ] && [ "${#tunnel_token}" -le 4096 ] || fail 'That does not look like a Cloudflare tunnel token. Copy it again from the tunnel page.'
      fi
      ;;
  esac
  # Browsers still sign in with a password; computers pair with a code instead.
  password=$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')
  umask 077
  # Shown once at the end of the first run that gets that far, even if this run fails later.
  : > "$install_dir/.password-pending"
  env_tmp=$(mktemp "$install_dir/.env.XXXXXXXX")
  {
    printf 'WAWA_ROUTE=%s\nWAWA_ORIGIN=%s\nWAWA_PORT=%s\nWAWA_ENGINE=%s\nAPP_PASSWORD=%s\n' \
      "$route" "$origin" "$local_port" "$engine" "$password"
    [ -z "$domain" ] || printf 'WAWA_DOMAIN=%s\n' "$domain"
    [ -z "$proxies" ] || printf 'TRUSTED_PROXIES=%s\n' "$proxies"
    [ -z "$tunnel_token" ] || printf 'CLOUDFLARE_TUNNEL_TOKEN=%s\n' "$tunnel_token"
    [ -z "$api_token" ] || printf 'CLOUDFLARE_API_TOKEN=%s\n' "$api_token"
    [ -z "$tls_port" ] || printf 'WAWA_TLS_PORT=%s\n' "$tls_port"
  } > "$env_tmp"
  unset tunnel_token api_token password
  mv "$env_tmp" "$env_file"
  env_tmp=''
fi

origin=$(saved WAWA_ORIGIN)
local_port=$(saved WAWA_PORT)
case "$local_port" in ''|*[!0-9]*) fail 'The saved Wawa port is invalid.';; esac
if [ "$route" = tailscale ]; then
  https_port=${origin##*:}
  case "$origin" in "https://$server_host:"*) ;; *) fail 'The saved Wawa address does not match this server. Existing settings were left untouched.';; esac
  case "$https_port" in ''|*[!0-9]*) fail 'The saved Wawa ports are invalid.';; esac
  tailscale serve status --json > "$scratch/serve.json"
  python3 - "$scratch/serve.json" "$server_host" "$https_port" "$local_port" <<'PY'
import json, sys
with open(sys.argv[1]) as source:
    config = json.load(source)
host, port, local = sys.argv[2:]
used = str(port) in (config.get('TCP') or {})
target = (((config.get('Web') or {}).get(f'{host}:{port}') or {}).get('Handlers') or {}).get('/', {}).get('Proxy')
if used and target != f'http://127.0.0.1:{local}':
    raise SystemExit('The saved Tailscale port is used by another service; nothing was changed.')
PY
else
  domain=$(saved WAWA_DOMAIN)
  if [ "$origin" != "https://$domain" ] || ! valid_domain "$domain"; then
    fail 'The saved Wawa domain is invalid. Existing settings were left untouched.'
  fi
fi
if [ "$route" = tailscale-domain ]; then
  tls_port=$(saved WAWA_TLS_PORT)
  case "$tls_port" in ''|*[!0-9]*) fail 'The saved Wawa ports are invalid.';; esac
  tailscale serve status --json > "$scratch/serve.json"
  python3 - "$scratch/serve.json" "$tls_port" <<'PY'
import json, sys
used = (json.load(open(sys.argv[1])).get('TCP') or {}).get('443')
if used and used.get('TCPForward') != f'127.0.0.1:{sys.argv[2]}':
    raise SystemExit('Port 443 is served by another Tailscale service; nothing was changed.')
PY
fi

# A small helper lives next to the settings so a timer, or a person, can refresh the
# image, create pairing codes, or show the password without the interactive parts above.
cat > "$install_dir/update.sh" <<EOF
#!/usr/bin/env bash
# Wawa server helper. Safe to re-run.
#   update.sh                            update to the newest published image
#   update.sh pair [--days 30|90|365]    print a code for pairing a computer
#   update.sh password                   show the password for signing in from a browser
set -euo pipefail
install_dir=$(printf '%q' "$install_dir")
repo=$(printf '%q' "$repo")
ref=$(printf '%q' "$ref")
docker_cmd=($(printf '%q ' "${docker_cmd[@]}"))
compose_file="\$install_dir/app/deploy/server/compose.yml"
route=\$(sed -n 's/^WAWA_ROUTE=//p' "\$install_dir/.env" | head -n 1)
compose=("\${docker_cmd[@]}" compose --project-name wawa-server --env-file "\$install_dir/.env" -f "\$compose_file")
case "\${route:-tailscale}" in tailscale-domain|domain|cloudflare) compose+=(--profile "\$route");; esac
case "\${1:-}" in
  pair) shift; exec "\${compose[@]}" exec -T wawa node dist/server/pair-cli.js "\$@";;
  password) sed -n 's/^APP_PASSWORD=//p' "\$install_dir/.env"; exit 0;;
  '') ;;
  *) echo 'Usage: update.sh [pair [--days 30|90|365] | password]' >&2; exit 2;;
esac
tmp=\$(mktemp "\$install_dir/.compose.XXXXXXXX")
trap 'rm -f "\$tmp"' EXIT
if curl -fsSL "https://raw.githubusercontent.com/\$repo/\$ref/deploy/server/compose.yml" -o "\$tmp" && grep -q '^services:' "\$tmp"; then
  install -m 600 "\$tmp" "\$compose_file"
fi
before=\$("\${compose[@]}" images -q wawa 2>/dev/null || true)
[ "\$route" != tailscale-domain ] || "\${compose[@]}" build -q --pull caddy-tailnet
"\${compose[@]}" pull -q wawa openwa
"\${compose[@]}" up -d --no-build --remove-orphans
after=\$("\${compose[@]}" images -q wawa 2>/dev/null || true)
if [ "\$before" != "\$after" ]; then
  "\${docker_cmd[@]}" image prune -f --filter label=org.opencontainers.image.source=https://github.com/\$repo >/dev/null 2>&1 || true
  echo "Wawa updated."
else
  echo "Wawa is already up to date."
fi
EOF
chmod 700 "$install_dir/update.sh"

compose=("${docker_cmd[@]}" compose --project-name wawa-server --env-file "$env_file" -f "$expected_project_dir/compose.yml")
[ "$route" = tailscale ] || compose+=(--profile "$route")
say 'Downloading the latest Wawa and starting it with its WhatsApp connection…'
if [ "$route" = tailscale-domain ]; then
  say 'Building Caddy with Cloudflare DNS support. The first build takes a few minutes…'
  "${compose[@]}" build -q --pull caddy-tailnet
fi
"${compose[@]}" pull -q wawa openwa
"${compose[@]}" up -d --no-build --remove-orphans
serve_args=()
case "$route" in
  tailscale) serve_args=(--bg --https="$https_port" "http://127.0.0.1:$local_port");;
  tailscale-domain) serve_args=(--bg --tcp=443 "tcp://127.0.0.1:$tls_port");;
esac
if [ "${#serve_args[@]}" -gt 0 ] && ! tailscale serve "${serve_args[@]}"; then
  say 'Administrator access is needed to finish the private connection.'
  as_admin tailscale serve "${serve_args[@]}"
fi

auto_update=${WAWA_AUTO_UPDATE:-1}
if [ "$auto_update" != 0 ] && command -v systemctl >/dev/null && [ -d /etc/systemd/system ]; then
  run_as=$(id -un)
  [ "${docker_cmd[0]}" != sudo ] || run_as=root
  cat > "$scratch/wawa-server-update.service" <<EOF
[Unit]
Description=Update the Wawa server to the newest published image
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$run_as
ExecStart=$install_dir/update.sh
EOF
  cat > "$scratch/wawa-server-update.timer" <<'EOF'
[Unit]
Description=Check for Wawa server updates daily

[Timer]
OnCalendar=*-*-* 04:30:00
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
EOF
  if as_admin install -m 644 "$scratch/wawa-server-update.service" "$scratch/wawa-server-update.timer" /etc/systemd/system/ &&
    as_admin systemctl daemon-reload && as_admin systemctl enable --now wawa-server-update.timer >/dev/null 2>&1; then
    say 'Wawa will check for updates every night. Run update.sh in the server folder to update now.'
  else
    say "Automatic updates were not enabled. Run $install_dir/update.sh to update."
  fi
elif [ "$auto_update" != 0 ]; then
  say "This system has no systemd. Schedule $install_dir/update.sh yourself to receive updates."
fi

say 'Checking that your workspace is ready…'
ready=false
for _ in $(seq 1 60); do
  if curl -fsS --max-time 2 -H "Host: ${origin#https://}" \
    "http://127.0.0.1:$local_port/api/health" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
[ "$ready" = true ] || fail 'The workspace did not become ready. Run this command again to retry; your data has not been removed.'
if [ "$route" != tailscale ]; then
  say "Checking that $origin reaches this server…"
  reachable=false
  # Certificates over Cloudflare DNS wait for the record to propagate.
  for _ in $(seq 1 90); do
    if curl -fsS --max-time 5 "$origin/api/pair/info" >/dev/null 2>&1; then
      reachable=true
      break
    fi
    sleep 2
  done
  if [ "$reachable" != true ]; then
    if [ "$route" = domain ]; then
      fail "Wawa is running, but $origin did not answer. Open ports 80 and 443 to this server in its firewall and at your hosting provider, then run this command again."
    fi
    if [ "$route" = tailscale-domain ]; then
      fail "Wawa is running, but $origin did not answer. Check that this server uses Tailscale DNS (tailscale set --accept-dns) and that the Cloudflare token can edit DNS, then run this command again."
    fi
    fail "Wawa is running, but $origin did not answer. In Cloudflare, check that the tunnel is healthy and that $domain points to http://wawa:2786, then run this command again."
  fi
fi

pairing=$("${compose[@]}" exec -T wawa node dist/server/pair-cli.js) ||
  fail "Wawa is running, but no pairing code could be created. Run $install_dir/update.sh pair to try again."
find_it="type $domain"
[ "$route" != tailscale ] || find_it="pick ${server_host%%.*}"
say ''
say 'Wawa is ready.'
say "$pairing"
if [ -f "$install_dir/.password-pending" ]; then
  say ''
  say "Password for signing in from a browser: $(saved APP_PASSWORD)"
  say "It is shown only now. Run $install_dir/update.sh password to see it again."
  rm -f "$install_dir/.password-pending"
fi
say ''
say "On your Mac, open Wawa, choose Use another computer, $find_it, and enter the code."
say "For another computer later, run $install_dir/update.sh pair"
say 'Then link WhatsApp, select your conversations, and sign in to Codex.'
say "Your server files are in $install_dir. Keep the volumes and this folder backed up."
