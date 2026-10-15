#!/bin/bash
# Shoots Today and each option (desktop profile) with the scratch screen
# apps/app/screenshots/screens/scratch/host-badge.ts, light and dark.
# Usage: run.sh <worktree>/apps/app <dump-dir> [today|today-away|a|a-away|b|c|d ...]
APP=$1; DUMPS=$2; shift 2
cd "$APP" || exit 1
shoot(){ # label opt away
  EXPLORE_OPT=$2 EXPLORE_HOST_AWAY=$3 EXPLORE_DUMP="$DUMPS/$1.json" timeout 900 pnpm screenshots:shots --label "hb_$1" --screens host-badge > "$DUMPS/$1.log" 2>&1
  echo "done $1 $?"
}
for l in "$@"; do
  case $l in
    today) shoot today today 0;;
    today-away) shoot today-away today 1;;
    a) shoot a a 0;;
    a-away) shoot a-away a 1;;
    b) shoot b b 0;;
    c) shoot c c 0;;
    d) shoot d d 0;;
  esac
done
