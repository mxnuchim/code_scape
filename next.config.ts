import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Loaded from node_modules at runtime by the local API routes (it ships its own WASM loader).
  serverExternalPackages: ["web-tree-sitter"],
  // The hosted MCP endpoint parses on the server: ship the grammar WASM files with its function.
  outputFileTracingIncludes: {
    "/api/mcp/**": ["./public/wasm/*.wasm"],
  },
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
