"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group font-sans!"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      // The toast stays neutral; only its icon takes the status colour. Like
      // every floating surface it is flat, set off by its border (#1006).
      // Sonner sets its own font-family and a 6px button radius, so the toast
      // and its buttons take the app's sans and button radius back (#1028).
      toastOptions={{
        classNames: {
          toast: "shadow-none! font-sans!",
          actionButton: "rounded-lg!",
          cancelButton: "rounded-lg!",
          error: "[&_[data-icon]]:text-destructive",
          success: "[&_[data-icon]]:text-success",
          warning: "[&_[data-icon]]:text-warning",
          info: "[&_[data-icon]]:text-info",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
