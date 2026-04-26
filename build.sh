#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$ROOT_DIR/out"
SCRIPTS_DIR="$ROOT_DIR/scripts"
DEPS_DIR="$ROOT_DIR/dependencies"
BUILD_DIR="$ROOT_DIR/qmanager-build"
STAGING_DIR="$BUILD_DIR/qmanager_install"
ARCHIVE="$BUILD_DIR/qmanager.tar.gz"

# Colors
if [ -t 1 ]; then
  GREEN='\033[0;32m' BOLD='\033[1m' RED='\033[0;31m' NC='\033[0m'
else
  GREEN='' BOLD='' RED='' NC=''
fi

step() { printf "${GREEN}[%s]${NC} %s\n" "$(date +%H:%M:%S)" "$1"; }
fail() { printf "${RED}[%s] ERROR:${NC} %s\n" "$(date +%H:%M:%S)" "$1"; exit 1; }

[ -d "$OUT_DIR" ] || fail "'out/' not found — run 'bun run build' first"
[ -d "$DEPS_DIR" ] || fail "'dependencies/' not found at repo root"
[ -f "$DEPS_DIR/atcli_smd11" ] || fail "Missing required binary: dependencies/atcli_smd11"
[ -f "$DEPS_DIR/sms_tool" ] || fail "Missing required binary: dependencies/sms_tool"

step "Preparing staging directory..."
mkdir -p "$BUILD_DIR"
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"

step "Copying frontend build output..."
cp -r "$OUT_DIR" "$STAGING_DIR/out"

