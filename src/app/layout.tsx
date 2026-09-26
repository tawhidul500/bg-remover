import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { APP_NAME, PARENT_SITE_NAME } from "@/lib/config";

export const metadata: Metadata = {
  title: `${APP_NAME} – Free Background Remover & Image Editor | ${PARENT_SITE_NAME}`,
  description:
    "Remove image backgrounds in your browser, refine the cutout, replace the background, adjust colours, resize, add shadows, compress and export PNG, JPG or WebP.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#2e45a7" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="bg-white text-ink-2 antialiased">{children}</body>
    </html>
  );
}
