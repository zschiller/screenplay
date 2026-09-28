import { SettingsView } from "@/components/home/settings-view"

export const metadata = { title: "Settings" }

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string | string[] }>
}) {
  const { section } = await searchParams
  return (
    <SettingsView section={typeof section === "string" ? section : undefined} />
  )
}
