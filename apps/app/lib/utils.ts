/**
 * The one date format for when something happened: relative within a week
 * ("13m ago", "2d ago"), then a short calendar date ("Aug 26"), with the year
 * only once it isn't this one ("Aug 26, 2025").
 */
export function formatDistanceToNow(timestamp: number): string {
  const diff = Date.now() - timestamp
  const seconds = Math.max(0, Math.floor(diff / 1000))
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const date = new Date(timestamp)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  })
}
