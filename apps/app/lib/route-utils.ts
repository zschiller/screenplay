export function routeToLabel(route: string): string {
  if (!route || route === "/") return "Home"
  const last = route.split("/").filter(Boolean).pop() ?? ""
  if (!last) return "Home"
  const cleaned = last.replace(/[-_]+/g, " ").trim()
  if (!cleaned) return "Home"
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

export function normalizeRoute(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return "/"
  return trimmed.startsWith("/") ? trimmed : "/" + trimmed
}
