/** One straight quote in a file, as an edit to its curly form. */
export interface QuoteEdit {
  start: number
  end: number
  text: string
  line: number
}

export const PROSE_ATTRS: Set<string>
export function quotesIn(
  src: string,
  start: number,
  end: number,
  options?: { isolated?: boolean; onlyInWord?: boolean; afterValue?: boolean }
): QuoteEdit[]
export function curl(
  mark: "'" | '"',
  prev: string | null,
  next: string | null
): string
export function scanMdx(src: string): QuoteEdit[]
export function scanTsx(src: string, fileName?: string): QuoteEdit[]
export function scan(src: string, fileName: string): QuoteEdit[]
export function applyEdits(src: string, edits: QuoteEdit[]): string
export function copyFiles(path: string): Generator<string>
