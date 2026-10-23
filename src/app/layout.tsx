import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Space_Grotesk } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", display: "swap" });
const grotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-grotesk", display: "swap", weight: ["500", "600", "700"] });

export const metadata: Metadata = {
  title: { default: "RankPilot", template: "%s · RankPilot" },
  description: "Every client. Every location. Every search signal.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${grotesk.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
