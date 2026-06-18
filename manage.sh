#!/usr/bin/env bash
# =============================================================================
#  اَل من خورا (AleManKhora) — management console
#  Run:  ./manage.sh            (interactive menu)
#        ./manage.sh <command>  (non-interactive)
#  Commands: install | update | start | stop | restart | status | logs
#            backup | restore | port | seed | uninstall
# =============================================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

RUN_DIR="$APP_DIR/run"
LOG_DIR="$APP_DIR/logs"
BACKUP_DIR="$APP_DIR/backups"
PID_FILE="$RUN_DIR/alemankhora.pid"
LOG_FILE="$LOG_DIR/alemankhora.log"
SERVICE="alemankhora"
mkdir -p "$RUN_DIR" "$LOG_DIR" "$BACKUP_DIR"

C_G='\033[1;32m'; C_Y='\033[1;33m'; C_R='\033[1;31m'; C_B='\033[1;36m'; C_0='\033[0m'
say()  { printf "${C_B}▸ %s${C_0}\n" "$*"; }
ok()   { printf "${C_G}✓ %s${C_0}\n" "$*"; }
warn() { printf "${C_Y}! %s${C_0}\n" "$*"; }
err()  { printf "${C_R}✗ %s${C_0}\n" "$*" >&2; }

get_port() { grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 || echo 3000; }

detect_pm() {
  if command -v apt-get >/dev/null 2>&1; then echo apt;
  elif command -v dnf >/dev/null 2>&1; then echo dnf;
  elif command -v yum >/dev/null 2>&1; then echo yum;
  elif command -v pacman >/dev/null 2>&1; then echo pacman;
  elif command -v apk >/dev/null 2>&1; then echo apk;
  else echo none; fi
}

have_systemd_unit() {
  command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q "^${SERVICE}.service"
}
use_systemd() { have_systemd_unit; }
sd() { if [ "$(id -u)" = "0" ]; then systemctl "$@"; else sudo systemctl "$@"; fi; }

# ----------------------------- lifecycle ------------------------------------

cmd_install() {
  say "Installing dependencies"
  npm install --omit=dev
  if [ ! -f .env ]; then
    local secret; secret="$(node -e 'console.log(require("crypto").randomBytes(48).toString("hex"))')"
    printf "PORT=3000\nJWT_SECRET=%s\n" "$secret" > .env
    ok "Created .env"
  fi
  ok "Install complete"
}

cmd_update() {
  say "Updating from git"
  if [ -d .git ]; then
    local branch; branch="$(git rev-parse --abbrev-ref HEAD)"
    git fetch --all --prune
    git pull --ff-only origin "$branch" || warn "Could not fast-forward (local changes?)"
  else
    warn "Not a git checkout — skipping git pull"
  fi
  npm install --omit=dev
  ok "Updated — restarting"
  cmd_restart
}

