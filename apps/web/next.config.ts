import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  devIndicators: process.env.PLAYWRIGHT_TEST === '1' ? false : undefined,
  trailingSlash: true,
  allowedDevOrigins: ["127.0.0.1"],
  transpilePackages: ["@noor-note/core", "@noor-note/storage", "@noor-note/ui"],
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
