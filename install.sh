#!/usr/bin/env bash
# =============================================================================
#  اَلِ من خورا (AleManKhora) — one-command installer
#  Usage:
#    bash <(curl -fsSL https://raw.githubusercontent.com/HellthonAriya/AleManKhora/claude/wrongway-web-game-mfjws8/install.sh)
#
#  Overridable environment variables:
#    AMK_REPO     git slug            (default: HellthonAriya/AleManKhora)
#    AMK_BRANCH   branch to install   (default: claude/wrongway-web-game-mfjws8)
#    AMK_DIR      install directory   (default: $HOME/alemankhora or /opt/alemankhora as root)
#    AMK_PORT     listen port         (default: 3000)
#    AMK_SERVICE  create systemd unit (default: auto — yes if root + systemd)
# =============================================================================
set -euo pipefail

AMK_REPO="${AMK_REPO:-HellthonAriya/AleManKhora}"
AMK_BRANCH="${AMK_BRANCH:-claude/wrongway-web-game-mfjws8}"
AMK_PORT="${AMK_PORT:-3000}"
GIT_URL="https://github.com/${AMK_REPO}.git"

C_G='\033[1;32m'; C_Y='\033[1;33m'; C_R='\033[1;31m'; C_B='\033[1;36m'; C_0='\033[0m'
say()  { printf "${C_B}▸ %s${C_0}\n" "$*"; }
ok()   { printf "${C_G}✓ %s${C_0}\n" "$*"; }
warn() { printf "${C_Y}! %s${C_0}\n" "$*"; }
die()  { printf "${C_R}✗ %s${C_0}\n" "$*" >&2; exit 1; }

IS_ROOT=0; [ "$(id -u)" = "0" ] && IS_ROOT=1
SUDO=""; if [ "$IS_ROOT" = "0" ] && command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi
if [ -z "${AMK_DIR:-}" ]; then
  if [ "$IS_ROOT" = "1" ]; then AMK_DIR="/opt/alemankhora"; else AMK_DIR="$HOME/alemankhora"; fi
fi

banner() {
cat <<'B'
   ___  _      __  ___           _  __ __
  / _ |/ /__  /  |/  /__ ____   / |/ // /  ___  _______ _
 / __ / / -_)/ /|_/ / _ `/ _ \ /    // _ \/ _ \/ __/ _ `/
/_/ |_/_/\__//_/  /_/\_,_/_//_//_/|_//_//_/\___/_/  \_,_/
            اَلِ من خورا — installer
B
}

detect_pm() {
  if command -v apt-get >/dev/null 2>&1; then echo apt;
  elif command -v dnf >/dev/null 2>&1; then echo dnf;
  elif command -v yum >/dev/null 2>&1; then echo yum;
  elif command -v pacman >/dev/null 2>&1; then echo pacman;
  elif command -v apk >/dev/null 2>&1; then echo apk;
  else echo none; fi
}

install_base() {
  local pm; pm="$(detect_pm)"
  say "Installing prerequisites (git, curl) via: $pm"
  case "$pm" in
    apt)    $SUDO apt-get update -y && $SUDO apt-get install -y git curl ca-certificates ;;
    dnf)    $SUDO dnf install -y git curl ;;
    yum)    $SUDO yum install -y git curl ;;
    pacman) $SUDO pacman -Sy --noconfirm git curl ;;
    apk)    $SUDO apk add --no-cache git curl ;;
    *)      warn "Unknown package manager — make sure git & curl are installed." ;;
  esac
}

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local major; major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$major" -ge 18 ] 2>/dev/null
}

install_node() {
  if node_ok; then ok "Node $(node -v) already present"; return; fi
  warn "Node.js >= 18 not found — installing"
  local pm; pm="$(detect_pm)"
  case "$pm" in
    apt)        curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash - && $SUDO apt-get install -y nodejs ;;
    dnf|yum)    curl -fsSL https://rpm.nodesource.com/setup_20.x | $SUDO -E bash - && $SUDO "$pm" install -y nodejs ;;
    pacman)     $SUDO pacman -Sy --noconfirm nodejs npm ;;
    apk)        $SUDO apk add --no-cache nodejs npm ;;
    *)          install_node_nvm ;;
  esac
  node_ok || install_node_nvm
  node_ok && ok "Node $(node -v) installed" || die "Failed to install Node.js — install it manually and re-run."
}