is_running() {
  if use_systemd; then sd is-active --quiet "$SERVICE"; return $?; fi
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

# Find any process listening on our port (catches orphans the PID file missed).
pids_on_port() {
  local port; port="$(get_port)"
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp 2>/dev/null | grep -oE "pid=[0-9]+" | grep -oE "[0-9]+" | while read -r pid; do
      ss -ltnp 2>/dev/null | grep ":$port " | grep -q "pid=$pid," && echo "$pid"
    done | sort -u
  elif command -v lsof >/dev/null 2>&1; then
    lsof -ti ":$port" -sTCP:LISTEN 2>/dev/null
  fi
}

cmd_start() {
  if is_running; then ok "Already running"; return; fi
  if use_systemd; then say "Starting via systemd"; sd start "$SERVICE"; ok "Started"; return; fi
  # Guard: clear any orphan holding our port so we don't hit EADDRINUSE.
  local stale; stale="$(pids_on_port)"
  if [ -n "$stale" ]; then
    warn "Port $(get_port) in use by orphan PID(s): $stale — terminating"
    echo "$stale" | xargs -r kill 2>/dev/null || true
    sleep 1
    stale="$(pids_on_port)"; [ -n "$stale" ] && echo "$stale" | xargs -r kill -9 2>/dev/null || true
  fi
  say "Starting AleManKhora (nohup)…"
  nohup node server/index.js >>"$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  sleep 1
  if is_running; then ok "Started (PID $(cat "$PID_FILE")) → http://localhost:$(get_port)"; else err "Failed to start — see $LOG_FILE"; fi
}

cmd_stop() {
  if use_systemd; then say "Stopping via systemd"; sd stop "$SERVICE"; ok "Stopped"; return; fi
  local stopped=0
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    kill "$(cat "$PID_FILE")" && stopped=1
  fi
  rm -f "$PID_FILE"
  # Also clean up any orphan on the port (e.g. a process the PID file lost track of).
  local stale; stale="$(pids_on_port)"
  if [ -n "$stale" ]; then
    warn "Cleaning orphan(s) on port $(get_port): $stale"
    echo "$stale" | xargs -r kill 2>/dev/null || true
    stopped=1
  fi
  [ "$stopped" = "1" ] && ok "Stopped" || warn "Not running"
}

cmd_restart() { cmd_stop || true; sleep 1; cmd_start; }

cmd_status() {
  if is_running; then
    if use_systemd; then ok "Running (systemd)"; sd status "$SERVICE" --no-pager -l | head -n 12 || true;
    else ok "Running (PID $(cat "$PID_FILE")) on port $(get_port)"; fi
  else
    warn "Stopped"
  fi
}

cmd_logs() {
  if use_systemd; then sd -u "$SERVICE" -n 100 -f 2>/dev/null || journalctl -u "$SERVICE" -n 100 -f;
  else say "Tailing $LOG_FILE (Ctrl-C to exit)"; touch "$LOG_FILE"; tail -n 100 -f "$LOG_FILE"; fi
}

cmd_seed() { say "Seeding demo data"; npm run seed; }

cmd_port() {
  local newport="${1:-}"
  if [ -z "$newport" ]; then read -rp "New port: " newport; fi
  [[ "$newport" =~ ^[0-9]+$ ]] || { err "Invalid port"; return 1; }
  if grep -q '^PORT=' .env 2>/dev/null; then
    sed -i.bak "s/^PORT=.*/PORT=${newport}/" .env && rm -f .env.bak
  else
    printf "PORT=%s\n" "$newport" >> .env
  fi
  ok "Port set to $newport — restart to apply"
}

# ------------------------------- backup -------------------------------------

cmd_backup() {
  local ts; ts="$(date +%Y%m%d-%H%M%S)"
  local file="$BACKUP_DIR/amk-backup-${ts}.tar.gz"
  local commit; commit="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  say "Creating full backup → $file"
  cat > "$RUN_DIR/backup-meta.txt" <<EOF
AleManKhora backup
created: $ts
commit:  $commit
node:    $(node -v 2>/dev/null || echo n/a)
EOF
  # Include the database, secrets/config and metadata. Code lives in git.
  tar -czf "$file" \
    -C "$APP_DIR" \
    $( [ -d data ] && echo data ) \
    $( [ -f .env ] && echo .env ) \
    -C "$RUN_DIR" backup-meta.txt 2>/dev/null
  rm -f "$RUN_DIR/backup-meta.txt"
  ok "Backup saved: $file ($(du -h "$file" | cut -f1))"
}

cmd_restore() {
  local file="${1:-}"
  if [ -z "$file" ]; then
    local backups=( "$BACKUP_DIR"/amk-backup-*.tar.gz )
    if [ ! -e "${backups[0]}" ]; then err "No backups found in $BACKUP_DIR"; return 1; fi
    echo "Available backups:"
    local i=1; for b in "${backups[@]}"; do printf "  %2d) %s (%s)\n" "$i" "$(basename "$b")" "$(du -h "$b" | cut -f1)"; i=$((i+1)); done
    read -rp "Select backup number: " sel
    [[ "$sel" =~ ^[0-9]+$ ]] && [ "$sel" -ge 1 ] && [ "$sel" -le "${#backups[@]}" ] || { err "Invalid selection"; return 1; }
    file="${backups[$((sel-1))]}"
  fi
  [ -f "$file" ] || { err "File not found: $file"; return 1; }
  warn "This will OVERWRITE the current database and .env."
  read -rp "Type 'yes' to continue: " confirm
  [ "$confirm" = "yes" ] || { warn "Aborted"; return 1; }
  local was_running=0; is_running && was_running=1
  [ "$was_running" = "1" ] && cmd_stop
  say "Restoring from $(basename "$file")"
  tar -xzf "$file" -C "$APP_DIR" data .env 2>/dev/null || tar -xzf "$file" -C "$APP_DIR"
  ok "Restore complete"
  [ "$was_running" = "1" ] && cmd_start
}

# ----------------------------- nginx proxy ----------------------------------

_nginx_install() {
  command -v nginx >/dev/null 2>&1 && return 0
  say "Installing nginx"
  local pm; pm="$(detect_pm)"
  case "$pm" in
    apt)    $( [ "$(id -u)" = "0" ] && echo "" || echo sudo ) apt-get update -y && \
            $( [ "$(id -u)" = "0" ] && echo "" || echo sudo ) apt-get install -y nginx ;;
    dnf)    $( [ "$(id -u)" = "0" ] && echo "" || echo sudo ) dnf install -y nginx ;;
    yum)    $( [ "$(id -u)" = "0" ] && echo "" || echo sudo ) yum install -y nginx ;;
    pacman) $( [ "$(id -u)" = "0" ] && echo "" || echo sudo ) pacman -Sy --noconfirm nginx ;;
    apk)    $( [ "$(id -u)" = "0" ] && echo "" || echo sudo ) apk add --no-cache nginx ;;
    *)      err "Unknown package manager — install nginx manually."; return 1 ;;
  esac
}

