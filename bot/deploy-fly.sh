#!/usr/bin/env bash
#
# One-shot Fly.io deploy for dex-arb-bot. Run it from the bot/ directory:
#
#   cd /mnt/c/Users/Aki/arb && git pull && cd bot \
#     && sed -i 's/\r$//' deploy-fly.sh && bash deploy-fly.sh
#
# It installs the Fly CLI if needed, logs you in (browser), creates the app, and
# stores your RPC URL + executor key as Fly SECRETS. The private key is typed
# into THIS terminal only — it is never written to a file or sent anywhere but
# Fly's encrypted secret store. Deploys in DRY_RUN mode (sends nothing).
set -euo pipefail

say() { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# 0. must be run from bot/
[ -f fly.toml ] && [ -f src/index.ts ] || die "Run this from the bot/ directory."

# 1. install flyctl if missing
if ! command -v flyctl >/dev/null 2>&1; then
  say "Installing the Fly.io CLI..."
  curl -L https://fly.io/install.sh | sh
fi
export FLYCTL_INSTALL="${FLYCTL_INSTALL:-$HOME/.fly}"
export PATH="$FLYCTL_INSTALL/bin:$PATH"
command -v flyctl >/dev/null 2>&1 || die "flyctl not on PATH ($FLYCTL_INSTALL/bin)."

# 2. login (opens a browser link; skipped if already logged in)
if ! flyctl auth whoami >/dev/null 2>&1; then
  say "Log in to Fly — a browser link will open. Approve it, then return here."
  flyctl auth login
fi
say "Logged in to Fly as: $(flyctl auth whoami 2>/dev/null || echo unknown)"

# 3. app name: reuse if fly.toml is already customized, else generate a unique one
CUR="$(grep -E '^app = ' fly.toml | sed -E 's/^app = "(.*)"/\1/')"
if [ "$CUR" = "REPLACE-WITH-YOUR-APP-NAME" ] || [ -z "$CUR" ]; then
  APP="arb-bot-$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  say "Creating Fly app: $APP"
  flyctl apps create "$APP"
  sed -i "s|^app = .*|app = \"$APP\"|" fly.toml
else
  APP="$CUR"
  say "Reusing Fly app from fly.toml: $APP"
  flyctl apps create "$APP" 2>/dev/null || true
fi

# 4. secrets — typed here, stored encrypted on Fly, never written to disk
say "Your two private values go straight to Fly as encrypted secrets."
printf 'Paste your Alchemy RPC URL (wss:// recommended for speed), then Enter:\n> '
read -r RPC </dev/tty
[ -n "$RPC" ] || die "No RPC URL entered."
printf 'Paste your EXECUTOR private key (input hidden), then Enter:\n> '
read -rs PK </dev/tty; echo
[ -n "$PK" ] || die "No private key entered."
say "Storing secrets on Fly..."
flyctl secrets set --app "$APP" --stage RPC_URL="$RPC" PRIVATE_KEY="$PK" >/dev/null
unset PK

# 5. deploy (DRY_RUN=true per fly.toml — logs opportunities, sends nothing)
say "Deploying (Fly builds the image remotely; ~1-2 min)..."
flyctl deploy --app "$APP"

say "Live in DRY-RUN mode. App: $APP"
cat <<EOF

  Watch it:       flyctl logs --app $APP
  Go live later:  set  DRY_RUN = "false"  in bot/fly.toml, then
                  flyctl deploy --app $APP
                  (fund the executor with ~0.05-0.1 ETH for gas first)

Streaming logs now — Ctrl+C stops watching; the bot keeps running on Fly.
EOF
flyctl logs --app "$APP"
