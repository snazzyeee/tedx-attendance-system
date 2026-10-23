import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "TEDxDYPDPU Attendance",
    template: "%s · TEDxDYPDPU",
  },
  description: "Attendance management for the TEDxDYPDPU organising committee.",
  // A TE who adds this to their home screen gets an app, not a browser tab.
  appleWebApp: { capable: true, title: "TEDx Attendance", statusBarStyle: "black-translucent" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Paints the phone's browser chrome to match the page instead of leaving a
  // white band above a near-black app.
  themeColor: "#0a0a0b",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
