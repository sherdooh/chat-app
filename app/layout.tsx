import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Close | Just the two of you",
  description: "A quieter corner of the internet, just for your conversations.",
  applicationName: "Close",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Close",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f5f3ed",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
