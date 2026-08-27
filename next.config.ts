import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

const securityHeaders = [
  ...(isDev ? [] : [{ key: "X-Frame-Options", value: "DENY" }]),
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // 'unsafe-eval' is required only by dev tooling (React Refresh) —
      // never ship it to production. 'unsafe-inline' remains because Next.js
      // emits inline bootstrap scripts; moving to a nonce-based CSP is
      // tracked as a follow-up hardening step.
      isDev
        ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
        : "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https:",
      // The browser never talks to Supabase/Moyasar directly (all API calls
      // go through same-origin route handlers; the anonymous Supabase client
      // is unused on the client). No wildcard 'https:' source is shipped.
      `connect-src ${["'self'", "https://api.moyasar.com"].filter(Boolean).join(" ")}`,
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      isDev ? "frame-ancestors 'self' https: http:" : "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "192.168.56.1", "localhost", "*.e2b.app"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
