cd /home/user/screenplay/apps/app
PAL="oklch(0.74 0.182 55),oklch(0.82 0.235 148),oklch(0.72 0.16 250)"
SELFC="oklch(0.84 0.14 205)"
run(){ EXPLORE_PAL="$PAL" EXPLORE_SELF="$SELFC" EXPLORE_VARIANT="$2" EXPLORE_CHAT="$3" timeout 600 pnpm screenshots:shots --hosted --label "$1" --screens presence 2>&1 | grep -E "Wrote|rror"; }
run q1a "q1=a" 0
run q1b "q1=b" 0
run q1c "q1=c" 0
run q2a "q1=a,q2=a" 1
run q2b "q1=a,q2=b" 1
run q2c "q1=a,q2=c" 1
run q3a "q1=a,q3=a" 0
run q3b "q1=a,q3=b" 0
echo ALLDONE
