import { toast } from "sonner"
import { deletedMessage, type DeleteStep } from "@/lib/canvas/undo"

/**
 * The one delete rule's toast: a canvas object deletes at once, for everyone,
 * and this offers Undo until something newer lands on the undo stack.
 */
export function showDeleteToast(step: DeleteStep): void {
  const id = toast(deletedMessage(step.counts), {
    action: { label: "Undo", onClick: () => step.undo() },
  })
  step.onSettled(() => toast.dismiss(id))
}
