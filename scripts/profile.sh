#!/bin/bash
# Profile eTty performance — CPU, memory, open files.
# Usage: ./scripts/profile.sh [duration_seconds]
#   duration_seconds: how long to sample the process (default: 10)
#
# Saves report to /tmp/etty-profile-<timestamp>.txt

set -e

DURATION=${1:-10}
PID=$(pgrep -f "eTty.app/Contents/MacOS/eTty" | head -1)

if [ -z "$PID" ]; then
  echo "Error: eTty is not running."
  exit 1
fi

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
OUT="/tmp/etty-profile-${TIMESTAMP}.txt"

echo "Profiling eTty (PID ${PID}) for ${DURATION}s…"
echo "Report will be saved to ${OUT}"

{
  echo "=== eTty Profile Report ==="
  echo "Timestamp: $(date)"
  echo "PID: ${PID}"
  echo "Duration: ${DURATION}s"
  echo ""

  echo "--- Process info ---"
  ps -p "${PID}" -o pid,ppid,pcpu,pmem,rss,vsz,comm,args
  echo ""

  echo "--- Top snapshot ---"
  top -l 1 -pid "${PID}" 2>/dev/null || ps -p "${PID}" -o pid,pcpu,pmem,comm
  echo ""

  echo "--- Children processes ---"
  pgrep -P "${PID}" | xargs ps -o pid,ppid,pcpu,pmem,comm,args 2>/dev/null || true
  echo ""

  echo "--- Open files (first 50) ---"
  lsof -p "${PID}" | head -50
  echo ""

  echo "--- Stack sample (sample ${DURATION}s) ---"
  sample "${PID}" "${DURATION}"
  echo ""

  echo "=== End of report ==="
} > "${OUT}" 2>&1

echo "Report saved to ${OUT}"
