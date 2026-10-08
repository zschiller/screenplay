import { ScreenplayLogo } from "@/components/screenplay-logo"

/**
 * What a viewer the Viewer identity refused sees, whatever they opened
 * (#1931): the entry screens' logo and the identity's own message, which says
 * what to do to get in. The page adds no wording of its own.
 */
export function RefusedScreen({ message }: { message: string }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-background px-6 py-10">
      <div className="flex w-full max-w-[360px] flex-col items-center gap-5 text-center">
        <ScreenplayLogo className="size-11" />
        <p className="max-w-[34ch] text-sm text-balance">{message}</p>
      </div>
    </main>
  )
}