_nginx_reload() {
  if command -v systemctl >/dev/null 2>&1; then
    $( [ "$(id -u)" = "0" ] && echo "" || echo sudo ) nginx -t && \
    $( [ "$(id -u)" = "0" ] && echo "" || echo sudo ) systemctl enable nginx 2>/dev/null || true && \
    $( [ "$(id -u)" = "0" ] && echo "" || echo sudo ) systemctl reload-or-restart nginx
  else
    $( [ "$(id -u)" = "0" ] && echo "" || echo sudo ) nginx -t && \
    $( [ "$(id -u)" = "0" ] && echo "" || echo sudo ) service nginx reload 2>/dev/null || \
    $( [ "$(id -u)" = "0" ] && echo "" || echo sudo ) nginx -s reload
  fi
}

_write_nginx_conf() {
  local domain="${1:-_}"   # _ = catch-all (IP access)
  local port; port="$(get_port)"
  local SUDO=""; [ "$(id -u)" != "0" ] && SUDO="sudo"
  local conf_dir="/etc/nginx/sites-available"
  local enabled_dir="/etc/nginx/sites-enabled"
  # Fallback for distros that don't use sites-available (e.g. CentOS)
  if [ ! -d "$conf_dir" ]; then conf_dir="/etc/nginx/conf.d"; enabled_dir=""; fi
  local conf_file="${conf_dir}/alemankhora"

  $SUDO mkdir -p "$conf_dir"
  # Remove default site to free port 80
  $SUDO rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

  say "Writing nginx config → $conf_file"
  $SUDO tee "$conf_file" > /dev/null <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${domain};

    # WebSocket + HTTP proxy to Node.js
    location / {
        proxy_pass         http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400s;
    }
}
NGINX

  if [ -n "$enabled_dir" ]; then
    $SUDO ln -sf "$conf_file" "${enabled_dir}/alemankhora" 2>/dev/null || true
  fi
}

cmd_proxy() {
  _nginx_install || return 1
  _write_nginx_conf "_"
  _nginx_reload && ok "Nginx active — بازی در http://IP-سرور قابل دسترسی است (بدون پورت)" || err "nginx reload failed"
}

cmd_ssl() {
  local domain="${1:-}"
  if [ -z "$domain" ]; then read -rp "دامین (مثال: game.example.com): " domain; fi
  [ -z "$domain" ] && { err "دامین وارد نشد"; return 1; }

  _nginx_install || return 1
  _write_nginx_conf "$domain"
  _nginx_reload || { err "nginx reload failed — مطمئن شو $domain به IP سرور اشاره می‌کند"; return 1; }

  # Install certbot
  if ! command -v certbot >/dev/null 2>&1; then
    say "Installing certbot"
    local SUDO=""; [ "$(id -u)" != "0" ] && SUDO="sudo"
    if command -v snap >/dev/null 2>&1; then
      $SUDO snap install --classic certbot 2>/dev/null && \
      $SUDO ln -sf /snap/bin/certbot /usr/bin/certbot 2>/dev/null || true
    else
      local pm; pm="$(detect_pm)"
      case "$pm" in
        apt)    $SUDO apt-get install -y certbot python3-certbot-nginx ;;
        dnf)    $SUDO dnf install -y certbot python3-certbot-nginx ;;
        yum)    $SUDO yum install -y certbot python3-certbot-nginx ;;
        *)      err "certbot را به‌صورت دستی نصب کن: https://certbot.eff.org"; return 1 ;;
      esac
    fi
  fi

  say "Obtaining Let's Encrypt certificate for $domain …"
  local SUDO=""; [ "$(id -u)" != "0" ] && SUDO="sudo"
  $SUDO certbot --nginx -d "$domain" \
    --non-interactive --agree-tos \
    --register-unsafely-without-email \
    --redirect 2>&1 || { err "certbot failed — دامین را چک کن (باید به IP سرور اشاره کند)"; return 1; }

  ok "SSL فعال شد! بازی در دسترس است: https://${domain}"
  printf "${C_B}  تمدید خودکار:${C_0} certbot renew را cron می‌کند — برای اطمینان:\n"
  printf "   sudo certbot renew --dry-run\n"
}

