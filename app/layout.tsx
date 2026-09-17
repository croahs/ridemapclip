import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
