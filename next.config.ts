import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native modules Next.js's bundler must NOT try to trace and
  // rewrite. argon2 is a native addon (`.node` binary); when
  // bundled it loads fine locally but throws at runtime on Vercel
  // because the binary isn't traced into the serverless function.
  // Marking it external tells Next to require() it at runtime so
  // npm's normal resolution finds the prebuilt binary in
  // node_modules. Without this the credentials-callback throws
  // 500 on every login attempt.
  serverExternalPackages: ["argon2"],
};

export default nextConfig;
