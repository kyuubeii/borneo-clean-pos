import "./globals.css";
import type { Metadata, Viewport } from "next";
import { I18nProvider } from "@/components/I18nProvider";
import { Toaster } from "@/components/ui";

export const metadata: Metadata = {
  title: "Borneo Clean — Cleaning Operations",
  description: "Bookings, scheduling, jobs, invoicing and reporting for cleaning businesses.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <I18nProvider>
          {children}
          <Toaster />
        </I18nProvider>
      </body>
    </html>
  );
}
