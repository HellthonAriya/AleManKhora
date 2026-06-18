#!/usr/bin/env bash
# =============================================================================
#  اِل من خورا (AleManKhora) — management console
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

cmd_start() {
  if is_running; then ok "Already running"; return; fi
  if use_systemd; then say "Starting via systemd"; sd start "$SERVICE"; ok "Started"; return; fi
  say "Starting AleManKhora (nohup)…"
  nohup node server/index.js >>"$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  sleep 1
  if is_running; then ok "Started (PID $(cat "$PID_FILE")) → http://localhost:$(get_port)"; else err "Failed to start — see $LOG_FILE"; fi
}

cmd_stop() {
  if use_systemd; then say "Stopping via systemd"; sd stop "$SERVICE"; ok "Stopped"; return; fi
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    kill "$(cat "$PID_FILE")" && rm -f "$PID_FILE"; ok "Stopped"
  else
    warn "Not running"; rm -f "$PID_FILE"
  fi
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
    printf "${C_B}══════════ اِل من خورا — کنسول مدیریت ══════════${C_0}\n"
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
   0) خروج
  ------------------------------------------------
MENU
    read -rp "انتخاب: " choice
    case "$choice" in
      1) cmd_install ;;  2) cmd_update ;;  3) cmd_start ;;  4) cmd_stop ;;
      5) cmd_restart ;;  6) cmd_status ;;  7) cmd_logs ;;   8) cmd_backup ;;
      9) cmd_restore ;; 10) cmd_port ;;   11) cmd_seed ;;  12) cmd_uninstall ;;
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
  *) err "Unknown command: $1"; echo "Try: install|update|start|stop|restart|status|logs|backup|restore|port|seed|uninstall"; exit 1 ;;
esac
