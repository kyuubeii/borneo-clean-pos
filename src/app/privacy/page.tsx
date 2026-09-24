import type { Metadata } from "next";
import { db } from "@/lib/db";

/**
 * Public privacy policy.
 *
 * It sits outside the (app) route group on purpose: that group's layout is the
 * only place sign-in is enforced, so anything out here is readable by anyone --
 * which is what the App Store listing and the public booking form need.
 */
export const metadata: Metadata = {
  title: "Privacy Policy — Borneo Clean",
  description: "How Borneo Clean collects, uses and protects personal data.",
};

// Contact details come from Settings, so the page must not be frozen at build time.
export const dynamic = "force-dynamic";
export const preferredRegion = "sin1";

const EFFECTIVE = "24 September 2026";

async function business() {
  const fallback = { name: "Borneo Clean", phone: "", email: "", address: "" };
  try {
    const rows = await db.setting.findMany({
      where: { key: { in: ["business.name", "business.phone", "business.email", "business.address"] } },
    });
    const get = (k: string) => rows.find((r) => r.key === k)?.value?.trim() ?? "";
    return {
      name: get("business.name") || fallback.name,
      phone: get("business.phone"),
      email: get("business.email"),
      address: get("business.address"),
    };
  } catch {
    // The policy has to stay readable even when the database is not.
    return fallback;
  }
}

export default async function Privacy() {
  const b = await business();

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-2.5 px-4 py-3.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 21h18M6 21V10l6-7 6 7v11M10 21v-5h4v5"/></svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-ink-900">{b.name}</p>
            <p className="text-[11px] text-ink-400">Privacy Policy</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 p-4 pb-10 text-sm leading-relaxed text-ink-700">
        <div className="card card-pad">
          <h1 className="text-lg font-semibold text-ink-900">Privacy Policy</h1>
          <p className="mt-1 text-xs text-ink-400">Effective {EFFECTIVE}</p>
          <p className="mt-3">
            {b.name} (&ldquo;we&rdquo;, &ldquo;us&rdquo;) runs a cleaning business in Sarawak, Malaysia. This policy
            explains what personal data we collect through our online booking page, our website and the {b.name} iPhone
            app, why we collect it, who we share it with, and the choices you have. We handle personal data in line with
            Malaysia&rsquo;s Personal Data Protection Act 2010.
          </p>
        </div>

        <Section title="What we collect">
          <p className="font-medium text-ink-900">If you book a clean</p>
          <p>
            Through the booking form, or when you book with us by phone or message: your name, phone number, email address
            (optional), service address and city, your preferred date and time, and anything you tell us about the job.
            If you become a customer we also keep records of your bookings, jobs, quotes, invoices and payments, any access
            notes for your property, and before-and-after photos our team takes of the work.
          </p>
          <p className="mt-3 font-medium text-ink-900">If you work with us</p>
          <p>
            Staff and account holders: your name, email address, phone number, role, pay type and rate, availability,
            time records, payouts, expenses and receipt photos, your sign-in details and your language preference.
          </p>
          <p className="mt-3 font-medium text-ink-900">In the iPhone app</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <span className="font-medium text-ink-800">Camera and photo library</span> &mdash; used only when you choose
              to take or attach a job photo or an expense receipt. We do not access your photos otherwise.
            </li>
            <li>
              <span className="font-medium text-ink-800">Notifications</span> &mdash; if you allow them, we store your
              device&rsquo;s push token and the notification types you chose, so we can send those alerts to that device.
            </li>
          </ul>
        </Section>

        <Section title="How we use it">
          <ul className="list-disc space-y-1 pl-5">
            <li>To confirm, schedule and carry out cleaning jobs, and to contact you about them.</li>
            <li>To prepare quotes and invoices and to keep track of payments.</li>
            <li>To run our team: rosters, pay, expenses and job records.</li>
            <li>To keep accounting and business records we are required to keep.</li>
            <li>To answer questions staff ask the built-in assistant (see below).</li>
          </ul>
          <p className="mt-3">
            We do not sell personal data, we do not use it for advertising, and we do not use third-party analytics or
            tracking.
          </p>
        </Section>

        <Section title="The assistant">
          <p>
            Our staff can use an AI assistant inside the app to look up and update business records. When they do, their
            question and the records needed to answer it are sent to OpenRouter, which passes them to the AI model provider
            that produces the answer. Assistant conversations are saved in our system so staff can return to them.
          </p>
        </Section>

        <Section title="Who we share it with">
          <p>We share personal data only with the service providers that run our systems, and only as needed to run them:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li><span className="font-medium text-ink-800">Supabase</span> &mdash; database, sign-in and photo storage.</li>
            <li><span className="font-medium text-ink-800">Vercel</span> &mdash; hosts the website and app server.</li>
            <li><span className="font-medium text-ink-800">OpenRouter</span> and the AI model provider it routes to &mdash; the assistant.</li>
            <li><span className="font-medium text-ink-800">Apple</span> &mdash; delivers push notifications to iPhones.</li>
          </ul>
          <p className="mt-3">
            Our database and servers are in Singapore. Some providers may process data in other countries. We may also
            disclose data where the law requires it.
          </p>
        </Section>

        <Section title="How long we keep it">
          <p>
            We keep personal data for as long as we need it to provide our services and to meet our accounting and legal
            record-keeping obligations. After that it is deleted or anonymised.
          </p>
        </Section>

        <Section title="Your choices">
          <ul className="list-disc space-y-1 pl-5">
            <li>You can ask for a copy of the personal data we hold about you, and ask us to correct it.</li>
            <li>You can withdraw your consent or ask us to delete your data, except where we must keep records by law.</li>
            <li>You can turn off camera, photo and notification access at any time in your iPhone&rsquo;s Settings.</li>
          </ul>
          <p className="mt-3">To make a request, contact us using the details below.</p>
        </Section>

        <Section title="Contact us">
          <p className="font-medium text-ink-900">{b.name}</p>
          {b.address && <p className="whitespace-pre-line">{b.address}</p>}
          {b.phone && <p>Phone: <a className="text-brand-700 underline" href={`tel:${b.phone.replace(/\s+/g, "")}`}>{b.phone}</a></p>}
          {b.email && <p>Email: <a className="text-brand-700 underline" href={`mailto:${b.email}`}>{b.email}</a></p>}
        </Section>

        <Section title="Changes to this policy">
          <p>
            If we change this policy we will update it on this page and change the effective date above.
          </p>
        </Section>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card card-pad">
      <h2 className="mb-2 text-sm font-semibold text-ink-900">{title}</h2>
      {children}
    </section>
  );
}
