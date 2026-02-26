#!/usr/bin/env bash
set -euo pipefail

REPO="${DAX_REPO:-ShaileshRawat1403/dax}"
INSTALL_DIR="${DAX_INSTALL_DIR:-$HOME/.local/bin}"
VERSION="${DAX_VERSION:-}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: required command '$1' was not found" >&2
    exit 1
  fi
}

need_cmd curl
need_cmd tar

if [[ -z "$VERSION" ]]; then
  latest_url="$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/${REPO}/releases/latest")"
  VERSION="${latest_url##*/}"
fi

if [[ "$VERSION" != v* ]]; then
  VERSION="v${VERSION}"
fi

uname_s="$(uname -s)"
uname_m="$(uname -m)"

case "$uname_s" in
  Darwin) platform="darwin" ;;
  Linux) platform="linux" ;;
  *)
    echo "error: unsupported OS '$uname_s'" >&2
    exit 1
    ;;
esac

case "$uname_m" in
  x86_64|amd64) arch="x64" ;;
  arm64|aarch64) arch="arm64" ;;
  *)
    echo "error: unsupported architecture '$uname_m'" >&2
    exit 1
    ;;
esac

asset="dax-${platform}-${arch}.tar.gz"
base_url="https://github.com/${REPO}/releases/download/${VERSION}"
manifest_url="${base_url}/manifest.json"
asset_url="${base_url}/${asset}"

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

curl -fsSL "$manifest_url" -o "$tmp_dir/manifest.json"
curl -fsSL "$asset_url" -o "$tmp_dir/$asset"

if command -v python3 >/dev/null 2>&1; then
  expected_sha="$(python3 - "$tmp_dir/manifest.json" "$asset" <<'PY'
import json
import pathlib
import sys

manifest = pathlib.Path(sys.argv[1])
filename = sys.argv[2]
data = json.loads(manifest.read_text())
for asset in data.get("assets", []):
    if asset.get("filename") == filename:
        print(asset.get("sha256", ""))
        break
PY
)"
else
  echo "error: python3 is required to parse manifest.json" >&2
  exit 1
fi

if [[ -z "$expected_sha" ]]; then
  echo "error: checksum for ${asset} was not found in manifest.json" >&2
  exit 1
fi

if command -v shasum >/dev/null 2>&1; then
  actual_sha="$(shasum -a 256 "$tmp_dir/$asset" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  actual_sha="$(sha256sum "$tmp_dir/$asset" | awk '{print $1}')"
else
  echo "error: no SHA256 tool found (shasum or sha256sum)" >&2
  exit 1
fi

if [[ "$actual_sha" != "$expected_sha" ]]; then
  echo "error: checksum mismatch for ${asset}" >&2
  echo "expected: $expected_sha" >&2
  echo "actual:   $actual_sha" >&2
  exit 1
fi

tar -xzf "$tmp_dir/$asset" -C "$tmp_dir"

if [[ ! -f "$tmp_dir/dax" ]]; then
  echo "error: archive did not contain dax executable" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
install -m 755 "$tmp_dir/dax" "$INSTALL_DIR/dax"

echo "Installed dax to $INSTALL_DIR/dax"
case ":$PATH:" in
  *":$INSTALL_DIR:"*)
    echo "dax is on your PATH. Run: dax"
    ;;
  *)
    echo "Add this to your shell profile to use 'dax':"
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
    ;;
esac
