/**
 * The Screenplay mark: the blue smiley screen. This is the one source for its
 * shape and colours. The marketing mascot animates these same primitives;
 * everywhere else (nav lockups, favicons, the app's entry screens) draws them
 * static, through `ScreenplayMark` or `markSvg`.
 */

export const MARK_BLUE = "#106BE3"
export const MARK_NAVY = "#091E46"

/** The wobbly screen, in a 32×32 box. */
export const MARK_BODY =
  "M14.5088 3.04085C15.5148 3.10431 16.5628 2.99732 17.5431 3.00005C18.6559 3.00315 19.7911 3.00336 20.9023 3.01196L24.2755 3.04168C24.4752 3.04508 24.999 3.12068 25.1612 3.10107C25.5156 3.21697 25.8717 3.22566 26.1894 3.32766C26.884 3.55063 27.8039 3.98621 28.3791 4.41655C29.4942 5.25082 30.2068 6.57003 30.6763 7.8537C30.828 8.26826 30.8947 8.80547 31.0048 9.23612C31.5623 11.8892 31.3847 14.6771 31.4089 17.3725C31.4254 19.2079 31.4251 21.0491 31.1841 22.8659C31.148 23.1452 31.031 23.4065 30.9873 23.6836C30.8036 24.8502 30.1931 26.6404 29.1884 27.3389C28.3181 27.9275 27.3429 28.1851 26.3451 28.4206C25.4708 28.6271 24.8177 28.7213 23.9311 28.8073C22.7932 28.9177 21.642 28.9196 20.5067 28.9266L16.1842 28.9517L10.4193 28.939C8.75519 28.9259 7.11224 28.9654 5.46323 28.639C4.33146 28.415 3.60863 27.9556 2.68449 27.2387C1.727 26.496 0.735668 24.6092 0.524591 23.4017C0.478095 22.7296 0.510101 22.0371 0.519412 21.3653C0.539941 19.884 0.539121 18.4171 0.795802 16.9532C0.865588 16.5552 0.853017 16.0977 0.89965 15.6926C0.945756 15.2921 0.999974 14.8873 1.02935 14.4847C1.0644 13.9074 1.05578 13.3383 1.08635 12.7603C1.13552 11.8304 1.19745 10.9079 1.28032 9.98067C1.30865 9.66383 1.28846 9.29603 1.32081 8.97915C1.35682 8.62644 1.46015 8.23919 1.49805 7.88661C1.54509 7.44899 1.50429 7.0164 1.58762 6.57684C1.67897 6.08863 1.88881 5.63032 2.1987 5.2422C2.88077 4.38962 4.10471 3.88925 5.14673 3.77787C5.4302 3.73697 5.7496 3.61453 6.03072 3.58813C7.38683 3.46078 8.74285 3.3445 10.1028 3.28775C10.8066 3.25838 11.5418 3.11374 12.2604 3.07051C12.9848 3.02694 13.8146 3.12037 14.5088 3.04085Z"

export const MARK_LEFT_EYE = { cx: 9.1, cy: 10.8, rx: 1.8, ry: 1.78 }
export const MARK_RIGHT_EYE = { cx: 23.75, cy: 8.75, rx: 1.78, ry: 1.78 }
export const MARK_SMILE = "M14.25 14.4 Q18.4 19.6 22.6 14.9"
export const MARK_SMILE_WIDTH = 2.05

/**
 * The mark as a standalone SVG document, for favicons and other places that
 * need a file rather than a component. Dev builds pass lighter fills so a dev
 * tab is easy to tell from production.
 */
export function markSvg({
  body = MARK_BLUE,
  face = MARK_NAVY,
}: { body?: string; face?: string } = {}): string {
  const eye = (e: typeof MARK_LEFT_EYE) =>
    `<ellipse cx="${e.cx}" cy="${e.cy}" rx="${e.rx}" ry="${e.ry}" fill="${face}"/>`
  return [
    `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">`,
    `<path d="${MARK_BODY}" fill="${body}"/>`,
    eye(MARK_LEFT_EYE),
    eye(MARK_RIGHT_EYE),
    `<path d="${MARK_SMILE}" stroke="${face}" stroke-width="${MARK_SMILE_WIDTH}" stroke-linecap="round"/>`,
    `</svg>`,
  ].join("")
}

/** The dev favicon: a pale screen with a blue face. */
export const DEV_MARK_FILLS = { body: "#C2DCFF", face: MARK_BLUE }
