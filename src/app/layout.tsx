import type { Metadata } from "next";
import { academyName } from "@/lib/branding";
import "@fontsource/cairo/400.css";
import "@fontsource/cairo/600.css";
import "@fontsource/cairo/700.css";
import "./globals.css";
export const metadata: Metadata = {
  title: `${academyName} · متابعة الحلقة`,
  description: "المتابعة اليومية للحلقات القرآنية",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
