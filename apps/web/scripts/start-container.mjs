import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export function validateRuntimeEnv(env = process.env) {
  const errors = [];
  const clerkSecretKey = env.CLERK_SECRET_KEY?.trim() || "";

  if (!clerkSecretKey) {
    errors.push("CLERK_SECRET_KEY is required at container runtime.");
  } else if (!/^sk_(test|live)_[A-Za-z0-9]+$/.test(clerkSecretKey)) {
    errors.push("CLERK_SECRET_KEY must look like a Clerk secret key.");
  } else if (
    env.NODE_ENV === "production" &&
    !clerkSecretKey.startsWith("sk_live_")
  ) {
    errors.push("CLERK_SECRET_KEY must use a live Clerk key in production.");
  }

  return errors;
}

function startServer() {
  const errors = validateRuntimeEnv();
  if (errors.length > 0) {
    console.error("Frontend runtime environment validation failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  const server = spawn(process.execPath, ["server.js"], {
    env: process.env,
    stdio: "inherit",
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => server.kill(signal));
  }
  server.on("error", (error) => {
    console.error("Failed to start the frontend server:", error);
    process.exit(1);
  });
  server.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) startServer();
