#!/usr/bin/env bash
# Phase 2 step 1-2: merge the 3 build worktrees into build/volta-app, apply the
# known integration fixes, install deps, and typecheck/build. Run from repo root
# AFTER the server agent has committed on wt/server.
#
# Worktree lanes (verified non-overlapping):
#   wt/server     -> app/server/**, app/config/** (agent tools, writeback, UAIG wiring)
#   wt/plantfloor -> app/client/src/plantfloor/** (3D component)
#   wt/client     -> app/client/src/{home,lib,operations,shared}/** (retheme)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."   # repo root
APP=app

echo "== 1. confirm all 3 worktree branches are committed =="
for b in wt/server wt/plantfloor wt/client; do
  ahead=$(git rev-list --count "2023443..$b" 2>/dev/null || echo 0)
  echo "  $b: $ahead commit(s) ahead of base"
  [ "$ahead" -ge 1 ] || { echo "  ERROR: $b has no commits yet. Wait for that agent."; exit 1; }
done

echo "== 2. merge into build/volta-app (should be conflict-free: disjoint file lanes) =="
git checkout build/volta-app
git merge --no-ff wt/server     -m "merge(server): Volta agent tools + writeback + UAIG gateway wiring" || { echo "CONFLICT on server merge"; exit 1; }
git merge --no-ff wt/plantfloor -m "merge(plantfloor): 3D plant-floor Visualize component" || { echo "CONFLICT on plantfloor merge"; exit 1; }
git merge --no-ff wt/client     -m "merge(client): retheme returns->Volta, wire PlantFloor3D + closed-loop refetch" || { echo "CONFLICT on client merge"; exit 1; }

echo "== 3. delete stale returns-domain files (they import the deleted @/lib/returns and break the build) =="
git rm -f \
  "$APP/client/src/operations/ReturnsTable.tsx" \
  "$APP/client/src/operations/ReturnDrawer.tsx" \
  "$APP/client/src/operations/CityMap.tsx" \
  "$APP/client/src/operations/tabs/ReturnTab.tsx" \
  "$APP/client/src/operations/tabs/CustomerTab.tsx" \
  "$APP/client/src/operations/tabs/ActivityTab.tsx" \
  "$APP/client/src/lib/returns.ts" 2>/dev/null || echo "  (some already gone)"
# Any analytics/FacilityPanel referencing returns:
grep -rl "@/lib/returns" "$APP/client/src" 2>/dev/null | while read -r f; do
  echo "  WARNING still references @/lib/returns: $f"; done

echo "== 4. add three + @types/three to client deps (both frontend agents assumed it present) =="
python3 - "$APP/client/package.json" <<'PY'
import json,sys
p=sys.argv[1]; d=json.load(open(p))
dep=d.setdefault("dependencies",{}); dev=d.setdefault("devDependencies",{})
dep.setdefault("three","^0.169.0")
dev.setdefault("@types/three","^0.169.0")
json.dump(d,open(p,"w"),indent=2); print("  three deps ensured")
PY

echo "== 5. commit the integration fixes =="
git add -A && git commit -m "chore(merge): delete stale returns files, add three dep

Co-authored-by: Isaac <no-reply@databricks.com>" || echo "  (nothing to commit)"

echo "== 6. install + build (client then server) =="
cd "$APP"
npm install 2>&1 | tail -5
echo "-- typecheck/build --"
npm run build 2>&1 | tail -30 || { echo "BUILD FAILED - inspect above"; exit 1; }
echo "== merge_and_build complete =="
