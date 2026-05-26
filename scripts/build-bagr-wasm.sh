#!/usr/bin/env sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BAGR_WASM_DIR=${BAGR_WASM_DIR:-"$APP_DIR/../bagr-wasm"}
OUT_DIR="$APP_DIR/src/app/bagit/wasm-pkg"
TARGET_DIR=${CARGO_TARGET_DIR:-"$APP_DIR/tmp/bagr-wasm-target"}

if [ ! -f "$BAGR_WASM_DIR/Cargo.toml" ]; then
  echo "bagr-wasm crate not found at $BAGR_WASM_DIR" >&2
  echo "Set BAGR_WASM_DIR to the crate path, or place it next to this app." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
mkdir -p "$TARGET_DIR"

CARGO_TARGET_DIR="$TARGET_DIR" wasm-pack build "$BAGR_WASM_DIR" \
  --target web \
  --out-dir "$OUT_DIR" \
  --out-name bagr_wasm \
  --release \
  --no-pack

SOURCE_COMMIT=$(git -C "$BAGR_WASM_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")
cat > "$OUT_DIR/BAGR_WASM_SOURCE.txt" <<EOF
Generated from ../bagr-wasm at commit $SOURCE_COMMIT.

This package is copied into the app so Cloudflare deploys do not need Cargo,
wasm-pack, or the sibling Rust checkout. Refresh it locally with:

  pnpm run refresh:wasm
EOF
