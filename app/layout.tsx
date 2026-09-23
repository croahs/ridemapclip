import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "RideMapClip — Animate Your Rides",
  description: "Upload your FIT recordings, explore every route together, and create a 30-second animated map clip.",
  openGraph: {
    title: "RideMapClip — Animate Your Rides",
    description: "Explore your rides together and turn your FIT recordings into a 30-second animated map clip.",
    siteName: "RideMapClip",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "RideMapClip — Animate Your Rides",
    description: "Turn your FIT recordings into a 30-second animated map clip.",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
