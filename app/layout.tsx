import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CoverCraft: AI Cover Letter Generator",
  applicationName: "CoverCraft",
  description:
    "Paste your resume and a job description to generate a tailored, editable cover letter with Claude. Export to Word, PDF, or plain text.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f4f5f7",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
