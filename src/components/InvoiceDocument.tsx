"use client";
import { useEffect, useRef, useState } from "react";
import { totals } from "@/lib/money";

/**
 * The printed Borneo Clean invoice / quotation.
 *
 * This is the document from the standalone invoice system, rendered from the
 * app's own records. It is a fixed A4 sheet: the geometry lives in globals.css
 * in millimetres, and nothing here should be expressed as a Tailwind step,
 * because a printed sheet does not respond to a breakpoint.
 *
 * Both document kinds share the frame and differ where the paper differs: an
 * invoice ends in the bank details a customer pays into, a quotation in the
 * terms it is offered under.
 */

export type DocKind = "INVOICE" | "QUOTATION";

export type DocAddress = {
  line1?: string | null; line2?: string | null; city?: string | null;
  state?: string | null; postcode?: string | null; isPrimary?: boolean;
};

export type DocCustomer = {
  name: string; company?: string | null; email?: string | null; phone?: string | null;
  addresses?: DocAddress[] | null;
};

export type DocItem = { id?: string; name: string; qty: number; priceCents: number };

/** The A4 format is a one-page sheet; past this many lines it cannot fit. */
export const MAX_DOCUMENT_LINES = 8;

/** Blank rows keep the table its full height on a short document. */
const MIN_DOCUMENT_ROWS = 5;

const A4_WIDTH_PX = (210 / 25.4) * 96;

