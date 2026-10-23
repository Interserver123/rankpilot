import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // postgres.js must stay a server-only dependency.
  serverExternalPackages: ["postgres"],
  poweredByHeader: false,
};

export default nextConfig;
