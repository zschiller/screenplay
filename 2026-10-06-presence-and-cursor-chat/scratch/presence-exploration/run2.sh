cd /home/user/screenplay/apps/app
PAL="oklch(0.74 0.182 55),oklch(0.82 0.235 148),oklch(0.72 0.16 250)"
SELFC="oklch(0.84 0.14 205)"
run(){ EXPLORE_PAL="$4" EXPLORE_SELF="$5" EXPLORE_VARIANT="$2" EXPLORE_CHAT="$3" timeout 600 pnpm screenshots:shots --hosted --label "$1" --screens presence 2>&1 | grep -E "Wrote|no self"; }
run p_today "" 0 "#FFB74D,#4DD0E1,#BA68C8" "#64B5F6"
run p_q3a "q1=a,q3=a" 0 "$PAL" "$SELFC"
run p_q3b "q1=a,q3=b" 0 "$PAL" "$SELFC"
