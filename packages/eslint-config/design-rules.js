/**
 * Design rules a machine can judge, as ESLint rules under the `design/`
 * prefix. `jsxTextSpaceRules` reaches every workspace (it's a rendering bug
 * anywhere); `appDesignRules` holds the app's own size and colour rules.
 */

// Expressions that render an element (an icon, a spinner) rather than text.
// A label on the next line after one of these sits in a flex row whose gap
// spaces it, so no space is missing.
function rendersElement(node) {
  switch (node.type) {
    case "JSXElement":
    case "JSXFragment":
      return true
    case "LogicalExpression":
      return rendersElement(node.right)
    case "ConditionalExpression":
      return (
        rendersElementOrNothing(node.consequent) &&
        rendersElementOrNothing(node.alternate)
      )
    default:
      return false
  }
}

function rendersElementOrNothing(node) {
  return (
    (node.type === "Literal" && node.value === null) ||
    (node.type === "Identifier" && node.name === "undefined") ||
    rendersElement(node)
  )
}

// `{" "}` and friends: the expression already supplies the space.
function endsWithSpace(node) {
  if (node.type === "Literal" && typeof node.value === "string") {
    return /\s$/.test(node.value)
  }
  if (node.type === "TemplateLiteral") {
    return /\s$/.test(node.quasis.at(-1).value.cooked ?? "")
  }
  return false
}

/**
 * JSX drops whitespace that contains a newline, so
 *
 *     {count}
 *     files
 *
 * renders “3files”. Flag text that starts on the line after an `{expr}`
 * that renders text.
 */
const jsxTextSpace = {
  meta: {
    type: "problem",
    docs: {
      description:
        "JSX text on the line after an {expression} must keep its space",
    },
    messages: {
      missing:
        'design/jsx-text-space: this text starts on the line after an {expression}, so JSX drops the space between them. Add {" "} after the expression, or put them on one line.',
    },
    schema: [],
  },
  create(context) {
    function check(children) {
      children.forEach((child, i) => {
        if (child.type !== "JSXText" || !child.value.trim()) return
        if (!/^[ \t]*\r?\n/.test(child.value)) return
        const prev = children[i - 1]
        if (prev?.type !== "JSXExpressionContainer") return
        const expr = prev.expression
        if (expr.type === "JSXEmptyExpression") return
        if (rendersElement(expr) || endsWithSpace(expr)) return
        context.report({ node: child, messageId: "missing" })
      })
    }
    return {
      JSXElement: (node) => check(node.children),
      JSXFragment: (node) => check(node.children),
    }
  },
}

/**
 * Text buttons are 28px (`sm`), icon buttons 28px with 16px glyphs
 * (`icon-sm`); `default` and `lg` (32px, 36px) are for dialog footers and
 * page actions.
 */
const BUTTON_SIZES = {
  Button: ["sm", "icon-sm", "default", "lg"],
  IconButton: ["sm", "icon-sm", "default", "lg"],
  InputGroupButton: ["sm", "icon-sm"],
}

function literalValue(attr) {
  const value = attr.value
  if (value?.type === "Literal") return value.value
  if (
    value?.type === "JSXExpressionContainer" &&
    value.expression.type === "Literal"
  ) {
    return value.expression.value
  }
  return undefined
}

const buttonSize = {
  meta: {
    type: "problem",
    docs: { description: "Buttons take only the design system's sizes" },
    messages: {
      size: "design/button-size: {{name}} size “{{size}}” is off the design scale. Use {{allowed}}: text buttons are sm (28px), icon buttons icon-sm (28/16), default and lg only for dialog footers and page actions.",
    },
    schema: [],
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier") return
        const allowed = BUTTON_SIZES[node.name.name]
        if (!allowed) return
        for (const attr of node.attributes) {
          if (attr.type !== "JSXAttribute" || attr.name.name !== "size")
            continue
          const size = literalValue(attr)
          if (typeof size !== "string" || allowed.includes(size)) continue
          context.report({
            node: attr,
            messageId: "size",
            data: {
              name: node.name.name,
              size,
              allowed: allowed.join(", "),
            },
          })
        }
      },
    }
  },
}

// A status colour with an opacity modifier, e.g. `bg-success/10` or
// `hover:text-warning/[0.5]`.
const STATUS_TINT =
  /(?<![\w-])(?:[\w-]+:)*[a-z-]+-(?:success|warning|destructive|info|merged)\/(?:\d+|\[[^\]]+\])(?![\w-])/g

/**
 * The Signal palette shows each status colour only as ink, outline or a
 * solid fill: never as a see-through tint.
 */
const noStatusTint = {
  meta: {
    type: "problem",
    docs: { description: "Status colours are never opacity tints" },
    messages: {
      tint: "design/no-status-tint: “{{cls}}” tints a status colour. Use it as ink (text, icon), an outline or a solid fill, never with a /NN opacity.",
    },
    schema: [],
  },
  create(context) {
    function check(node, text) {
      for (const m of text.matchAll(STATUS_TINT)) {
        context.report({ node, messageId: "tint", data: { cls: m[0] } })
      }
    }
    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value)
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw)
      },
    }
  },
}

export const designPlugin = {
  meta: { name: "design" },
  rules: {
    "jsx-text-space": jsxTextSpace,
    "button-size": buttonSize,
    "no-status-tint": noStatusTint,
  },
}

export const jsxTextSpaceRules = {
  plugins: { design: designPlugin },
  rules: { "design/jsx-text-space": "error" },
}

export const appDesignRules = {
  files: ["**/*.{ts,tsx,js,jsx,mjs}"],
  ignores: ["**/*.test.{ts,tsx}"],
  plugins: { design: designPlugin },
  rules: {
    "design/button-size": "error",
    "design/no-status-tint": "error",
  },
}
