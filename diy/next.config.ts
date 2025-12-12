
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [],

  // Environment variables that will be available at build time
  env: {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  },
  // Headers for media capture permissions
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Permissions-Policy',
            value: 'camera=self, microphone=self',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
