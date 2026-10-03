"use client"

import { useEffect, useState } from "react"
import { ChatGPTIcon, ClaudeIcon } from "nextra/icons"
import { Button } from "@workspace/ui/components/button"
import { ButtonGroup } from "@workspace/ui/components/button-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  ArrowUpRightIcon,
  CaretDownIcon,
  CheckIcon,
  CopyIcon,
} from "@workspace/ui/components/icons"

/**
 * The Copy page control at the top of every page, as the app's split button:
 * an outline ButtonGroup whose chevron opens a DropdownMenu. Replaces Nextra's
 * own (`copyPageButton={false}` in app/layout.tsx) with the same actions.
 */
export function CopyPage({ sourceCode }: { sourceCode: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  async function copy() {
    await navigator.clipboard.writeText(sourceCode)
    setCopied(true)
  }

  function openIn(url: string) {
    const query = `Read from ${location.href} so I can ask questions about it.`
    window.open(`${url}=${encodeURIComponent(query)}`, "_blank")
  }

  return (
    <ButtonGroup data-pagefind-ignore className="float-end text-foreground">
      <Button variant="outline" onClick={copy}>
        {copied ? <CheckIcon /> : <CopyIcon />}
        {copied ? "Copied" : "Copy page"}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="More copy options">
            <CaretDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <MenuItem
            icon={<CopyIcon />}
            title="Copy page"
            description="Copy page as Markdown for LLMs"
            onSelect={copy}
          />
          <MenuItem
            icon={<ChatGPTIcon />}
            title="Open in ChatGPT"
            description="Ask questions about this page"
            external
            onSelect={() => openIn("https://chatgpt.com/?hints=search&prompt")}
          />
          <MenuItem
            icon={<ClaudeIcon />}
            title="Open in Claude"
            description="Ask questions about this page"
            external
            onSelect={() => openIn("https://claude.ai/new?q")}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  )
}

function MenuItem({
  icon,
  title,
  description,
  external,
  onSelect,
}: {
  icon: React.ReactNode
  title: string
  description: string
  external?: boolean
  onSelect: () => void
}) {
  return (
    <DropdownMenuItem onSelect={onSelect} className="gap-2.5">
      {icon}
      <span className="flex flex-col">
        <span className="flex items-center gap-1">
          {title}
          {external && <ArrowUpRightIcon className="size-3" />}
        </span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
    </DropdownMenuItem>
  )
}
