import ts from "typescript"

/**
 * Pulls the **user-facing strings** out of a source file, so the copy check
 * (`ui-copy.test.ts`) can hold them to the glossary's UI labels.
 *
 * "User-facing" is read off the syntax, not guessed from the words: JSX text,
 * string attributes a person reads (`title`, `placeholder`, `aria-label`, …),
 * the message argument of a `toast.*()` call, and object properties with the
 * same reader-facing names (a menu item's `label`, a dialog's `errorFallback`).
 * Everything else — identifiers, routes, class names, log lines, thrown errors
 * — is code and keeps the structural term.
 */

/** JSX attributes and object keys whose string value is rendered to a person. */
export const UI_PROP_NAMES = new Set([
  "title",
  "placeholder",
  "aria-label",
  "label",
  "description",
  "tooltip",
  "emptyText",
  "emptyLabel",
  "errorFallback",
  "successMessage",
  "pendingLabel",
  "loadingMessage",
  "confirmLabel",
  "cancelLabel",
  "actionLabel",
  "heading",
  "subtitle",
  "hint",
])

/** Local bindings whose name says they hold copy: `placeholder`,
 *  `emptyLabel`, `dialogTitle`, `errorMessage`, … */
const UI_BINDING_NAME = /(placeholder|label|title|description|message)$/i

export interface UiString {
  /** 1-indexed line of the string's start. */
  line: number
  /** The string as a person reads it, whitespace collapsed; template holes read `{}`. */
  text: string
  /** Where it came from — `jsx-text`, `attr:title`, `toast`, `prop:label`. */
  kind: string
}

export function extractUiStrings(fileName: string, source: string): UiString[] {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const out: UiString[] = []
  const push = (node: ts.Node, text: string, kind: string) => {
    const trimmed = text.replace(/\s+/g, " ").trim()
    if (!trimmed) return
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
    out.push({ line: line + 1, text: trimmed, kind })
  }

  /** Every string a value expression can render as: literals, both branches of
   *  a ternary, either side of `??` / `||`, and template text around holes. */
  const collect = (expr: ts.Expression | undefined, kind: string) => {
    if (!expr) return
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
      push(expr, expr.text, kind)
    } else if (ts.isTemplateExpression(expr)) {
      push(
        expr,
        expr.head.text +
          expr.templateSpans.map((s) => `{}${s.literal.text}`).join(""),
        kind
      )
    } else if (ts.isConditionalExpression(expr)) {
      collect(expr.whenTrue, kind)
      collect(expr.whenFalse, kind)
    } else if (
      ts.isBinaryExpression(expr) &&
      (expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        expr.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        expr.operatorToken.kind === ts.SyntaxKind.PlusToken)
    ) {
      collect(expr.left, kind)
      collect(expr.right, kind)
    } else if (ts.isParenthesizedExpression(expr)) {
      collect(expr.expression, kind)
    }
  }

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      push(node, node.text, "jsx-text")
    } else if (ts.isJsxExpression(node) && ts.isJsxElement(node.parent)) {
      // `{cond ? "A" : "B"}` as a child renders its strings as text.
      collect(node.expression, "jsx-text")
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf)
      if (UI_PROP_NAMES.has(name) && node.initializer) {
        if (ts.isStringLiteral(node.initializer)) {
          push(node.initializer, node.initializer.text, `attr:${name}`)
        } else if (ts.isJsxExpression(node.initializer)) {
          collect(node.initializer.expression, `attr:${name}`)
        }
      }
    } else if (ts.isPropertyAssignment(node)) {
      const name =
        ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)
          ? node.name.text
          : undefined
      if (name && UI_PROP_NAMES.has(name))
        collect(node.initializer, `prop:${name}`)
    } else if (
      (ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isBindingElement(node)) &&
      ts.isIdentifier(node.name) &&
      UI_BINDING_NAME.test(node.name.text)
    ) {
      // `const placeholder = cond ? "A" : "B"`, `{ placeholder = "Ask…" }`:
      // copy staged in a local before it reaches the JSX.
      collect(node.initializer, `var:${node.name.text}`)
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression
      const isToast =
        (ts.isIdentifier(callee) && callee.text === "toast") ||
        (ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          callee.expression.text === "toast")
      if (isToast) collect(node.arguments[0], "toast")
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/**
 * Every piece of **prose** in a source file: string literals, template text
 * and JSX text that hold a space, so a sentence rather than an identifier,
 * a route or a key. Broader than {@link extractUiStrings} (it can't tell an
 * error a person reads from a log line), so it backs only rules for words
 * that never belong in either, like "workspace".
 */
export function extractProse(fileName: string, source: string): UiString[] {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const out: UiString[] = []
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      const text = node.text.replace(/\s+/g, " ").trim()
      if (text.includes(" ")) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
        out.push({ line: line + 1, text, kind: "prose" })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** JSX attributes in an MDX page whose value a reader sees. */
const MDX_COPY_ATTRS = new Set([
  "alt",
  "caption",
  "title",
  "label",
  "description",
])

/**
 * The **prose** of an MDX docs page, one entry per paragraph (so a rule can
 * match across a line break): the frontmatter's `title` and `description`,
 * text, and reader-facing JSX attributes (`alt`, `caption`, …). Code fences,
 * inline code, `import`/`export` lines, link targets, HTML comments and
 * other attributes (`name="frame-claude-driving"`) are code and are left out.
 */
export function extractMdxProse(source: string): UiString[] {
  const lines = source.split("\n")
  const kept: string[] = []
  let i = 0
  if (lines[0]?.trim() === "---") {
    kept.push("")
    for (i = 1; i < lines.length && lines[i]!.trim() !== "---"; i++) {
      const m = lines[i]!.match(/^(title|description):\s*(.*)$/)
      kept.push(m ? m[2]!.replace(/^["']|["']$/g, "") : "")
    }
    kept.push("")
    i++
  }
  let fence: string | null = null
  for (; i < lines.length; i++) {
    const line = lines[i]!
    const open = line.match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      if (open && open[1]!.startsWith(fence)) fence = null
      kept.push("")
      continue
    }
    if (open) {
      fence = open[1]!
      kept.push("")
      continue
    }
    if (/^(import|export)\s/.test(line)) {
      kept.push("")
      continue
    }
    kept.push(line)
  }

  const text = kept
    .join("\n")
    .replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ""))
    .replace(/`[^`\n]*`/g, "")
    // JSX attributes: keep the reader-facing ones' text, drop the rest.
    .replace(
      /\b([\w-]+)=(?:"([^"]*)"|'([^']*)'|\{[^}]*\})/g,
      (_, name: string, dq?: string, sq?: string) =>
        MDX_COPY_ATTRS.has(name) ? ` ${dq ?? sq ?? ""} ` : ""
    )
    .replace(/<\/?[A-Za-z][\w.]*|\/?>/g, " ")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/https?:\/\/\S+/g, "")

  const out: UiString[] = []
  let start = -1
  let para: string[] = []
  const flush = () => {
    const joined = para.join(" ").replace(/\s+/g, " ").trim()
    if (joined) out.push({ line: start + 1, text: joined, kind: "mdx" })
    para = []
    start = -1
  }
  text.split("\n").forEach((line, n) => {
    if (!line.trim()) return flush()
    if (start < 0) start = n
    para.push(line)
  })
  flush()
  return out
}
