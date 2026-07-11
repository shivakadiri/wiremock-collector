#!/usr/bin/env bash
# Build and push wiremock-collector to Docker Hub with auto versioning.
#
# Default channel is alpha. Pass beta or release to override.
# Default is a dry-run preview; pass --push to build and publish.
#
# Versioning:
#   alpha   -> X.Y.Z-alpha   (e.g. 0.1.0-alpha)  + floating :alpha
#   beta    -> X.Y.Z-beta    (e.g. 0.1.0-beta)   + floating :beta
#   release -> X.Y.Z         (e.g. 0.1.0)         + floating :latest
#
# Usage:
#   ./scripts/docker-publish.sh                 # dry-run next alpha
#   ./scripts/docker-publish.sh --push          # publish alpha
#   ./scripts/docker-publish.sh beta
#   ./scripts/docker-publish.sh beta --push
#   ./scripts/docker-publish.sh release
#   ./scripts/docker-publish.sh release --push
#   ./scripts/docker-publish.sh release minor --push
#
# Env:
#   DOCKER_IMAGE   default: shivapkadiri/wiremock-collector
#   SKIP_GIT_TAG=1 do not create/push git tags (on --push)
#   PLATFORMS      e.g. linux/amd64,linux/arm64 (uses buildx --push)
#   DOCKER_BUILDKIT=1 (default)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CHANNEL="alpha"
BUMP="patch"
DO_PUSH=0
IMAGE="${DOCKER_IMAGE:-shivapkadiri/wiremock-collector}"
VERSION_FILE="$ROOT/VERSION"
SKIP_GIT_TAG="${SKIP_GIT_TAG:-0}"
export DOCKER_BUILDKIT="${DOCKER_BUILDKIT:-1}"

usage() {
  sed -n '2,24p' "$0" | sed 's/^# \?//'
  exit 1
}

for arg in "$@"; do
  case "$arg" in
    -h|--help) usage ;;
    --push) DO_PUSH=1 ;;
    alpha|beta|release) CHANNEL="$arg" ;;
    patch|minor|major) BUMP="$arg" ;;
    *)
      echo "Unknown argument: $arg" >&2
      usage
      ;;
  esac
done

if [[ ! -f "$VERSION_FILE" ]]; then
  echo "0.1.0" > "$VERSION_FILE"
fi

base_version() {
  tr -d '[:space:]' < "$VERSION_FILE"
}

semver_parts() {
  local v="$1"
  IFS=. read -r major minor patch <<<"$v"
  echo "${major:-0}" "${minor:-0}" "${patch:-0}"
}

bump_semver() {
  local v="$1" kind="$2"
  read -r major minor patch <<<"$(semver_parts "$v")"
  case "$kind" in
    major) echo "$((major + 1)).0.0" ;;
    minor) echo "${major}.$((minor + 1)).0" ;;
    patch) echo "${major}.${minor}.$((patch + 1))" ;;
  esac
}

tag_exists() {
  git rev-parse -q --verify "refs/tags/$1" >/dev/null 2>&1
}

# Pick next free X.Y.Z[-channel] by bumping patch while the git tag exists.
next_free_base() {
  local base="$1"
  local suffix="$2" # "" | "-alpha" | "-beta"
  while tag_exists "v${base}${suffix}"; do
    base="$(bump_semver "$base" patch)"
  done
  echo "$base"
}

BASE_FROM_FILE="$(base_version)"
BASE="$BASE_FROM_FILE"
if [[ ! "$BASE" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Invalid VERSION file contents: '$BASE' (expected X.Y.Z)" >&2
  exit 1
fi

NEXT_VERSION_FILE=""
case "$CHANNEL" in
  alpha)
    BASE="$(next_free_base "$BASE" "-alpha")"
    VERSION="${BASE}-alpha"
    FLOATING_TAG="alpha"
    NEXT_VERSION_FILE="$(bump_semver "$BASE" patch)"
    ;;
  beta)
    BASE="$(next_free_base "$BASE" "-beta")"
    VERSION="${BASE}-beta"
    FLOATING_TAG="beta"
    NEXT_VERSION_FILE="$(bump_semver "$BASE" patch)"
    ;;
  release)
    if [[ "$BUMP" != "patch" ]]; then
      BASE="$(bump_semver "$BASE_FROM_FILE" "$BUMP")"
    fi
    BASE="$(next_free_base "$BASE" "")"
    VERSION="$BASE"
    FLOATING_TAG="latest"
    NEXT_VERSION_FILE="$(bump_semver "$VERSION" patch)"
    ;;