# ----------------------------- uninstall ------------------------------------

cmd_uninstall() {
  warn "This removes the systemd service and stops the app. Source & backups are kept."
  read -rp "Type 'yes' to continue: " confirm
  [ "$confirm" = "yes" ] || { warn "Aborted"; return 1; }
  cmd_stop || true
  if have_systemd_unit; then sd disable "$SERVICE" 2>/dev/null || true; sd stop "$SERVICE" 2>/dev/null || true;
    if [ "$(id -u)" = "0" ]; then rm -f "/etc/systemd/system/${SERVICE}.service"; systemctl daemon-reload;
    else sudo rm -f "/etc/systemd/system/${SERVICE}.service"; sudo systemctl daemon-reload; fi
    ok "systemd service removed"
  fi
  ok "Uninstalled. To delete everything: rm -rf '$APP_DIR'"
}

# -------------------------------- menu --------------------------------------

menu() {
  while true; do
    echo
    printf "${C_B}══════════ اَل من خورا — کنسول مدیریت ══════════${C_0}\n"
    if is_running; then printf "  وضعیت: ${C_G}در حال اجرا${C_0}  پورت: %s\n" "$(get_port)";
    else printf "  وضعیت: ${C_Y}متوقف${C_0}\n"; fi
    cat <<MENU
  ------------------------------------------------
   1) نصب / نصب وابستگی‌ها      (install)
   2) به‌روزرسانی + ری‌استارت    (update)
   3) شروع                       (start)
   4) توقف                       (stop)
   5) ری‌استارت                  (restart)
   6) وضعیت                      (status)
   7) لاگ‌ها                      (logs)
   8) بکاپ کامل                  (backup)
   9) بازیابی از بکاپ            (restore)
  10) تغییر پورت                 (port)
  11) ساخت داده نمونه/ادمین      (seed)
  12) حذف نصب                    (uninstall)
  ------------------------------------------------
  13) پروکسی بدون پورت (HTTP)    (proxy)
  14) نصب SSL با دامین           (ssl)
  ------------------------------------------------
   0) خروج
MENU
    read -rp "انتخاب: " choice
    case "$choice" in
      1) cmd_install ;;  2) cmd_update ;;  3) cmd_start ;;  4) cmd_stop ;;
      5) cmd_restart ;;  6) cmd_status ;;  7) cmd_logs ;;   8) cmd_backup ;;
      9) cmd_restore ;; 10) cmd_port ;;   11) cmd_seed ;;  12) cmd_uninstall ;;
      13) cmd_proxy ;;  14) cmd_ssl ;;
      0|q|exit) exit 0 ;;
      *) err "گزینهٔ نامعتبر" ;;
    esac
  done
}

case "${1:-menu}" in
  menu)      menu ;;
  install)   cmd_install ;;
  update)    cmd_update ;;
  start)     cmd_start ;;
  stop)      cmd_stop ;;
  restart)   cmd_restart ;;
  status)    cmd_status ;;
  logs)      cmd_logs ;;
  backup)    cmd_backup ;;
  restore)   cmd_restore "${2:-}" ;;
  port)      cmd_port "${2:-}" ;;
  seed)      cmd_seed ;;
  uninstall) cmd_uninstall ;;
  proxy)     cmd_proxy ;;
  ssl)       cmd_ssl "${2:-}" ;;
  *) err "Unknown command: $1"; echo "Try: install|update|start|stop|restart|status|logs|backup|restore|port|seed|uninstall|proxy|ssl [domain]"; exit 1 ;;
esac
