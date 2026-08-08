import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Source Search",
  description: "Ask questions about one document with grounded AI answers."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