install_node_nvm() {
  warn "Falling back to nvm for a user-local Node install"
  export NVM_DIR="$HOME/.nvm"
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
  nvm install 20 && nvm use 20
}

fetch_repo() {
  if [ -d "$AMK_DIR/.git" ]; then
    say "Updating existing install at $AMK_DIR"
    git -C "$AMK_DIR" fetch --all --prune
    git -C "$AMK_DIR" checkout "$AMK_BRANCH"
    git -C "$AMK_DIR" pull --ff-only origin "$AMK_BRANCH" || true
  else
    say "Cloning $AMK_REPO ($AMK_BRANCH) → $AMK_DIR"
    $SUDO mkdir -p "$(dirname "$AMK_DIR")"
    if [ "$IS_ROOT" = "1" ] || [ -w "$(dirname "$AMK_DIR")" ]; then
      git clone --branch "$AMK_BRANCH" --depth 1 "$GIT_URL" "$AMK_DIR"
    else
      $SUDO git clone --branch "$AMK_BRANCH" --depth 1 "$GIT_URL" "$AMK_DIR"
      $SUDO chown -R "$(id -u):$(id -g)" "$AMK_DIR"
    fi
  fi
  ok "Source ready at $AMK_DIR"
}

setup_app() {
  cd "$AMK_DIR"
  say "Installing npm dependencies (this can take a minute)…"
  npm install --omit=dev
  if [ ! -f .env ]; then
    local secret; secret="$(node -e 'console.log(require("crypto").randomBytes(48).toString("hex"))' 2>/dev/null || head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    cat > .env <<EOF
PORT=${AMK_PORT}
JWT_SECRET=${secret}
EOF
    ok "Created .env with a fresh JWT secret"
  else
    ok ".env already exists — keeping it"
  fi
  chmod +x manage.sh 2>/dev/null || true
  ok "Dependencies installed"
}

setup_service() {
  local want="${AMK_SERVICE:-auto}"
  if [ "$want" = "auto" ]; then
    if [ "$IS_ROOT" = "1" ] && command -v systemctl >/dev/null 2>&1; then want="yes"; else want="no"; fi
  fi
  if [ "$want" != "yes" ]; then return 1; fi
  say "Creating systemd service: alemankhora"
  local node_bin; node_bin="$(command -v node)"
  cat > /etc/systemd/system/alemankhora.service <<EOF
[Unit]
Description=AleManKhora (اَلِ من خورا) game server
After=network.target

[Service]
Type=simple
WorkingDirectory=${AMK_DIR}
EnvironmentFile=${AMK_DIR}/.env
ExecStart=${node_bin} ${AMK_DIR}/server/index.js
Restart=on-failure
RestartSec=3
User=${SUDO_USER:-root}

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable alemankhora >/dev/null 2>&1 || true
  systemctl restart alemankhora
  ok "systemd service started (systemctl status alemankhora)"
  return 0
}

main() {
  banner
  install_base
  install_node
  # nvm-installed node lives only in this shell; make it available
  if ! node_ok && [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh"; fi
  fetch_repo
  setup_app

  if setup_service; then
    :
  else
    say "Starting AleManKhora via the management script"
    "$AMK_DIR/manage.sh" start || true
  fi

  echo
  ok "نصب کامل شد! / Installation complete."
  printf "${C_G}  ➜ آدرس بازی: ${C_0}http://localhost:%s\n" "$AMK_PORT"
  printf "${C_B}  ➜ مدیریت سرور: ${C_0}cd %s && ./manage.sh\n" "$AMK_DIR"
  printf "${C_B}  ➜ ساخت ادمین نمونه: ${C_0}cd %s && npm run seed${C_0}\n" "$AMK_DIR"
  echo "     (admin / admin123)"
}

main "$@"
