"use client"

import Anser from "anser"
import { createLowlight, common } from "lowlight"
import type { ReactNode } from "react"
import { ansiClassIndex, ansiColorVar } from "@workspace/ui/lib/ansi-palette"

/**
 * How an open tool row colours what it shows (the 2026-10-03 tool-row
 * audit): code is syntax-highlighted with the chat's highlight.js colours,
 * and command output and logs keep their ANSI colours, or, with none, mark
 * their errors, warnings and passes.
 */

const lowlight = createLowlight(common)

const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  css: "css",
  scss: "scss",
  html: "xml",
  svg: "xml",
  xml: "xml",
  md: "markdown",
  mdx: "markdown",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  sh: "bash",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  sql: "sql",
  java: "java",
  kt: "kotlin",
  swift: "swift",
}

/** The highlight.js language for a file path, or null to leave it plain. */
export function languageFor(path: string | null | undefined): string | null {
  if (!path) return null
  const ext = path.split(".").at(-1)?.toLowerCase() ?? ""
  return EXT_LANG[ext] ?? null
}

type HastNode =
  | { type: "text"; value: string }
  | {
      type: "element"
      properties?: { className?: string[] }
      children: HastNode[]
    }
  | { type: "root"; children: HastNode[] }

function render(nodes: HastNode[], key = "k"): ReactNode[] {
  return nodes.map((n, i) => {
    if (n.type === "text") return n.value
    if (n.type === "element") {
      return (
        <span
          key={`${key}-${i}`}
          className={n.properties?.className?.join(" ")}
        >
          {render(n.children, `${key}-${i}`)}
        </span>
      )
    }
    return render(n.children, `${key}-${i}`)
  })
}

/** `text` highlighted as `lang`, as React nodes; plain text when it can't be. */
export function highlight(text: string, lang: string | null): ReactNode {
  if (!lang || !lowlight.registered(lang)) return text
  try {
    const tree = lowlight.highlight(lang, text) as unknown as HastNode
    return render(tree.type === "root" ? tree.children : [tree])
  } catch {
    return text
  }
}

function ansiColor(cls: string | null): string | undefined {
  if (!cls) return undefined
  const index = ansiClassIndex(cls)
  return index !== null ? ansiColorVar(index) : undefined
}

const ERROR_LINE = /(^|\s)(error|Error|ERROR|FAIL|failed|✖|✗|×)(\s|:|$)/
const WARN_LINE = /(^|\s)(warn|warning|Warning|WARN|⚠)(\s|:|$)/
const PASS_GLYPH = /^(\s*)(✓|✔|√)/

/**
 * Command output or a log. ANSI colours, when the output has them, render
 * from the shared ANSI palette; output without any marks its error and
 * warning lines and its pass ticks, and leaves the rest alone.
 */
export function LogText({ text }: { text: string }): ReactNode {
  if (text.includes("\u001b[")) {
    const tokens = Anser.ansiToJson(text, {
      remove_empty: true,
      json: true,
      use_classes: true,
    })
    return tokens.map((t, i) => (
      <span
        key={i}
        style={{
          color: ansiColor(t.fg),
          fontWeight: t.decorations.includes("bold") ? 600 : undefined,
          opacity: t.decorations.includes("dim") ? 0.7 : undefined,
        }}
      >
        {t.content}
      </span>
    ))
  }
  return text.split("\n").map((line, i, all) => {
    const nl = i < all.length - 1 ? "\n" : ""
    if (ERROR_LINE.test(line)) {
      return (
        <span key={i} style={{ color: "var(--destructive)" }}>
          {line}
          {nl}
        </span>
      )
    }
    if (WARN_LINE.test(line)) {
      return (
        <span key={i} style={{ color: "var(--warning)" }}>
          {line}
          {nl}
        </span>
      )
    }
    const pass = PASS_GLYPH.exec(line)
    if (pass) {
      return (
        <span key={i}>
          {pass[1]}
          <span style={{ color: "var(--success)" }}>{pass[2]}</span>
          {line.slice(pass[0].length)}
          {nl}
        </span>
      )
    }
    return (
      <span key={i}>
        {line}
        {nl}
      </span>
    )
  })
}

/**
 * A hosted `run_command` result as the person reads it. The agent sees
 * `stdout:` and `stderr:` sections and a closing `exit code: N`; a passing
 * command's exit code says nothing, and output with no stderr needs no
 * `stdout:` header.
 */
export function commandOutput(text: string): string {
  let out = text.replace(/(?:^|\n\n)exit code: 0\s*$/, "")
  if (!out.includes("\n\nstderr:\n")) out = out.replace(/^stdout:\n/, "")
  return out
}
