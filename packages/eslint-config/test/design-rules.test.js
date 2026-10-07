import { describe, it } from "node:test"
import { RuleTester } from "eslint"
import tsParser from "@typescript-eslint/parser"
import { designPlugin } from "../design-rules.js"

RuleTester.describe = describe
RuleTester.it = it

const tester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
})
const { rules } = designPlugin

tester.run("design/jsx-text-space", rules["jsx-text-space"], {
  valid: [
    "<p>{count} files</p>",
    '<p>\n  {count}{" "}\n  files\n</p>',
    "<p>\n  {`${count} `}\n  files\n</p>",
    // An icon or spinner before a label: the flex gap spaces them.
    "<Button>\n  {busy && <Spinner />}\n  Save\n</Button>",
    "<Button>\n  {busy ? <Spinner /> : <Icon />}\n  Retry\n</Button>",
    "<Button>\n  {busy ? <Spinner /> : null}\n  Retry\n</Button>",
    "<p>\n  {/* note */}\n  text\n</p>",
    // Text before an expression keeps its own spacing choices (“#{n}”).
    "<a>\n  #\n  {pr.number}\n</a>",
  ],
  invalid: [
    {
      code: "<p>\n  {count}\n  files\n</p>",
      errors: [{ messageId: "missing" }],
    },
    {
      code: "<>\n  {user.name}\n  joined\n</>",
      errors: [{ messageId: "missing" }],
    },
    {
      code: '<p>\n  {busy ? "Saving" : "Saved"}\n  now\n</p>',
      errors: [{ messageId: "missing" }],
    },
  ],
})

tester.run("design/button-size", rules["button-size"], {
  valid: [
    '<Button size="sm">Save</Button>',
    '<Button size="icon-sm" />',
    '<Button size="default">Save</Button>',
    '<Button size={"lg"}>Save</Button>',
    "<Button>Save</Button>",
    "<Button size={size}>Save</Button>",
    '<IconButton label="Close" size="icon-sm" />',
    '<InputGroupButton size="sm" />',
    // Other components keep their own scales.
    '<SidebarMenuButton size="lg" />',
  ],
  invalid: [
    { code: '<Button size="icon" />', errors: [{ messageId: "size" }] },
    {
      code: '<Button size="xs">Save</Button>',
      errors: [{ messageId: "size" }],
    },
    {
      code: '<IconButton label="Close" size="icon-lg" />',
      errors: [{ messageId: "size" }],
    },
    {
      code: '<InputGroupButton size="default" />',
      errors: [{ messageId: "size" }],
    },
  ],
})

tester.run("design/no-status-tint", rules["no-status-tint"], {
  valid: [
    'const c = "text-success border-warning bg-destructive"',
    'const c = "bg-muted/50 ring-ring/50"',
    'const c = "text-info-foreground"',
  ],
  invalid: [
    { code: 'const c = "bg-success/10"', errors: [{ messageId: "tint" }] },
    {
      code: 'const c = "px-2 hover:bg-destructive/20"',
      errors: [{ messageId: "tint" }],
    },
    {
      code: "const c = `border-warning/[0.4] ${x}`",
      errors: [{ messageId: "tint" }],
    },
    {
      code: '<div className="text-merged/80" />',
      errors: [{ messageId: "tint" }],
    },
    {
      code: 'const c = "bg-info/5 text-success/50"',
      errors: [{ messageId: "tint" }, { messageId: "tint" }],
    },
  ],
})
