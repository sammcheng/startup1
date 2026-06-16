"use client";

import { SignIn } from "@clerk/nextjs";

import { AuthPageShell } from "@/components/auth/AuthPageShell";

export default function SignInPage() {
  return (
    <AuthPageShell
      eyebrow="Account access"
      title="Sign in to your dashboard"
      fallbackCopy="Auth is ready in the UI, but Clerk keys are not configured in this local environment yet."
    >
      <SignIn
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
        fallbackRedirectUrl="/dashboard"
        appearance={{
          elements: {
            rootBox: { width: "100%" },
            cardBox: { width: "100%" },
          },
        }}
      />
    </AuthPageShell>
  );
}

