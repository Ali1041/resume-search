import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Exclude Python virtual environment from being processed by Next.js
  experimental: {
    serverComponentsExternalPackages: [],
  },
};

export default nextConfig;
