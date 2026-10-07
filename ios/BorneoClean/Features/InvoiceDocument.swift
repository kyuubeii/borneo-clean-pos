import SwiftUI
import WebKit

/**
 InvoiceDocument.tsx: the printed Borneo Clean invoice / quotation.

 The same markup and the same millimetre CSS as the web, rendered in a web
 view, so the sheet a phone prints or shares as a PDF is the sheet the browser
 prints. Totals come from money.ts `totals`, as on the web.
 */
enum InvoiceDocument {
    enum Kind { case invoice, quotation }

    /// The A4 format is a one-page sheet; past this many lines it cannot fit.
    static let maxLines = 8
    /// Blank rows keep the table its full height on a short document.
    static let minRows = 5

    private static func esc(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
    }
    /// Free text that the customer reads, so line breaks are kept.
    private static func lines(_ s: String) -> String { s.split(separator: "\n", omittingEmptySubsequences: false).map { esc(String($0)) }.joined(separator: "<br>") }
    private static func money(_ cents: Int) -> String { Fmt.plain(cents) }
    private static func signed(_ cents: Int) -> String { "\(cents < 0 ? "-" : "")RM \(Fmt.plain(cents))" }

    static func addressLines(_ customer: JSON) -> [String] {
        let list = customer["addresses"].array
        guard let a = list.first(where: { $0["isPrimary"].truthy }) ?? list.first else { return [] }
        return [a["line1"].str, a["line2"].str,
                [a["postcode"].str, a["city"].str].filter { !$0.isEmpty }.joined(separator: " "),
                a["state"].str].map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    static func html(kind: Kind, ref: String, customer: JSON, issuedAt: Date?, dueAt: Date?, items: [JSON],
                     discountCents: Int, taxRateBp: Int, notes: String?, business: [String: JSON], paidCents: Int = 0) -> String {
        let quotation = kind == .quotation
        let b = { (k: String) -> String in business[k]?.str ?? "" }
        let tt = Fmt.totals(items.map { ($0["qty"].i, $0["priceCents"].i) }, discountCents: discountCents, taxRateBp: taxRateBp)
        let terms = !b(quotation ? "quote.paymentTerms" : "invoice.paymentTerms").isEmpty ? b(quotation ? "quote.paymentTerms" : "invoice.paymentTerms")
            : (quotation ? "To be agreed upon acceptance" : "Due immediately upon receipt")
        let businessName = b("business.name").isEmpty ? "BORNEO CLEAN" : b("business.name")
        let logo = b("business.logoUrl")

        var rows: [JSON?] = items
        while rows.count < minRows { rows.append(nil) }

        var h = "<article class=\"invoice-paper\">"
        h += "<header class=\"invoice-header\"><div class=\"invoice-brand-wrap\">"
        h += logo.isEmpty ? "<span class=\"invoice-logo logo-placeholder\">\(esc(String(businessName.prefix(2)).uppercased()))</span>"
                          : "<div class=\"invoice-logo\"><img src=\"\(esc(logo))\" alt=\"\"></div>"
        h += "<div><p class=\"invoice-brand-name\">\(esc(businessName))</p>"
        if !b("business.tagline").isEmpty { h += "<p class=\"invoice-brand-line\">\(esc(b("business.tagline")))</p>" }
        if !b("business.email").isEmpty { h += "<p class=\"invoice-brand-line\">Email: \(esc(b("business.email")))</p>" }
        if !b("business.phone").isEmpty { h += "<p class=\"invoice-brand-line\">Tel: \(esc(b("business.phone")))</p>" }
        h += "</div></div><h2 class=\"invoice-title\">\(quotation ? "QUOTATION" : "INVOICE")</h2></header>"

        h += "<section class=\"invoice-party-section\"><div class=\"invoice-bill-to\">"
        h += "<strong>\(quotation ? "PREPARED FOR" : "BILL TO")</strong><strong>\(esc(customer["name"].str))</strong>"
        if let c = customer["company"].nonEmpty { h += "<span>\(esc(c))</span>" }
        for l in addressLines(customer) { h += "<span>\(esc(l))</span>" }
        if let p = customer["phone"].nonEmpty { h += "<span>\(esc(p))</span>" }
        if let e = customer["email"].nonEmpty { h += "<span>\(esc(e))</span>" }
        h += "</div><div class=\"invoice-meta\">"
        func meta(_ label: String, _ value: String, terms: Bool = false) -> String {
            "<div class=\"meta-row\(terms ? " meta-row-terms" : "")\"><div class=\"meta-label\">\(label)</div><div class=\"meta-value\">\(value)</div></div>"
        }
        h += meta(quotation ? "Quotation No." : "Invoice No.", esc(ref))
        h += meta(quotation ? "Quotation Date" : "Invoice Date", Fmt.documentDate(issuedAt))
        h += meta(quotation ? "Valid Until" : "Due Date", Fmt.documentDate(dueAt))
        h += meta("Payment Terms", lines(terms), terms: true)
        h += "</div></section>"

        h += "<table class=\"invoice-items\"><colgroup><col><col></colgroup><thead><tr><th>Description</th><th>Amount (RM)</th></tr></thead><tbody>"
        for item in rows {
            if let i = item {
                // The sheet has no quantity column: a multiple goes into the
                // description and the amount is the extended one.
                let name = i["qty"].i > 1 ? "\(i["name"].str) × \(i["qty"].i)" : i["name"].str
                h += "<tr><td class=\"description\">\(esc(name))</td><td class=\"amount\">\(money(i["qty"].i * i["priceCents"].i))</td></tr>"
            } else { h += "<tr><td class=\"description\"></td><td class=\"amount\"></td></tr>" }
        }
        h += "</tbody></table>"

        h += "<div class=\"invoice-totals\">"
        h += "<div class=\"invoice-total-row\"><span>Subtotal</span><span class=\"invoice-total-amount\">\(signed(tt.subtotal))</span></div>"
        if tt.discount > 0 { h += "<div class=\"invoice-total-row\"><span>Discount</span><span class=\"invoice-total-amount\">\(signed(-tt.discount))</span></div>" }
        if tt.tax > 0 { h += "<div class=\"invoice-total-row\"><span>Tax (\(String(format: "%.2f", Double(taxRateBp) / 100))%)</span><span class=\"invoice-total-amount\">\(signed(tt.tax))</span></div>" }
        if !quotation && paidCents > 0 {
            // An invoice with money already in asks only for the balance.
            let left = max(0, tt.total - paidCents)
            if tt.total != tt.subtotal { h += "<div class=\"invoice-total-row\"><span>Total</span><span class=\"invoice-total-amount\">\(signed(tt.total))</span></div>" }
            h += "<div class=\"invoice-total-row\"><span>Paid</span><span class=\"invoice-total-amount\">\(signed(-paidCents))</span></div>"
            h += "<div class=\"invoice-total-row\"><strong>\(left == 0 ? "PAID IN FULL" : "BALANCE DUE")</strong><strong class=\"invoice-total-amount\">\(signed(left))</strong></div></div>"
        } else {
            h += "<div class=\"invoice-total-row\"><strong>\(quotation ? "TOTAL QUOTED" : "TOTAL AMOUNT DUE")</strong><strong class=\"invoice-total-amount\">\(signed(tt.total))</strong></div></div>"
        }

        if quotation {
            h += "<section class=\"quotation-terms\"><strong>QUOTATION TERMS</strong>"
            h += "<p>This quotation is valid until \(Fmt.documentDate(dueAt)). Please confirm your acceptance before we arrange the service.</p>"
            h += "<p>Payment terms: \(lines(terms))</p><p>Thank you for considering \(esc(businessName)).</p></section>"
        } else {
            let dash = { (k: String) in b(k).isEmpty ? "—" : esc(b(k)) }
            h += "<section class=\"invoice-payment\"><div class=\"payment-left\">"
            h += "<div class=\"payment-line payment-title\">PAYMENT DETAILS</div>"
            h += "<div class=\"payment-line\">Bank: \(dash("business.bank"))</div>"
            h += "<div class=\"payment-line\">Account Name: \(dash("business.accountName"))</div>"
            h += "<div class=\"payment-line\">Account Number: \(dash("business.accountNumber"))</div>"
            h += "<div class=\"payment-line\">Payment Reference: \(esc(ref))</div></div><div class=\"payment-right\">"
            h += "<div class=\"payment-line payment-first-message\">\(lines(terms))</div>"
            h += "<div class=\"payment-line payment-first-message\">Please use the invoice number as your payment reference.</div>"
            h += "<div class=\"payment-line\">Kindly send the payment receipt after the transfer has been completed.</div></div></section>"
        }

        if let n = notes, !n.isEmpty { h += "<div class=\"invoice-note\"><strong>Note:</strong> \(lines(n))</div>" }
        else if !b("invoice.footer").isEmpty { h += "<div class=\"invoice-note\">\(lines(b("invoice.footer")))</div>" }
        h += "</article>"

        return """
        <!doctype html><html><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5">
        <style>
        /* The sheet is laid out at its real 210mm and the whole page is scaled to
           the phone by the viewport, so nothing inside it reflows; text inflation
           is off, or WebKit enlarges the small type and the rows collide. */
        html, body { margin: 0; padding: 0; background: #eceef2; -webkit-text-size-adjust: none; text-size-adjust: none; }
        * { -webkit-text-size-adjust: none; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        /* The parts of Tailwind's preflight the web sheet sits on. Without the
           border-box rule the 15mm padding is added to the 210mm width. */
        *, ::before, ::after { box-sizing: border-box; border-width: 0; border-style: solid; }
        h1, h2, h3, h4, p, figure, blockquote, dl, dd { margin: 0; }
        h1, h2, h3, h4 { font-size: inherit; font-weight: inherit; }
        img { display: block; max-width: 100%; height: auto; }
        table { text-indent: 0; border-color: inherit; border-collapse: collapse; }
        strong, b { font-weight: bolder; }
        .invoice-frame { padding: 20px 0; width: 834px; transform-origin: 0 0; }
        html, body { overflow-x: hidden; }
        \(InvoiceCSS.sheet)
        @page { size: A4 portrait; margin: 0; }
        @media print {
          html, body { background: #fff; }
          html, body { height: auto !important; }
          .invoice-frame { padding: 0; width: auto; transform: none !important; }
          .invoice-paper { zoom: 1 !important; box-shadow: none !important; margin: 0; }
          .invoice-logo.logo-placeholder { display: none; }
        }
        </style></head><body>
        <div class="invoice-frame">\(h)</div>
        <script>
        // Fit the 834px frame (the sheet plus a margin) to the phone. Print ignores
        // this and lays the sheet out at its real size.
        (function(){
          // A transform, not zoom: WebKit's zoom scales the boxes but not the
          // point-sized type, which is what made the rows collide.
          function fit(){ var f = document.querySelector('.invoice-frame');
            var s = Math.min(1, document.documentElement.clientWidth / 834);
            f.style.transform = 'scale(' + s + ')';
            document.body.style.height = Math.ceil(f.offsetHeight * s) + 'px'; }
          fit(); window.addEventListener('resize', fit);
        })();
        function overflowing(){ var p = document.querySelector('.invoice-paper'); return p.scrollHeight > p.clientHeight + 1; }
        </script>
        </body></html>
        """
    }
}

/// Holds the web view so the toolbar can print or export what is on screen.
@MainActor
final class DocumentController: NSObject, ObservableObject, WKNavigationDelegate {
    let webView: WKWebView = {
        let w = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 600))
        w.isOpaque = false
        w.backgroundColor = .clear
        return w
    }()
    @Published var loaded = false
    @Published var overflowing = false
    private var lastHTML = ""

    override init() { super.init(); webView.navigationDelegate = self }

    func load(_ html: String) {
        guard html != lastHTML else { return }
        lastHTML = html
        loaded = false
        webView.loadHTMLString(html, baseURL: API.shared.baseURL)
    }

    nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Task { @MainActor in
            self.loaded = true
            self.overflowing = ((try? await webView.evaluateJavaScript("overflowing()")) as? Bool) ?? false
        }
    }

    private func renderer() -> UIPrintPageRenderer {
        let r = UIPrintPageRenderer()
        r.addPrintFormatter(webView.viewPrintFormatter(), startingAtPageAt: 0)
        let a4 = CGRect(x: 0, y: 0, width: 595.2, height: 841.8)
        r.setValue(NSValue(cgRect: a4), forKey: "paperRect")
        r.setValue(NSValue(cgRect: a4), forKey: "printableRect")
        return r
    }

    /// The sheet as a one-page A4 PDF, for sharing.
    func pdf(named name: String) -> URL? {
        let r = renderer()
        let data = NSMutableData()
        UIGraphicsBeginPDFContextToData(data, CGRect(x: 0, y: 0, width: 595.2, height: 841.8), nil)
        r.prepare(forDrawingPages: NSRange(location: 0, length: r.numberOfPages))
        // One sheet: the document is designed to fit a single page.
        UIGraphicsBeginPDFPage()
        r.drawPage(at: 0, in: UIGraphicsGetPDFContextBounds())
        UIGraphicsEndPDFContext()
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(name).pdf")
        do { try data.write(to: url); return url } catch { return nil }
    }

    func print(jobName: String) {
        let c = UIPrintInteractionController.shared
        let info = UIPrintInfo(dictionary: nil)
        info.outputType = .general
        info.jobName = jobName
        c.printInfo = info
        c.printFormatter = webView.viewPrintFormatter()
        c.present(animated: true)
    }
}

