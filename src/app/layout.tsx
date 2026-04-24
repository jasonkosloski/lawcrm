/**
 * Root Layout
 *
 * Configures the three font families used across the application:
 * - Inter: All UI chrome (nav, buttons, labels, body text)
 * - JetBrains Mono: Timestamps, metadata, code, monospace elements
 * - Fraunces: Display headings and email body text (personality font)
 *
 * Wraps the app in the Providers component for TanStack Query and tooltips.
 */

import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Fraunces } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Kosloski Law CRM",
  description:
    "Practice management, case tracking, and client communication for Kosloski Law.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
