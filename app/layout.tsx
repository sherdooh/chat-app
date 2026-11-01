import type { Metadata, Viewport } from "next";
import { DM_Sans, Fraunces } from "next/font/google";
import "./globals.css";

// Self-hosted by Next at build time: no render-blocking @import, no flash of unstyled text.
const body = DM_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});
// A soft, friendly serif for names, headings and the logo: the "close." personality.
const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "close 💌 just us",
  description: "Our little corner of the internet. Just the two of us.",
  applicationName: "close",
  robots: { index: false, follow: false }, // it's private, keep it out of search engines
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "close",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content", // keeps the message box above the mobile keyboard
  themeColor: "#fbf3ea",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
