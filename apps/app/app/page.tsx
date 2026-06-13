import Link from "next/link"
import { Button } from "@workspace/ui/components/button"
import { HomeProvider } from "@/components/home/home-provider"
import { RoomsView } from "@/components/home/rooms-view"
import { getUserId } from "@/lib/auth-helpers"

export default async function Page() {
  const userId = await getUserId()

  if (!userId) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-6 py-10">
        <h1 className="text-2xl font-medium">Screenplay</h1>
        <p className="max-w-md text-center text-sm text-muted-foreground">
          Design UI on an infinite canvas. Each iframeLayer runs a live sandbox.
          Collaborate in real time.
        </p>
        <Button asChild>
          <Link href="/sign-in">Sign in to get started</Link>
        </Button>
      </div>
    )
  }

  return (
    <HomeProvider>
      <RoomsView />
    </HomeProvider>
  )
}
