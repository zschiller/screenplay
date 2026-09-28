/**
 * The public docs site. Absolute so the link works from every build: the
 * hosted app lives on its own subdomain and the desktop app has no web origin
 * at all. The marketing site proxies `/docs` to the docs app (see
 * apps/web/vercel.json).
 */
export const docsUrl = "https://screenplay.space/docs"