esac

GIT_TAG="v${VERSION}"
FULL_IMAGE="${IMAGE}:${VERSION}"
FLOATING_IMAGE="${IMAGE}:${FLOATING_TAG}"

echo "=== Docker publish preview ==="
echo "Mode:              $([[ "$DO_PUSH" == "1" ]] && echo PUSH || echo DRY-RUN)"
echo "Channel:           $CHANNEL"
echo "VERSION file now:  $BASE_FROM_FILE"
echo "New version:       $VERSION"
echo "Exact image tag:   $FULL_IMAGE"
echo
echo "Floating tags (will point at $VERSION):"
echo "  ${FLOATING_IMAGE}  ->  $VERSION"
if [[ "$CHANNEL" == "release" ]]; then
  echo
  echo "After release, VERSION file becomes: $NEXT_VERSION_FILE"
  echo "  (next default alpha will be ${NEXT_VERSION_FILE}-alpha)"
else
  echo
  echo "After this $CHANNEL publish, VERSION file becomes: $NEXT_VERSION_FILE"
  echo "  (next alpha will be ${NEXT_VERSION_FILE}-alpha)"
  if [[ "$CHANNEL" != "release" ]]; then
    echo
    echo "Note: :latest is NOT updated for $CHANNEL builds."
    echo "  :latest updates only with: ./scripts/docker-publish.sh release --push"
  fi
fi
echo
if [[ "$SKIP_GIT_TAG" != "1" ]]; then
  echo "Git tag:           $GIT_TAG"
fi

if [[ "$DO_PUSH" != "1" ]]; then
  echo
  echo "Dry-run only — nothing was built or pushed."
  echo "To publish this version:"
  if [[ "$CHANNEL" == "alpha" ]]; then
    echo "  ./scripts/docker-publish.sh --push"
  elif [[ "$CHANNEL" == "release" && "$BUMP" != "patch" ]]; then
    echo "  ./scripts/docker-publish.sh release $BUMP --push"
  else
    echo "  ./scripts/docker-publish.sh $CHANNEL --push"
  fi
  exit 0
fi

echo
echo "=== Publishing ==="

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not available / not running." >&2
  exit 1
fi
if [[ -n "${PLATFORMS:-}" ]] && ! docker buildx version >/dev/null 2>&1; then
  echo "PLATFORMS set but docker buildx is unavailable." >&2
  exit 1
fi

if [[ -n "${PLATFORMS:-}" ]]; then
  docker buildx build \
    --platform "$PLATFORMS" \
    -t "$FULL_IMAGE" \
    -t "$FLOATING_IMAGE" \
    --push \
    "$ROOT"
else
  docker build -t "$FULL_IMAGE" -t "$FLOATING_IMAGE" "$ROOT"
  docker push "$FULL_IMAGE"
  docker push "$FLOATING_IMAGE"
fi

if [[ "$SKIP_GIT_TAG" != "1" ]]; then
  if tag_exists "$GIT_TAG"; then
    echo "Git tag $GIT_TAG already exists — skipping tag create."
  else
    git tag -a "$GIT_TAG" -m "Release $VERSION"
    if git remote get-url origin >/dev/null 2>&1; then
      git push origin "$GIT_TAG"
    else
      echo "No git remote 'origin' — tag created locally only."
    fi
  fi
fi

if [[ -n "$NEXT_VERSION_FILE" ]]; then
  echo "$NEXT_VERSION_FILE" > "$VERSION_FILE"
  echo "Updated VERSION -> $NEXT_VERSION_FILE"
  if [[ -n "$(git status --porcelain VERSION 2>/dev/null || true)" ]]; then
    echo "Note: commit the VERSION bump when ready:"
    echo "  git add VERSION && git commit -m \"chore: bump VERSION to $NEXT_VERSION_FILE\""
  fi
fi

echo
echo "Published $FULL_IMAGE"
echo "Floating: $FLOATING_IMAGE -> $VERSION"
if [[ "$CHANNEL" == "release" ]]; then
  echo "latest:   ${IMAGE}:latest -> $VERSION"
fi
echo "Pull: docker pull $FULL_IMAGE"
