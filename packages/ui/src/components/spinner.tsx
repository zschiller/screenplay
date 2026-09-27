import { cn } from "@workspace/ui/lib/utils"
import { Loader2Icon } from "lucide-react"

/**
 * The progress spinner: loading data, a request in flight, a tool call running,
 * a sandbox booting. It is **not** for LLM activity (the agent thinking, a reply
 * streaming, a subagent running); the app uses its 9-dot `GripSpinner`
 * (`apps/app/components/grip-spinner.tsx`) for that, so the grid alone means
 * "the model is working".
 */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon role="status" aria-label="Loading" className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
