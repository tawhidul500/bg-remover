import type { NextConfig } from "next";

// Optional: restrict which sites may embed the app in an iframe (space-separated origins),
// e.g. ALLOWED_FRAME_ANCESTORS="https://www.clippingworld.com https://clippingworld.com".
// When unset, framing is allowed so the app works in preview environments and any WordPress host.
const frameAncestors = (process.env.ALLOWED_FRAME_ANCESTORS || "").trim();

const nextConfig: NextConfig = {
  async headers() {
    const base = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];
    if (frameAncestors) {
      base.push({ key: "Content-Security-Policy", value: `frame-ancestors 'self' ${frameAncestors}` });
    }
    return [{ source: "/:path*", headers: base }];
  },
};

export default nextConfig;
