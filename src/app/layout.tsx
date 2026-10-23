import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "RankPilot", template: "%s · RankPilot" },
  description: "Every client. Every location. Every search signal.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
