import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // CEO OS serves no user images; disabling the optimizer removes an attack surface.
  images: { unoptimized: true },
  reactStrictMode: true,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default config;