# Strip non-bundled locales. BUNDLED_CODES in lib/i18n/available-languages.ts
# is the single source of truth — packs marked bundled: false are downloaded
# from the remote manifest at runtime (see `Language Packs` in CLAUDE.md).
# Shipping them here wastes firmware space AND defeats the manifest update
# path (the user's Languages card wouldn't be able to update them).
BUNDLED_CODES="en zh-CN"
LOCALES_OUT="$STAGING_DIR/out/locales"
if [ -d "$LOCALES_OUT" ]; then
  step "Filtering bundled locales (keeping: $BUNDLED_CODES)..."
  STRIPPED=0
  for locale_dir in "$LOCALES_OUT"/*/; do
    [ -d "$locale_dir" ] || continue
    code="$(basename "$locale_dir")"
    keep=0
    for bc in $BUNDLED_CODES; do
      [ "$code" = "$bc" ] && { keep=1; break; }
    done
    if [ "$keep" -eq 0 ]; then
      rm -rf "$locale_dir"
      STRIPPED=$((STRIPPED + 1))
      printf "  Stripped: %s\n" "$code"
    fi
  done
  [ "$STRIPPED" -eq 0 ] && printf "  (no non-bundled locales to strip)\n"
fi

step "Copying backend scripts..."
mkdir -p "$STAGING_DIR/scripts"
for item in "$SCRIPTS_DIR"/*; do
  name="$(basename "$item")"
  case "$name" in install.sh|uninstall.sh) continue ;; esac
  cp -r "$item" "$STAGING_DIR/scripts/$name"
done

step "Copying install & uninstall scripts..."
cp "$SCRIPTS_DIR/install.sh" "$STAGING_DIR/install.sh"
cp "$SCRIPTS_DIR/uninstall.sh" "$STAGING_DIR/uninstall.sh"

step "Stamping version from package.json..."
PKG_VERSION=$(sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT_DIR/package.json" | head -n1)
[ -n "$PKG_VERSION" ] || fail "Could not read version from package.json"
for script in "$STAGING_DIR/install.sh" "$STAGING_DIR/uninstall.sh"; do
  tmp="$script.tmp"
  sed "s|^VERSION=\"[^\"]*\"|VERSION=\"$PKG_VERSION\"|" "$script" > "$tmp" && mv "$tmp" "$script"
  chmod +x "$script"
done
grep -q "^VERSION=\"$PKG_VERSION\"" "$STAGING_DIR/install.sh" || fail "Failed to stamp install.sh with version $PKG_VERSION"
grep -q "^VERSION=\"$PKG_VERSION\"" "$STAGING_DIR/uninstall.sh" || fail "Failed to stamp uninstall.sh with version $PKG_VERSION"
step "Stamped install.sh + uninstall.sh with version: $PKG_VERSION"

step "Linting install.sh (filesystem-driven design)..."
# install.sh v2 is filesystem-driven: it iterates $INITD_DIR/qmanager* instead
# of hardcoding service names. The only hardcoded list is UCI_GATED_SERVICES.
# This lint ensures:
#   1. The filesystem iteration pattern is present (not replaced by hardcoding)
#   2. Every service listed in UCI_GATED_SERVICES actually exists in the tarball
#   3. The main 'qmanager' init.d service exists (required for start_services)
LINT_ERRORS=0

# Check 1: filesystem iteration pattern must be present
if ! grep -q 'for svc in "\$INITD_DIR"/qmanager\*' "$STAGING_DIR/install.sh"; then
  printf "  ${RED}BROKEN:${NC} install.sh is missing the filesystem-driven service iteration pattern\n"
  LINT_ERRORS=$((LINT_ERRORS + 1))
fi

# Check 2: the main qmanager init.d service must exist
if [ ! -f "$SCRIPTS_DIR/etc/init.d/qmanager" ]; then
  printf "  ${RED}MISSING:${NC} scripts/etc/init.d/qmanager (main service) does not exist\n"
  LINT_ERRORS=$((LINT_ERRORS + 1))
fi

# Check 3: every service in UCI_GATED_SERVICES must exist as a real init.d file
UCI_GATED_LINE=$(grep '^UCI_GATED_SERVICES=' "$STAGING_DIR/install.sh" || true)
if [ -z "$UCI_GATED_LINE" ]; then
  printf "  ${RED}MISSING:${NC} UCI_GATED_SERVICES constant not found in install.sh\n"
  LINT_ERRORS=$((LINT_ERRORS + 1))
else
  UCI_GATED_VALUE=$(printf '%s' "$UCI_GATED_LINE" | sed 's/^UCI_GATED_SERVICES="\(.*\)"$/\1/')
  for svc in $UCI_GATED_VALUE; do
    if [ ! -f "$SCRIPTS_DIR/etc/init.d/$svc" ]; then
      printf "  ${RED}STALE:${NC} UCI_GATED_SERVICES references '%s' but scripts/etc/init.d/%s does not exist\n" "$svc" "$svc"
      LINT_ERRORS=$((LINT_ERRORS + 1))
    fi
  done
fi

if [ "$LINT_ERRORS" -gt 0 ]; then
  fail "install.sh lint failed with $LINT_ERRORS error(s)"
fi
step "install.sh lint passed (filesystem iteration + UCI_GATED_SERVICES valid)"

step "Copying bundled binaries (dependencies/)..."
mkdir -p "$STAGING_DIR/dependencies"
cp "$DEPS_DIR/atcli_smd11" "$STAGING_DIR/dependencies/atcli_smd11"
cp "$DEPS_DIR/sms_tool" "$STAGING_DIR/dependencies/sms_tool"
chmod 755 "$STAGING_DIR/dependencies/atcli_smd11" "$STAGING_DIR/dependencies/sms_tool"

step "Normalising file permissions for OpenWRT..."
# uhttpd requires world-readable files; macOS umask 077 produces 600/700 which causes 403.
find "$STAGING_DIR" -type d -exec chmod 755 {} \;
find "$STAGING_DIR" -type f -exec chmod 644 {} \;
# Restore executable bit on scripts, CGIs, init.d, and binaries
find "$STAGING_DIR" -type f -name '*.sh' -exec chmod 755 {} \;
find "$STAGING_DIR/scripts/etc/init.d" -type f -exec chmod 755 {} \; 2>/dev/null || true
find "$STAGING_DIR/scripts/usr/bin" -type f -exec chmod 755 {} \; 2>/dev/null || true
find "$STAGING_DIR/dependencies" -type f -exec chmod 755 {} \; 2>/dev/null || true
chmod 755 "$STAGING_DIR/install.sh" "$STAGING_DIR/uninstall.sh"

step "Creating qmanager.tar.gz..."
tar czf "$ARCHIVE" -C "$BUILD_DIR" qmanager_install

step "Generating sha256sum.txt..."
(cd "$BUILD_DIR" && sha256sum qmanager.tar.gz > sha256sum.txt)

# Cleanup staging only after both release artifacts exist.
if [ -f "$ARCHIVE" ] && [ -f "$BUILD_DIR/sha256sum.txt" ]; then
  step "Cleaning up staging directory..."
  rm -rf "$STAGING_DIR"
fi

ARCHIVE_SIZE=$(du -h "$ARCHIVE" | cut -f1)
FILE_COUNT=$(tar tzf "$ARCHIVE" | wc -l)
SHA_VALUE=$(awk '{print $1}' "$BUILD_DIR/sha256sum.txt")
printf "\n${GREEN}${BOLD}Build complete!${NC} qmanager.tar.gz (%s, %d files)\n" "$ARCHIVE_SIZE" "$FILE_COUNT"
printf "SHA-256: %s\n\n" "$SHA_VALUE"
