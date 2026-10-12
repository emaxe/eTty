#!/usr/bin/env bash
set -euo pipefail

trap 'printf "\n${RED}Interrupted by user${RESET}\n"; exit 130' INT

# ─── Colors ───────────────────────────────────────────────────────
RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
CYAN=$'\033[0;36m'
BLUE=$'\033[0;34m'
MAGENTA=$'\033[0;35m'
BOLD=$'\033[1m'
DIM=$'\033[2m'
RESET=$'\033[0m'

# ─── Helpers ──────────────────────────────────────────────────────
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOBILE_DIR="$PROJECT_ROOT/mobile"
COLS=$(tput cols 2>/dev/null || echo 60)

hr() {
  printf "  ${DIM}"
  printf '%.0s─' $(seq 1 $((COLS - 4)))
  printf "${RESET}\n"
}

print_header() {
  clear
  echo ""
  printf "  ${CYAN}${BOLD}"
  cat <<'ART'
         _   _
    ___ | |_| |_ _   _
   / _ \| __| __| | | |
  |  __/| |_| |_| |_| |
   \___| \__|\__|\__, |
                  |___/
ART
  printf "${RESET}"
  printf "  ${DIM}v$(node -p "require('$PROJECT_ROOT/package.json').version" 2>/dev/null || echo '0.1.0')${RESET}  ${DIM}·${RESET}  ${DIM}Terminal wrapper application${RESET}\n"
  echo ""
  hr
  echo ""
}

print_menu() {
  printf "  ${BOLD}Choose a mode:${RESET}\n\n"

  printf "  ${CYAN}${BOLD}[1]${RESET}  ${GREEN}dev${RESET}        ${DIM}─${RESET}  Development with hot reload\n"
  printf "  ${CYAN}${BOLD}[2]${RESET}  ${GREEN}build${RESET}      ${DIM}─${RESET}  Build for production\n"
  printf "  ${CYAN}${BOLD}[3]${RESET}  ${GREEN}preview${RESET}    ${DIM}─${RESET}  Build & launch production build\n"
  printf "  ${CYAN}${BOLD}[4]${RESET}  ${MAGENTA}dist:mac${RESET}   ${DIM}─${RESET}  Build + package macOS .dmg\n"
  printf "  ${CYAN}${BOLD}[5]${RESET}  ${YELLOW}clean${RESET}      ${DIM}─${RESET}  Remove build artifacts\n"
  printf "  ${CYAN}${BOLD}[6]${RESET}  ${YELLOW}rebuild${RESET}    ${DIM}─${RESET}  Clean + install + build\n"
  printf "  ${CYAN}${BOLD}[7]${RESET}  ${BLUE}install${RESET}    ${DIM}─${RESET}  Install dependencies\n"
  printf "  ${CYAN}${BOLD}[8]${RESET}  ${GREEN}mobile:apk${RESET} ${DIM}─${RESET}  Build Android APK (release)\n"
  printf "  ${CYAN}${BOLD}[9]${RESET}  ${GREEN}mobile:run${RESET} ${DIM}─${RESET}  Run mobile app on device/emulator\n"
  echo ""
  printf "  ${DIM}[q]  Quit${RESET}\n"
  echo ""
  hr
  echo ""
}

confirm() {
  local msg="${1:-Continue?}"
  printf "  ${YELLOW}▸ ${msg} [y/N]:${RESET} "
  read -r answer
  [[ "$answer" =~ ^[Yy]$ ]]
}

run_cmd() {
  local label="$1"
  shift
  echo ""
  hr
  printf "  ${CYAN}${BOLD}▸${RESET} ${BOLD}${label}${RESET}\n"
  printf "  ${DIM}\$ %s${RESET}\n" "$*"
  hr
  echo ""
  (cd "$PROJECT_ROOT" && "$@")
}

run_mobile() {
  local label="$1"
  shift
  echo ""
  hr
  printf "  ${CYAN}${BOLD}▸${RESET} ${BOLD}${label}${RESET}\n"
  printf "  ${DIM}\$ (cd mobile && %s)${RESET}\n" "$*"
  hr
  echo ""
  (cd "$MOBILE_DIR" && "$@")
}

success() {
  echo ""
  printf "  ${GREEN}${BOLD}✓${RESET} ${GREEN}Done!${RESET}\n"
}

fail() {
  echo ""
  printf "  ${RED}${BOLD}✗${RESET} ${RED}Failed (exit code: %s)${RESET}\n" "$1"
}

