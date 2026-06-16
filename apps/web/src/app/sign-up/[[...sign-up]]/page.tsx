"use client";

import { SignUp } from "@clerk/nextjs";

import { AuthPageShell } from "@/components/auth/AuthPageShell";

export default function SignUpPage() {
  return (
    <AuthPageShell
      eyebrow="Create account"
      title="Start with GitHub or email"
      fallbackCopy="The account screens are wired, but this local environment still needs Clerk keys before live sign-up can run."
    >
      <SignUp
        routing="path"
        path="/sign-up"
        signInUrl="/sign-in"
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

