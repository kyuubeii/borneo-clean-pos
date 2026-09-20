import "./globals.css";
import type { Metadata, Viewport } from "next";
import { I18nProvider } from "@/components/I18nProvider";
import { Toaster } from "@/components/ui";

/**
 * Run next to the database.
 *
 * The database lives in ap-southeast-1. Vercel's project default is iad1, which
 * put every query on a round trip across the Pacific; vercel.json pins the same
 * region, and this keeps it pinned even if that project setting is changed.
 */
export const preferredRegion = "sin1";

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
