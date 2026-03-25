import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Graph query",
  description: "Graph visualization and chat",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
