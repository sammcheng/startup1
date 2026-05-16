"use client";

import { SignIn } from "@clerk/nextjs";

import AuthShell from "@/components/auth/AuthShell";

export default function SignInPage() {
  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Sign in to manage your tools and API keys"
      description="Hackmarket keeps your marketplace activity, billing, and developer credentials in one place."
      alternateHref="/sign-up"
      alternateLabel="Need an account?"
      alternateCta="Create one"
    >
      <SignIn
        path="/sign-in"
        routing="path"
        signUpUrl="/sign-up"
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