struct DocumentWebView: UIViewRepresentable {
    let controller: DocumentController
    func makeUIView(context: Context) -> WKWebView { controller.webView }
    func updateUIView(_ v: WKWebView, context: Context) {}
}

/// The sheet on screen with Print and Share as PDF -- the web's preview and Print button.
struct DocumentPreview: View {
    let title: String
    let html: String
    @StateObject private var doc = DocumentController()
    @State private var shareURL: URL?

    var body: some View {
        VStack(spacing: 0) {
            if doc.overflowing {
                Callout(text: "This document no longer fits the one-page A4 format (up to \(InvoiceDocument.maxLines) lines fit). Printing it will cut off the bottom of the sheet — shorten the descriptions, or split it across two.")
                    .padding(10)
            }
            DocumentWebView(controller: doc)
                .overlay { if !doc.loaded { ProgressView() } }
        }
        .background(Color(hex: 0xECEEF2))
        .onAppear { doc.load(html) }
        .onChange(of: html) { _, h in doc.load(h) }
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button { doc.print(jobName: title) } label: { Image(systemName: "printer") }
                    .accessibilityLabel(t("common.print")).disabled(!doc.loaded)
                Button { shareURL = doc.pdf(named: title) } label: { Image(systemName: "square.and.arrow.up") }
                    .accessibilityLabel("Share PDF").disabled(!doc.loaded)
            }
        }
        .sheet(item: Binding(get: { shareURL.map { ShareItem(url: $0) } }, set: { shareURL = $0?.url })) { s in
            ShareSheet(items: [s.url])
        }
    }
}

struct ShareItem: Identifiable { let url: URL; var id: String { url.absoluteString } }

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: items, applicationActivities: nil) }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
