#!/usr/bin/env bash
# Bump the app version everywhere, commit, and tag. Then push to release:
#   scripts/release.sh 0.2.0
#   git push origin main v0.2.0
set -euo pipefail
cd "$(dirname "$0")/.."

V=${1:?usage: scripts/release.sh <version>}
[[ $V =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "version must be X.Y.Z" >&2; exit 1; }

sed -i '' "s/^  \"version\": \".*\"/  \"version\": \"$V\"/" package.json src-tauri/tauri.conf.json
# Only the [package] version starts a line; dependency versions are inline tables.
sed -i '' "s/^version = \".*\"/version = \"$V\"/" src-tauri/Cargo.toml
(cd src-tauri && cargo update --workspace --quiet)

git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "release v$V"
git tag "v$V"
echo "Tagged v$V — release with: git push origin main v$V"
