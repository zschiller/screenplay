import { Suspense } from "react"
import { SignInForm } from "./sign-in-form"

export default function SignInPage() {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Suspense fallback={null}>
        <SignInForm />
      </Suspense>
    </div>
  )
}
