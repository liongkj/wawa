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

if ! command -v tailscale >/dev/null; then
  say 'Tailscale connects your devices privately.'
  confirm 'Install Tailscale from its official installer now?' || fail 'Tailscale is required.'
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
  say 'Sign in to Tailscale on this server when prompted.'
  as_admin tailscale up
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
mkdir -p "$expected_project_dir"
install -m 600 "$scratch/compose.yml" "$expected_project_dir/compose.yml"
find "$install_dir/app" -mindepth 1 -maxdepth 1 ! -name deploy -exec rm -rf {} +

env_file="$install_dir/.env"
if [ ! -f "$env_file" ]; then
  need_tty
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
  local_port=$(python3 - <<'PY'
import socket
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    print(sock.getsockname()[1])
PY
  )
  say 'Choose a WhatsApp connection: 1) Standard  2) Lightweight, experimental'
  printf 'Choice [1]: ' > /dev/tty
  IFS= read -r choice < /dev/tty
  case "$choice" in ''|1) engine=whatsapp-web.js;; 2) engine=baileys;; *) fail 'Choose 1 or 2, then run this command again.';; esac
  say 'Choose a workspace password of at least 16 letters, numbers, hyphens or underscores.'
  while :; do
    printf 'Password: ' > /dev/tty
    IFS= read -r -s password < /dev/tty
    printf '\nConfirm password: ' > /dev/tty
    IFS= read -r -s confirmation < /dev/tty
    printf '\n' > /dev/tty
    if [ "$password" = "$confirmation" ] && [[ "$password" =~ ^[a-zA-Z0-9_-]{16,128}$ ]]; then break; fi
    say 'Passwords must match and use at least 16 allowed characters. Try again.'
  done
  umask 077
  env_tmp=$(mktemp "$install_dir/.env.XXXXXXXX")
  printf 'WAWA_ORIGIN=https://%s:%s\nWAWA_PORT=%s\nWAWA_ENGINE=%s\nAPP_PASSWORD=%s\n' \
    "$server_host" "$https_port" "$local_port" "$engine" "$password" > "$env_tmp"
  unset password confirmation
  mv "$env_tmp" "$env_file"
  env_tmp=''
fi

origin=$(sed -n 's/^WAWA_ORIGIN=//p' "$env_file")
local_port=$(sed -n 's/^WAWA_PORT=//p' "$env_file")
https_port=${origin##*:}
case "$origin" in "https://$server_host:"*) ;; *) fail 'The saved Wawa address does not match this server. Existing settings were left untouched.';; esac
case "$local_port:$https_port" in *[!0-9:]*|:*) fail 'The saved Wawa ports are invalid.';; esac
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

# A small updater lives next to the settings so a timer, or a person, can
# refresh the image without re-running the interactive parts above.
cat > "$install_dir/update.sh" <<EOF
#!/usr/bin/env bash
# Updates this Wawa server to the newest published image. Safe to re-run.
set -euo pipefail
install_dir=$(printf '%q' "$install_dir")
repo=$(printf '%q' "$repo")
ref=$(printf '%q' "$ref")
docker_cmd=($(printf '%q ' "${docker_cmd[@]}"))
compose_file="\$install_dir/app/deploy/server/compose.yml"
tmp=\$(mktemp "\$install_dir/.compose.XXXXXXXX")
trap 'rm -f "\$tmp"' EXIT
if curl -fsSL "https://raw.githubusercontent.com/\$repo/\$ref/deploy/server/compose.yml" -o "\$tmp" && grep -q '^services:' "\$tmp"; then
  install -m 600 "\$tmp" "\$compose_file"
fi
compose=("\${docker_cmd[@]}" compose --project-name wawa-server --env-file "\$install_dir/.env" -f "\$compose_file")
before=\$("\${compose[@]}" images -q wawa 2>/dev/null || true)
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
say 'Downloading the latest Wawa and starting it with its WhatsApp connection…'
"${compose[@]}" pull -q wawa openwa
"${compose[@]}" up -d --no-build --remove-orphans
if ! tailscale serve --bg --https="$https_port" "http://127.0.0.1:$local_port"; then
  say 'Administrator access is needed to finish the private connection.'
  as_admin tailscale serve --bg --https="$https_port" "http://127.0.0.1:$local_port"
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
  if curl -fsS --max-time 2 -H "Host: $server_host:$https_port" \
    "http://127.0.0.1:$local_port/api/health" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
[ "$ready" = true ] || fail 'The workspace did not become ready. Run this command again to retry; your data has not been removed.'
say "Wawa is ready at $origin"
say 'On your Mac, choose Use another computer in Wawa, enter that address and the password you chose.'
say 'Then link WhatsApp, select your conversations, and sign in to Codex.'
say "Your server files are in $install_dir. Keep the volumes and this folder backed up."
