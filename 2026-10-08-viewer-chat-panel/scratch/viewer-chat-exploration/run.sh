#!/bin/bash
# Usage: run.sh <apps/app> <dump-dir> label=opts ...
APP=$1; D=$2; shift 2; cd "$APP" || exit 1
for spec in "$@"; do
  l=${spec%%=*}; o=${spec#*=}
  EXPLORE_OPT=$o EXPLORE_DUMP="$D/$l.json" timeout 600 pnpm screenshots:shots --label "vc_$l" --screens vc-plan,vc-canvas > "$D/$l.log" 2>&1
  echo "done $l $?"
done
