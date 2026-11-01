#!/usr/bin/env bash
SUBFORM_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export SUBFORM_ROOT
sf_say() { printf '[subform] %s\n' "$*"; }
sf_die() { printf '[subform] error: %s\n' "$*" >&2; exit 1; }
sf_os() {
  case "$(uname -s 2>/dev/null)" in
    Darwin) echo macos ;;
    Linux) echo linux ;;
    MINGW*|MSYS*|CYGWIN*) echo windows ;;
    *) echo unknown ;;
  esac
}
sf_python() {
  local c
  for c in python3.14 python3.13 python3; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 13) else 1)' 2>/dev/null; then
      echo "$c"
      return 0
    fi
  done
  return 1
}
sf_venv() {
  [ -f "$SUBFORM_ROOT/backend/venv/bin/activate" ] || sf_die "backend venv missing, run ./subform install"
  source "$SUBFORM_ROOT/backend/venv/bin/activate"
}
