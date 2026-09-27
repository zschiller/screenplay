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
