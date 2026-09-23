import Foundation

// Generated from the A4 document rules in src/app/globals.css -- copied verbatim
// so the phone prints the same sheet, to the millimetre, as the web.
enum InvoiceCSS {
    static let sheet = #"""
.invoice-paper {
  width: 210mm; min-height: 297mm; height: 297mm; margin: 0 auto; overflow: hidden;
  padding: 12.7mm 15mm 0; color: #000; background: #fff;
  box-shadow: 0 12px 26px rgba(16, 32, 51, .16);
  font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; line-height: 1;
  /* The frame scales the whole sheet down to fit its column; print resets it. */
  zoom: var(--preview-scale, 1);
}
.invoice-paper * { box-sizing: border-box; }

.invoice-header { display: grid; grid-template-columns: 1fr auto; align-items: start; height: 23.25mm; }
.invoice-brand-wrap { display: flex; align-items: flex-start; gap: 4mm; min-width: 0; }
.invoice-brand-wrap > div { min-width: 0; }
.invoice-logo {
  width: 18mm; height: 18mm; flex: 0 0 18mm; display: grid; place-items: center; overflow: hidden;
  border: 1px dashed #aeb8bf; border-radius: 2mm; color: #6d7d87; background: #f5f7f8;
  font-size: 7pt; font-weight: 700; text-align: center;
}
.invoice-logo img { width: 100%; height: 100%; object-fit: contain; }
.invoice-logo:not(.logo-placeholder) { border: 0; border-radius: 0; background: transparent; }
.logo-placeholder { padding: 0; }
.invoice-brand-name { margin: 0 0 4.6pt; font-size: 9.5pt; font-weight: 700; }
.invoice-brand-line { margin: 0 0 4.6pt; font-size: 9.5pt; }
.invoice-brand-name, .invoice-brand-line { overflow-wrap: anywhere; }
.invoice-title { margin: 0; font-size: 25pt; font-weight: 700; line-height: 1; text-align: right; }

.invoice-party-section { display: grid; grid-template-columns: 92.8mm minmax(0, 1fr); height: 39.86mm; }
.invoice-bill-to { padding-top: .35mm; }
.invoice-bill-to strong, .invoice-bill-to span {
  display: block; margin: 0 0 4.586pt; font-size: 9.5pt; line-height: 1; overflow-wrap: anywhere;
}
.invoice-bill-to strong { font-weight: 700; }
.invoice-meta { display: grid; grid-template-rows: 8.82mm 8.82mm 8.82mm 1fr; border: .25mm solid #808080; }
.meta-row { display: grid; grid-template-columns: 40mm 1fr; min-height: 0; border-bottom: .25mm solid #808080; }
.meta-row:last-child { border-bottom: 0; }
.meta-label, .meta-value {
  display: flex; align-items: center; min-width: 0; padding: 0 2.2mm; font-size: 9.5pt; line-height: 1.35;
}
.meta-label { border-right: .25mm solid #808080; font-weight: 700; }
.meta-value { overflow: hidden; white-space: normal; overflow-wrap: anywhere; }
.meta-row-terms .meta-value { align-items: flex-start; padding-top: 2mm; }

.invoice-items { width: 100%; margin-top: 9mm; border-collapse: collapse; table-layout: fixed; }
.invoice-items col:first-child { width: auto; }
.invoice-items col:last-child { width: 35mm; }
.invoice-items th, .invoice-items td {
  height: 9.525mm; border: .25mm solid #808080; padding: 0 2.1mm;
  font-size: 9.5pt; line-height: 1.3; text-align: left; vertical-align: middle; overflow-wrap: anywhere;
}
.invoice-items th { background: #e9e9e9; font-weight: 700; }
.invoice-items td.description { font-weight: 700; }
.invoice-items td.amount { font-weight: 400; }

.invoice-totals { width: 90mm; margin: 9.9mm 0 0 auto; }
.invoice-total-row {
  display: flex; align-items: center; justify-content: space-between; height: 9.525mm;
  border-top: .25mm solid #808080; padding: 0 2.1mm; font-size: 9.5pt;
}
.invoice-total-row:last-child { border-bottom: .25mm solid #808080; }
.invoice-total-row strong { font-weight: 700; }
.invoice-total-amount { min-width: 31mm; text-align: left; }

.invoice-payment {
  display: grid; grid-template-columns: 86.9mm minmax(0, 1fr); height: auto; min-height: 28.58mm;
  margin-top: 6.98mm; border: .25mm solid #808080;
}
.payment-left, .payment-right { min-width: 0; padding: 2.4mm 2.1mm; }
.payment-left { border-right: .25mm solid #808080; }
.payment-line {
  height: auto; min-height: 4.586mm; font-size: 9.5pt; line-height: 1.35;
  white-space: normal; overflow-wrap: anywhere;
}
.payment-title, .payment-first-message { font-weight: 700; }

.quotation-terms { margin-top: 7mm; padding: 4mm; border: .25mm solid #808080; font-size: 9.5pt; line-height: 1.45; }
.quotation-terms p { margin: 2mm 0 0; }
.invoice-note { margin-top: 3mm; font-size: 8.5pt; line-height: 1.3; overflow-wrap: anywhere; }
"""#
}