const money = (cents: number) =>
  (Math.abs(cents) / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const signedMoney = (cents: number) => `${cents < 0 ? "-" : ""}RM ${money(cents)}`;

/** 21 September 2026 — written out, as the printed document has always had it. */
export const documentDate = (value?: string | Date | null) => {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
};

/** Free text that the customer reads, so line breaks are kept. */
const Lines = ({ text }: { text: string }) => (
  <>{text.split("\n").map((line, n) => <span key={n}>{n > 0 && <br />}{line}</span>)}</>
);

export function addressLines(customer: DocCustomer): string[] {
  const a = customer.addresses?.find((x) => x.isPrimary) ?? customer.addresses?.[0];
  if (!a) return [];
  return [
    a.line1, a.line2,
    [a.postcode, a.city].filter(Boolean).join(" "),
    a.state,
  ].map((l) => (l ?? "").trim()).filter(Boolean);
}

export default function InvoiceDocument({
  kind, docRef, customer, issuedAt, dueAt, items, discountCents = 0, taxRateBp = 0,
  notes, paymentTerms, business = {}, onOverflowChange,
}: {
  kind: DocKind;
  docRef: string;
  customer: DocCustomer;
  issuedAt: string | Date;
  /** Due date on an invoice, valid-until on a quotation. */
  dueAt?: string | Date | null;
  items: DocItem[];
  discountCents?: number;
  taxRateBp?: number;
  notes?: string | null;
  paymentTerms?: string | null;
  business?: Record<string, string>;
  /** Told when the content no longer fits the sheet, so the page can say so. */
  onOverflowChange?: (overflowing: boolean) => void;
}) {
  const quotation = kind === "QUOTATION";
  const frame = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLElement>(null);
  const [scale, setScale] = useState(1);

  const t = totals(items.map((i) => ({ qty: i.qty, priceCents: i.priceCents })), discountCents, taxRateBp);
  const terms = (paymentTerms ?? "").trim()
    || business[quotation ? "quote.paymentTerms" : "invoice.paymentTerms"]
    || (quotation ? "To be agreed upon acceptance" : "Due immediately upon receipt");
  const businessName = business["business.name"] || "BORNEO CLEAN";
  const logo = business["business.logoUrl"];

  // Blank rows pad a short document out; a long one keeps every line and is
  // reported as overflowing rather than quietly losing a line off the page.
  const rows: (DocItem | null)[] = [...items];
  while (rows.length < MIN_DOCUMENT_ROWS) rows.push(null);

  /* The sheet is a fixed 210mm wide, so it is scaled down to whatever column it
   * is being previewed in. Print resets the zoom and uses the real size. */
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      if (width) setScale(Math.min(1, Math.max(0.2, width / A4_WIDTH_PX)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /**
   * Print this sheet, and only this sheet.
   *
   * The app prints with a 14mm page margin everywhere else, which would shrink
   * an A4 document that already carries its own margins. `@page` cannot be
   * scoped by a selector, so the override is injected while a document is on
   * screen and removed with it, leaving every other page alone.
   */
  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-a4-document", "");
    style.textContent = "@media print { @page { size: A4 portrait; margin: 0; } }";
    document.head.appendChild(style);
    document.documentElement.classList.add("doc-print");
    document.body.classList.add("doc-print");
    return () => {
      style.remove();
      // A second document may still be on screen — the invoice page behind an
      // open modal, say — so the class only comes off with the last of them.
      if (document.querySelector("[data-a4-document]")) return;
      document.documentElement.classList.remove("doc-print");
      document.body.classList.remove("doc-print");
    };
  }, []);

  // The source app refuses to print a sheet whose content is clipped. Here the
  // same measurement is reported upwards, so the page can warn before it prints.
  useEffect(() => {
    const el = paper.current;
    if (!el || !onOverflowChange) return;
    onOverflowChange(el.scrollHeight > el.clientHeight + 1 || items.length > MAX_DOCUMENT_LINES);
  });

  return (
    <div ref={frame} className="invoice-frame" style={{ ["--preview-scale" as any]: String(scale) }}>
      <article ref={paper} className="invoice-paper">
        <header className="invoice-header">
          <div className="invoice-brand-wrap">
            {logo
              ? <div className="invoice-logo">{/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logo} alt="" /></div>
              : <span className="invoice-logo logo-placeholder">{businessName.slice(0, 2).toUpperCase()}</span>}
            <div>
              <p className="invoice-brand-name">{businessName}</p>
              {business["business.tagline"] && <p className="invoice-brand-line">{business["business.tagline"]}</p>}
              {business["business.email"] && <p className="invoice-brand-line">Email: {business["business.email"]}</p>}
              {business["business.phone"] && <p className="invoice-brand-line">Tel: {business["business.phone"]}</p>}
            </div>
          </div>
          <h2 className="invoice-title">{quotation ? "QUOTATION" : "INVOICE"}</h2>
        </header>

        <section className="invoice-party-section">
          <div className="invoice-bill-to">
            <strong>{quotation ? "PREPARED FOR" : "BILL TO"}</strong>
            <strong>{customer.name}</strong>
            {customer.company && <span>{customer.company}</span>}
            {addressLines(customer).map((line, n) => <span key={n}>{line}</span>)}
            {customer.phone && <span>{customer.phone}</span>}
            {customer.email && <span>{customer.email}</span>}
          </div>
          <div className="invoice-meta">
            <div className="meta-row">
              <div className="meta-label">{quotation ? "Quotation No." : "Invoice No."}</div>
              <div className="meta-value">{docRef}</div>
            </div>
            <div className="meta-row">
              <div className="meta-label">{quotation ? "Quotation Date" : "Invoice Date"}</div>
              <div className="meta-value">{documentDate(issuedAt)}</div>
            </div>
            <div className="meta-row">
              <div className="meta-label">{quotation ? "Valid Until" : "Due Date"}</div>
              <div className="meta-value">{documentDate(dueAt)}</div>
            </div>
            <div className="meta-row meta-row-terms">
              <div className="meta-label">Payment Terms</div>
              <div className="meta-value"><Lines text={terms} /></div>
            </div>
          </div>
        </section>

        <table className="invoice-items">
          <colgroup><col /><col /></colgroup>
          <thead><tr><th>Description</th><th>Amount (RM)</th></tr></thead>
          <tbody>
            {rows.map((item, n) => (
              <tr key={item?.id ?? `blank-${n}`}>
                {/* The sheet has no quantity column, so a multiple is written
                    into the description and the amount is the extended one. */}
                <td className="description">{item ? (item.qty > 1 ? `${item.name} × ${item.qty}` : item.name) : ""}</td>
                <td className="amount">{item ? money(item.qty * item.priceCents) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="invoice-totals">
          <div className="invoice-total-row">
            <span>Subtotal</span><span className="invoice-total-amount">{signedMoney(t.subtotal)}</span>
          </div>
          {t.discount > 0 && (
            <div className="invoice-total-row">
              <span>Discount</span><span className="invoice-total-amount">{signedMoney(-t.discount)}</span>
            </div>
          )}
          {t.tax > 0 && (
            <div className="invoice-total-row">
              <span>Tax ({(taxRateBp / 100).toFixed(2)}%)</span>
              <span className="invoice-total-amount">{signedMoney(t.tax)}</span>
            </div>
          )}
          <div className="invoice-total-row">
            <strong>{quotation ? "TOTAL QUOTED" : "TOTAL AMOUNT DUE"}</strong>
            <strong className="invoice-total-amount">{signedMoney(t.total)}</strong>
          </div>
        </div>

        {quotation ? (
          <section className="quotation-terms">
            <strong>QUOTATION TERMS</strong>
            <p>This quotation is valid until {documentDate(dueAt)}. Please confirm your acceptance before we arrange the service.</p>
            <p>Payment terms: <Lines text={terms} /></p>
            <p>Thank you for considering {businessName}.</p>
          </section>
        ) : (
          <section className="invoice-payment">
            <div className="payment-left">
              <div className="payment-line payment-title">PAYMENT DETAILS</div>
              <div className="payment-line">Bank: {business["business.bank"] || "—"}</div>
              <div className="payment-line">Account Name: {business["business.accountName"] || "—"}</div>
              <div className="payment-line">Account Number: {business["business.accountNumber"] || "—"}</div>
              <div className="payment-line">Payment Reference: {docRef}</div>
            </div>
            <div className="payment-right">
              <div className="payment-line payment-first-message"><Lines text={terms} /></div>
              <div className="payment-line payment-first-message">Please use the invoice number as your payment reference.</div>
              <div className="payment-line">Kindly send the payment receipt after the transfer has been completed.</div>
            </div>
          </section>
        )}

        {notes && <div className="invoice-note"><strong>Note:</strong> <Lines text={notes} /></div>}
        {business["invoice.footer"] && !notes && (
          <div className="invoice-note"><Lines text={business["invoice.footer"]} /></div>
        )}
      </article>
    </div>
  );
}
