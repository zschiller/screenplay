import { Suspense } from "react"
import { SignUpForm } from "./sign-up-form"

export default function SignUpPage() {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Suspense fallback={null}>
        <SignUpForm />
      </Suspense>
    </div>
  )
}
