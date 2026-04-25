// Skip puppeteer's bundled Chromium download on Vercel — we use
// @sparticuz/chromium at runtime there. Locally the download runs as part of
// `pnpm install` and lands in ~/.cache/puppeteer.
module.exports = {
  skipDownload: !!process.env.VERCEL,
}
