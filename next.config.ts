import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Build from scratch every time. With Next 16's on-disk build cache restored by Vercel, a
    // deploy shipped new components with the previous globals.css (the Start-here pin styles
    // were missing). scripts/check-build-css.mjs now fails a build whose stylesheet is incomplete.
    turbopackFileSystemCacheForBuild: false,
  },
  // Loaded from node_modules at runtime by the local API routes (it ships its own WASM loader).
  serverExternalPackages: ["web-tree-sitter"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
