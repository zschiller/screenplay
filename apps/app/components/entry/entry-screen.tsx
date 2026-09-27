import { ScreenplayLogo } from "@/components/screenplay-logo"

/**
 * The centred, branded frame a person meets before the app: the sign-in page
 * and the signed-out home. The logo leads, the title uses the same weight as
 * the app's page titles, and the one action sits under a line of copy.
 */
export function EntryScreen({
  description,
  children,
}: {
  description: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-6 py-10">
      <div className="flex flex-col items-center gap-4">
        <ScreenplayLogo className="size-12" />
        <h1 className="text-2xl font-normal">Screenplay</h1>
      </div>
      <p className="max-w-md text-center text-sm text-balance text-muted-foreground">
        {description}
      </p>
      {children}
    </div>
  )
}
