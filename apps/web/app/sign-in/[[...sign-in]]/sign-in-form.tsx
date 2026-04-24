"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { authClient } from "@/lib/auth-client"

export function SignInForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get("redirect") ?? "/"
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleEmailSignIn(e: { preventDefault(): void }) {
    e.preventDefault()
    setError(null)
    setPending(true)
    const res = await authClient.signIn.email({ email, password })
    setPending(false)
    if (res.error) {
      setError(res.error.message ?? "Sign-in failed")
      return
    }
    router.push(redirect)
    router.refresh()
  }

  async function handleGitHub() {
    setError(null)
    setPending(true)
    await authClient.signIn.social({
      provider: "github",
      callbackURL: redirect,
    })
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-medium">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Sign in with GitHub to unlock sandbox push & PR features.
        </p>
      </div>
      <Button
        type="button"
        className="w-full"
        onClick={handleGitHub}
        disabled={pending}
      >
        Continue with GitHub
      </Button>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        or
        <div className="h-px flex-1 bg-border" />
      </div>
      <form onSubmit={handleEmailSignIn} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="outline" className="w-full" disabled={pending}>
          {pending ? "Signing in…" : "Sign in with email"}
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        New here?{" "}
        <Link className="underline underline-offset-4" href="/sign-up">
          Create an account
        </Link>
      </p>
    </div>
  )
}
