#!/usr/bin/env bash
# Assemble + zip the three TKO submission folders. Run after the app is deployed
# and the live-app evidence (assist_log.jsonl) has been captured.
# Prints a per-submission checklist and only zips folders whose required files exist.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."   # repo root

check() {  # $1=folder  $2..=required files
  local dir="$1"; shift
  local missing=0
  echo "== $dir =="
  for f in "$@"; do
    if [[ -s "$dir/$f" ]]; then echo "  ok   $f"; else echo "  MISS $f"; missing=1; fi
  done
  return $missing
}

# Build 1
check submission1 \
  connectivity_check.txt search_query.txt search_result.json \
  core_question.txt core_query.sql core_query_result.json branch.txt \
  && zip -qr submission1.zip submission1 && echo "  -> submission1.zip" \
  || echo "  submission1 incomplete (reverse_sync_sample.json is Brian's; add if available)"

# Build 2
check submission2 \
  writeback_table.json state_table.json view_query.sql view_result.json \
  assist_log.jsonl drafted_sample.md hero_question.txt git_history.txt \
  && { cp -f app/... /dev/null 2>/dev/null; zip -qr submission2.zip submission2 && echo "  -> submission2.zip"; } \
  || echo "  submission2 incomplete (assist_log.jsonl needs a live app chat turn)"

# Build 3 (Vinod owns; assemble if he shared exports)
check submission3 \
  gateway_service.txt app_inference_table.json gateway_usage.lvdash.json agent_thread.txt \
  && zip -qr submission3.zip submission3 && echo "  -> submission3.zip" \
  || echo "  submission3 is Vinod's (gateway) - assemble from his exports"

echo ""
echo "Refresh git_history.txt before zipping:"
echo "  git log --graph --oneline --decorate --all > submission2/git_history.txt"
