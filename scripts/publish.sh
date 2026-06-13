#!/usr/bin/env bash
# One-command release helper. It wraps scripts/release.sh, pushes the release
# tag, then watches the GitHub Actions release workflow when gh is available.
set -euo pipefail
cd "$(dirname "$0")/.."

usage() {
  cat <<'EOF'
usage: scripts/publish.sh [patch|minor|major|X.Y.Z] [options]

Examples:
  scripts/publish.sh              # patch release, e.g. 0.2.1 -> 0.2.2
  scripts/publish.sh minor        # e.g. 0.2.1 -> 0.3.0
  scripts/publish.sh 0.3.0        # explicit version
  scripts/publish.sh --dry-run    # show what would happen

Options:
  --dry-run      Print the planned version and exit before changing files.
  --no-fetch     Skip git fetch before checking origin/main and tags.
  --no-push      Commit and tag locally, but do not push.
  --no-watch     Push the release, but do not watch GitHub Actions.
  --skip-build   Skip the pnpm build preflight.
  -h, --help     Show this help.
EOF
}

die() {
  echo "publish: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

bump="patch"
explicit_version=""
dry_run=0
do_fetch=1
do_push=1
do_watch=1
do_build=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    patch|minor|major)
      bump="$1"
      explicit_version=""
      shift
      ;;
    [0-9]*.[0-9]*.[0-9]*)
      explicit_version="$1"
      shift
      ;;
    --dry-run)
      dry_run=1
      do_push=0
      do_watch=0
      shift
      ;;
    --no-fetch)
      do_fetch=0
      shift
      ;;
    --no-push)
      do_push=0
      do_watch=0
      shift
      ;;
    --no-watch)
      do_watch=0
      shift
      ;;
    --skip-build)
      do_build=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      die "unknown argument: $1"
      ;;
  esac
done

need_cmd git
need_cmd pnpm
need_cmd node

current_version="$(node -p "require('./package.json').version")"
[[ "$current_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
  die "package.json version must be X.Y.Z, got: $current_version"

if [[ -n "$explicit_version" ]]; then
  next_version="$explicit_version"
else
  IFS=. read -r major minor patch <<<"$current_version"
  case "$bump" in
    patch) patch=$((patch + 1)) ;;
    minor) minor=$((minor + 1)); patch=0 ;;
    major) major=$((major + 1)); minor=0; patch=0 ;;
  esac
  next_version="$major.$minor.$patch"
fi

[[ "$next_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
  die "version must be X.Y.Z, got: $next_version"
[[ "$next_version" != "$current_version" ]] ||
  die "next version is already current: $next_version"

echo "Current version: $current_version"
echo "Next version:    $next_version"
echo "Tag:             v$next_version"

if [[ "$dry_run" -eq 1 ]]; then
  echo "Dry run only; no files changed."
  exit 0
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
[[ "$branch" == "main" ]] || die "releases must be run from main, currently on: $branch"

if [[ -n "$(git status --porcelain)" ]]; then
  git status --short
  die "worktree must be clean before releasing"
fi

if [[ "$do_fetch" -eq 1 ]]; then
  echo "Fetching origin/main and tags..."
  git fetch origin main --tags
fi

if git rev-parse -q --verify "refs/tags/v$next_version" >/dev/null; then
  die "local tag already exists: v$next_version"
fi

if git ls-remote --exit-code --tags origin "refs/tags/v$next_version" >/dev/null 2>&1; then
  die "remote tag already exists: v$next_version"
fi

local_head="$(git rev-parse HEAD)"
remote_head="$(git rev-parse origin/main)"
merge_base="$(git merge-base HEAD origin/main)"

if [[ "$local_head" == "$remote_head" ]]; then
  :
elif [[ "$local_head" == "$merge_base" ]]; then
  die "local main is behind origin/main; run git pull --ff-only first"
elif [[ "$remote_head" == "$merge_base" ]]; then
  echo "Local main is ahead of origin/main; those commits will be included in the release."
else
  die "local main and origin/main have diverged; resolve that before releasing"
fi

if [[ "$do_build" -eq 1 ]]; then
  echo "Running pnpm build..."
  pnpm build
fi

scripts/release.sh "$next_version"

if [[ "$do_push" -eq 0 ]]; then
  echo "Release commit and tag created locally."
  echo "Push later with: git push origin main v$next_version"
  exit 0
fi

echo "Pushing main and v$next_version..."
git push origin main "v$next_version"

if [[ "$do_watch" -eq 0 ]]; then
  echo "Release started. Watch it with:"
  echo "  gh run list --workflow Release --limit 3"
  exit 0
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "Release started. Install gh or check GitHub Actions in the browser to watch it."
  exit 0
fi

release_sha="$(git rev-parse HEAD)"
run_id=""

echo "Waiting for the Release workflow to appear..."
for _ in {1..30}; do
  run_id="$(
    gh run list \
      --workflow Release \
      --limit 20 \
      --json databaseId,headBranch,headSha,event \
      --jq ".[] | select(.event == \"push\" and .headBranch == \"v$next_version\" and .headSha == \"$release_sha\") | .databaseId" |
      head -1
  )"

  if [[ -n "$run_id" ]]; then
    break
  fi

  sleep 5
done

if [[ -z "$run_id" ]]; then
  echo "Could not find the workflow run yet. Check it with:"
  echo "  gh run list --workflow Release --limit 5"
  exit 0
fi

gh run watch "$run_id" --exit-status --interval 10

echo "Published release:"
gh release view "v$next_version" --json tagName,name,url,publishedAt --jq '"\(.name) \(.url)"'
