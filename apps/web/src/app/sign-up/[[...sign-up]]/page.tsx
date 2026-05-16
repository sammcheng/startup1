"use client";

import { SignUp } from "@clerk/nextjs";

import AuthShell from "@/components/auth/AuthShell";

export default function SignUpPage() {
  return (
    <AuthShell
      eyebrow="Join Hackmarket"
      title="Create your account and start publishing tools"
      description="Spin up your seller dashboard, issue buyer keys, and bring dormant projects back to life with a real API surface."
      alternateHref="/sign-in"
      alternateLabel="Already have an account?"
      alternateCta="Sign in"
    >
      <SignUp
        path="/sign-up"
        routing="path"
        signInUrl="/sign-in"
        forceRedirectUrl="/dashboard"
        appearance={{
          elements: {
            rootBox: "w-full",
            card: "shadow-none border-0 rounded-none",
          },
        }}
      />
    </AuthShell>
  );
}