pause() {
  echo ""
  printf "  ${DIM}Press Enter to return to menu...${RESET}"
  read -r
}

# ─── Actions ──────────────────────────────────────────────────────
do_dev() {
  run_cmd "Starting dev server..." npx electron-vite dev
  success
}

do_build() {
  run_cmd "Building for production..." npx electron-vite build
  success
}

do_preview() {
  run_cmd "Building for production..." npx electron-vite build
  echo ""
  run_cmd "Launching production build..." npx electron .
  success
}

do_dist_mac() {
  _check_signing_env
  run_cmd "Building for production..." npx electron-vite build
  echo ""
  run_cmd "Packaging macOS .dmg..." npx electron-builder --mac
  echo ""
  printf "  ${DIM}Artifacts:${RESET}\n"
  ls -lh "$PROJECT_ROOT/dist/"*.dmg 2>/dev/null | while read -r line; do
    printf "  ${GREEN}  %s${RESET}\n" "$line"
  done
  success
}

do_clean() {
  if confirm "Remove out/ and dist/ directories?"; then
    run_cmd "Cleaning build artifacts..." rm -rf "$PROJECT_ROOT/out" "$PROJECT_ROOT/dist"
    success
  else
    printf "  ${DIM}Skipped.${RESET}\n"
  fi
}

do_rebuild() {
  if confirm "This will clean, reinstall, and rebuild. Proceed?"; then
    run_cmd "Cleaning..." rm -rf "$PROJECT_ROOT/out" "$PROJECT_ROOT/dist"
    run_cmd "Installing dependencies..." npm install --prefix "$PROJECT_ROOT" --ignore-scripts --no-audit --no-fund
    if [ -d "$PROJECT_ROOT/node_modules/node-pty" ]; then
      echo ""
      hr
      printf "  ${CYAN}${BOLD}▸${RESET} ${BOLD}Rebuilding native modules (node-pty)...${RESET}\n"
      # SDK путь берём у активного Xcode/CLT через xcrun, а не хардкодим — после смены Xcode
      # (upgrade/переустановка) захардкоженный путь до CommandLineTools SDK может не совпадать
      # с текущим `xcode-select -p`, из-за чего сборка падает на "unknown type name 'uint32_t'"
      # (не резолвится <cstdint> транзитивно). Fallback — старый путь, если xcrun недоступен.
      local sdk_cpp_path
      sdk_cpp_path="$(xcrun --show-sdk-path 2>/dev/null)/usr/include/c++/v1"
      if [ ! -d "$sdk_cpp_path" ]; then
        sdk_cpp_path="/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/include/c++/v1"
      fi
      printf "  ${DIM}\$ CPLUS_INCLUDE_PATH=%s npx electron-rebuild -f -w node-pty${RESET}\n" "$sdk_cpp_path"
      hr
      echo ""
      (cd "$PROJECT_ROOT" && CPLUS_INCLUDE_PATH="$sdk_cpp_path" npx electron-rebuild -f -w node-pty) || {
        echo ""
        printf "  ${RED}▸ Native module rebuild failed. Try manually:${RESET}\n"
        printf "  ${DIM}  CPLUS_INCLUDE_PATH=%s npx electron-rebuild -f -w node-pty${RESET}\n" "$sdk_cpp_path"
        printf "  ${DIM}  Если ошибка про 'distutils' — node-gyp нужен Python ≤3.11 (в 3.12+ distutils удалён):${RESET}\n"
        printf "  ${DIM}  npm_config_python=/path/to/python3.11 CPLUS_INCLUDE_PATH=%s npx electron-rebuild -f -w node-pty${RESET}\n" "$sdk_cpp_path"
        echo ""
      }
    fi
    run_cmd "Building..." npx electron-vite build
    success
  else
    printf "  ${DIM}Skipped.${RESET}\n"
  fi
}

do_install() {
  run_cmd "Installing dependencies..." npm install --prefix "$PROJECT_ROOT" --ignore-scripts --no-audit --no-fund
  success
}

