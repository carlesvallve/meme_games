import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Three.js Game",
  description: "A Three.js game built with Next.js",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="w-screen h-screen">{children}</body>
    </html>
  );
}
