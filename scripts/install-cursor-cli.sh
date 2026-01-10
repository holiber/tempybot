#!/usr/bin/env bash
set -euo pipefail

# Installs Cursor Agent CLI into a repo-local cache dir (non-global).
# Intended for CI runners where `agent` is not preinstalled.

ROOT="$(pwd)"
CACHE_DIR="${CURSOR_CLI_CACHE_DIR:-"$ROOT/.cache/cursor-cli"}"
BIN_DIR="${CURSOR_CLI_BIN_DIR:-"$CACHE_DIR/bin"}"
INSTALL_HOME="${CURSOR_CLI_HOME_DIR:-"$CACHE_DIR/home"}"

mkdir -p "$BIN_DIR"

if command -v agent >/dev/null 2>&1; then
  echo "agent already on PATH: $(command -v agent)"
  agent --version || true
  exit 0
fi

if [ -x "$BIN_DIR/agent" ]; then
  echo "agent already installed at: $BIN_DIR/agent"
  "$BIN_DIR/agent" --version || true
  exit 0
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

echo "Downloading Cursor install script…"
curl -fsSL "https://cursor.com/install" -o "$TMP"

# The official installer currently installs under: $HOME/.local/bin (symlinks),
# and stores versions under: $HOME/.local/share/cursor-agent/...
# To keep it repo-local, we override HOME to a directory under .cache.
mkdir -p "$INSTALL_HOME"
echo "Installing with HOME=$INSTALL_HOME (repo-local)…"

set +e
HOME="$INSTALL_HOME" bash "$TMP"
status=$?
set -e

if [ $status -ne 0 ]; then
  echo "Cursor installer failed (exit=$status)."
  exit $status
fi

INSTALLED_BIN="$INSTALL_HOME/.local/bin/agent"
if [ ! -x "$INSTALLED_BIN" ]; then
  echo "Expected agent at: $INSTALLED_BIN"
  echo "Installer output suggests it should exist, but it does not."
  exit 1
fi

ln -sf "$INSTALLED_BIN" "$BIN_DIR/agent"
echo "agent installed at: $BIN_DIR/agent"
"$BIN_DIR/agent" --version || true