# ─── Mobile (Flutter) ─────────────────────────────────────────────
# Gradle требует JDK. Flutter берёт его из JAVA_HOME, иначе пробует JBR из Android Studio;
# на чистой машине java может быть вообще не в PATH (см. README: brew install openjdk@21).
_resolve_java_home() {
  if [[ -n "${JAVA_HOME:-}" && -x "${JAVA_HOME}/bin/java" ]]; then
    printf "  ${DIM}JAVA_HOME=%s${RESET}\n" "$JAVA_HOME"
    return
  fi
  local c
  for c in \
    "$(/usr/libexec/java_home 2>/dev/null || true)" \
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
    "$(brew --prefix openjdk@21 2>/dev/null || true)/libexec/openjdk.jdk/Contents/Home" \
    "$(brew --prefix openjdk 2>/dev/null || true)/libexec/openjdk.jdk/Contents/Home"; do
    if [[ -n "$c" && -x "$c/bin/java" ]]; then
      export JAVA_HOME="$c"
      printf "  ${DIM}JAVA_HOME=%s${RESET}\n" "$JAVA_HOME"
      return
    fi
  done
  printf "  ${YELLOW}▸ JDK не найден — Gradle-сборка упадёт. Установи: ${BOLD}brew install openjdk@21${RESET}\n"
  printf "  ${DIM}  или задай JAVA_HOME вручную.${RESET}\n\n"
}

_missing_flutter() {
  command -v flutter >/dev/null 2>&1 && return 1
  printf "  ${RED}▸ flutter не найден в PATH.${RESET}\n"
  printf "  ${DIM}  Установи Flutter SDK: https://docs.flutter.dev/get-started/install${RESET}\n"
  return 0
}

do_mobile_apk() {
  _missing_flutter && return 1
  printf "  ${CYAN}${BOLD}▸${RESET} ${BOLD}Building Android APK (release)...${RESET}\n"
  _resolve_java_home
  run_mobile "Building Android APK (release)..." \
    flutter build apk --release || { fail "$?"; return 1; }
  echo ""
  printf "  ${DIM}Artifacts:${RESET}\n"
  ls -lh "$MOBILE_DIR/build/app/outputs/flutter-apk/"*.apk 2>/dev/null | while read -r line; do
    printf "  ${GREEN}  %s${RESET}\n" "$line"
  done
  success
}

do_mobile_run() {
  _missing_flutter && return 1
  _resolve_java_home
  echo ""
  printf "  ${DIM}Devices:${RESET}\n"
  (cd "$MOBILE_DIR" && flutter devices) 2>/dev/null | sed 's/^/  /' || true
  run_mobile "Running mobile app (flutter run)..." flutter run || { fail "$?"; return 1; }
  success
}

# Signing env hint (shown before dist:mac)
_check_signing_env() {
  local missing=()
  for v in CSC_LINK CSC_KEY_PASSWORD APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID; do
    [[ -z "${!v:-}" ]] && missing+=("$v")
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    printf "  ${YELLOW}▸ Signing env vars not set (ad-hoc only): %s${RESET}\n" "${missing[*]}"
    printf "  ${DIM}  Set them to produce a signed + notarized release.${RESET}\n\n"
  else
    printf "  ${GREEN}▸ Signing env vars detected — release signing enabled.${RESET}\n\n"
  fi
}

# ─── CLI argument mode ────────────────────────────────────────────
if [[ $# -gt 0 ]]; then
  case "$1" in
    dev)      do_dev      ;;
    build)    do_build    ;;
    preview)  do_preview  ;;
    dist:mac) do_dist_mac ;;
    clean)    do_clean    ;;
    rebuild)  do_rebuild  ;;
    install)  do_install  ;;
    mobile:apk) do_mobile_apk ;;
    mobile:run) do_mobile_run ;;
    *)
      printf "${RED}Unknown mode: %s${RESET}\n" "$1"
      echo "Usage: $0 [dev|build|preview|dist:mac|clean|rebuild|install|mobile:apk|mobile:run]"
      exit 1
      ;;
  esac
  exit $?
fi

# ─── Interactive menu loop ────────────────────────────────────────
while true; do
  print_header
  print_menu
  printf "  ${BOLD}>${RESET} "
  read -r choice

  case "$choice" in
    1) do_dev      ; pause ;;
    2) do_build    ; pause ;;
    3) do_preview  ; pause ;;
    4) do_dist_mac ; pause ;;
    5) do_clean    ; pause ;;
    6) do_rebuild  ; pause ;;
    7) do_install  ; pause ;;
    8) do_mobile_apk ; pause ;;
    9) do_mobile_run ; pause ;;
    q|Q) printf "\n  ${DIM}Bye!${RESET}\n\n" ; exit 0 ;;
    *)
      printf "\n  ${RED}Invalid choice.${RESET}\n"
      pause
      ;;
  esac
done
