#!/usr/bin/env bash
# Benchmark: Upload 10 receipts sequentially, measure per-phase timing via SSE.
# Usage: ./scripts/benchmark.sh

set -euo pipefail

API="http://localhost:3000"
RECEIPT_DIR="$HOME/Desktop/RECEIPT"

# Pick first 10 images
IMAGES=()
while IFS= read -r f; do
  IMAGES+=("$f")
done < <(find "$RECEIPT_DIR" -maxdepth 1 -type f \( -iname '*.jpeg' -o -iname '*.jpg' -o -iname '*.png' \) | sort | head -10)

if [ ${#IMAGES[@]} -lt 10 ]; then
  echo "ERROR: Need at least 10 receipts in $RECEIPT_DIR, found ${#IMAGES[@]}"
  exit 1
fi

echo "═══════════════════════════════════════════════════════════════"
echo "  Receipt Assistant Benchmark — $(date '+%Y-%m-%d %H:%M:%S')"
echo "  Testing ${#IMAGES[@]} receipts sequentially"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Arrays to collect timing data
declare -a PHASE1_TIMES PHASE2_TIMES TOTAL_TIMES

for i in "${!IMAGES[@]}"; do
  img="${IMAGES[$i]}"
  idx=$((i + 1))
  basename=$(basename "$img")
  echo "──────────────────────────────────────────────────────────────"
  echo "[$idx/10] $basename"
  echo "──────────────────────────────────────────────────────────────"

  # Record start time
  T_START=$(date +%s.%N)

  # Upload and get job ID
  RESPONSE=$(curl -s -X POST "$API/receipt" -F "image=@$img")
  JOB_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['jobId'])" 2>/dev/null)

  if [ -z "$JOB_ID" ]; then
    echo "  ERROR: Failed to submit. Response: $RESPONSE"
    continue
  fi
  echo "  Job ID: $JOB_ID"

  # Poll SSE stream, capture timestamps for each phase
  T_QUICK=""
  T_DONE=""
  RESULT_STATUS="unknown"

  # Use curl to read SSE events with a timeout
  while IFS= read -r line; do
    if [[ "$line" == event:* ]]; then
      EVENT_TYPE="${line#event: }"
    fi
    if [[ "$line" == data:* ]]; then
      NOW=$(date +%s.%N)
      case "$EVENT_TYPE" in
        quick_done)
          T_QUICK="$NOW"
          MERCHANT=$(echo "${line#data: }" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('merchant','?'))" 2>/dev/null || echo "?")
          TOTAL_AMT=$(echo "${line#data: }" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('total','?'))" 2>/dev/null || echo "?")
          echo "  Phase 1 done: $MERCHANT — \$$TOTAL_AMT"
          ;;
        done)
          T_DONE="$NOW"
          RESULT_STATUS="done"
          break
          ;;
        error)
          T_DONE="$NOW"
          RESULT_STATUS="error"
          ERROR_MSG=$(echo "${line#data: }" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error','unknown'))" 2>/dev/null || echo "unknown")
          echo "  ERROR: $ERROR_MSG"
          break
          ;;
      esac
    fi
  done < <(curl -s -N "$API/jobs/$JOB_ID/stream" --max-time 300)

  # Calculate durations
  if [ -n "$T_QUICK" ] && [ "$RESULT_STATUS" != "unknown" ]; then
    PHASE1=$(python3 -c "print(f'{$T_QUICK - $T_START:.1f}')")
    PHASE2=$(python3 -c "print(f'{$T_DONE - $T_QUICK:.1f}')")
    TOTAL=$(python3 -c "print(f'{$T_DONE - $T_START:.1f}')")

    echo "  ⏱️  Phase 1 (quick):  ${PHASE1}s"
    echo "  ⏱️  Phase 2 (full):   ${PHASE2}s"
    echo "  ⏱️  Total:            ${TOTAL}s"
    echo "  Status: $RESULT_STATUS"

    PHASE1_TIMES+=("$PHASE1")
    PHASE2_TIMES+=("$PHASE2")
    TOTAL_TIMES+=("$TOTAL")
  else
    echo "  ⚠️  Could not measure timing (status: $RESULT_STATUS)"
  fi
  echo ""
done

# ── Summary ──────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  SUMMARY"
echo "═══════════════════════════════════════════════════════════════"
echo ""

N=${#TOTAL_TIMES[@]}
if [ "$N" -eq 0 ]; then
  echo "  No successful measurements."
  exit 1
fi

python3 -c "
phase1 = [${PHASE1_TIMES[*]/%/,}]
phase2 = [${PHASE2_TIMES[*]/%/,}]
total  = [${TOTAL_TIMES[*]/%/,}]

def stats(name, arr):
    avg = sum(arr) / len(arr)
    mn = min(arr)
    mx = max(arr)
    print(f'  {name:20s}  avg={avg:6.1f}s  min={mn:6.1f}s  max={mx:6.1f}s')

print(f'  Successful runs: {len(total)}/10')
print()
stats('Phase 1 (quick)', phase1)
stats('Phase 2 (full)', phase2)
stats('Total', total)
print()
print(f'  Grand total for {len(total)} receipts: {sum(total):.1f}s')
print(f'  That is {sum(total)/60:.1f} minutes for {len(total)} receipts.')
"
