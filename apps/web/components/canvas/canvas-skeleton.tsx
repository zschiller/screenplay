import { Skeleton } from "@workspace/ui/components/skeleton"

export function CanvasSkeleton() {
  return (
    <div className="fixed inset-0 flex bg-muted/30">
      <aside className="flex h-full w-[240px] shrink-0 flex-col bg-sidebar text-sidebar-foreground">
        <div className="flex h-12 items-center justify-end px-4 pr-3">
          <Skeleton className="size-5 rounded-md" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex flex-col gap-3 p-2 pt-0">
            <div className="relative flex h-8 items-center px-2">
              <Skeleton className="h-3 w-20" />
            </div>
            <ul className="flex flex-col gap-3">
              <li className="flex flex-col gap-1">
                <div className="flex h-8 items-center gap-2 rounded-md px-2">
                  <Skeleton className="size-4 rounded-sm" />
                  <Skeleton className="h-4 flex-1" />
                </div>
                <ul className="ml-3.5 flex flex-col gap-1 border-l border-sidebar-border py-0.5 pl-1">
                  <li className="flex h-8 items-center gap-2 rounded-md px-2">
                    <Skeleton className="size-4 rounded-sm" />
                    <Skeleton className="h-4 w-28" />
                  </li>
                  <li className="ml-3.5 flex flex-col gap-1 border-l border-sidebar-border py-0.5 pl-1">
                    <div className="flex h-7 items-center gap-2 rounded-md px-2">
                      <Skeleton className="size-4 rounded-sm" />
                      <Skeleton className="h-3 flex-1" />
                    </div>
                    <div className="flex h-7 items-center gap-2 rounded-md px-2">
                      <Skeleton className="size-4 rounded-sm" />
                      <Skeleton className="h-3 flex-1" />
                    </div>
                  </li>
                </ul>
              </li>
              <li className="flex flex-col gap-1">
                <div className="flex h-8 items-center gap-2 rounded-md px-2">
                  <Skeleton className="size-4 rounded-sm" />
                  <Skeleton className="h-4 flex-1" />
                </div>
                <ul className="ml-3.5 flex flex-col gap-1 border-l border-sidebar-border py-0.5 pl-1">
                  <li className="flex h-8 items-center gap-2 rounded-md px-2">
                    <Skeleton className="size-4 rounded-sm" />
                    <Skeleton className="h-4 w-24" />
                  </li>
                </ul>
              </li>
            </ul>
          </div>
        </div>
      </aside>
      <div className="w-px bg-border" />
      <div className="relative flex-1">
        <div className="absolute left-0 top-0 flex h-12 items-center px-2">
          <div className="flex items-center gap-1 rounded-lg bg-background p-1 shadow-md outline outline-1 outline-foreground/5">
            <div className="flex h-6 items-center gap-1 px-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="size-3 rounded-sm opacity-60" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
