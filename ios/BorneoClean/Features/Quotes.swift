import SwiftUI

// MARK: - Quotes (quotes/page.tsx)

struct QuotesView: View {
    @State private var app = AppState.shared
    @State private var data: [JSON]?
    @State private var biz: JSON = [:]
    @State private var error: String?
    @State private var creating = false
    @State private var editing: JSON?
    @State private var convert: JSON?
    @State private var bill: JSON?
    @State private var preview: JSON?
    @State private var deleting: JSON?

    var body: some View {
        let manage = app.user?.can(ADMIN_UP) == true
        List {
            LoadErrorView(error: error) { Task { await load() } }
            if data == nil && error == nil { LoadingRow() }
            else if data?.isEmpty == true { EmptyState(text: t("common.empty")) }
            ForEach((data ?? []).rows()) { q in
                let locked = q["convertedBookingId"].exists || q["convertedInvoiceId"].exists
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(q["ref"].str).font(.subheadline.weight(.semibold))
                        Spacer()
                        StatusBadge(status: q["status"].str)
                    }
                    Text(q["customer"].str).font(.body.weight(.medium))
                    HStack {
                        Text("\(t("inv.issued")) \(q["issuedAt"].date.map(Fmt.date) ?? "") · valid until \(q["validUntil"].date.map(Fmt.date) ?? "—")")
                            .font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        MoneyText(cents: q["total"].i).font(.subheadline.weight(.semibold))
                    }
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            if !locked && q["status"].str == "DRAFT" { Button("Mark sent") { Task { await setStatus(q.json, "SENT") } } }
                            if !locked && q["status"].str == "SENT" {
                                Button("Accept") { Task { await setStatus(q.json, "ACCEPTED") } }.tint(Brand.good)
                                Button("Decline") { Task { await setStatus(q.json, "DECLINED") } }.tint(.red)
                            }
                            if !locked && q["status"].str == "ACCEPTED" {
                                Button("Book it") { convert = q.json }
                                Button("Invoice it") { bill = q.json }
                            }
                            if let b = q["convertedBookingId"].nonEmpty { Button("View booking") { Router.shared.push(.booking(b)) } }
                            if let i = q["convertedInvoiceId"].nonEmpty { Button("View invoice") { Router.shared.push(.invoice(i)) } }
                            Button("Preview") { Task { await openPreview(q.id) } }
                            if manage && !locked {
                                Button(t("common.edit")) { Task { await openEdit(q.id) } }
                                Button(role: .destructive) { deleting = q.json } label: { Image(systemName: "trash") }
                            }
                        }
                        .buttonStyle(.bordered).controlSize(.small)
                    }
                }
                .padding(.vertical, 4)
            }
        }
        .navigationTitle(t("nav.quotes"))
        .toolbar { ToolbarItem(placement: .primaryAction) { Button { creating = true } label: { Image(systemName: "plus") }.accessibilityLabel(t("common.new")) } }
        .loads(load)
        .sheet(isPresented: $creating) { QuoteFormView(initial: nil) { await load() } }
        .sheet(item: rowBinding($editing)) { r in QuoteFormView(initial: r.json) { await load() } }
        .sheet(item: rowBinding($convert)) { r in ConvertQuoteSheet(quote: r.json) { await load() } }
        .sheet(item: rowBinding($bill)) { r in BillQuoteSheet(quote: r.json, defaultDueDays: biz["invoice.dueDays"].string) { await load() } }
        .sheet(item: rowBinding($preview)) { r in
            NavigationStack {
                DocumentPreview(title: r["ref"].str, html: InvoiceDocument.html(
                    kind: .quotation, ref: r["ref"].str, customer: r["customer"], issuedAt: r["issuedAt"].date, dueAt: r["validUntil"].date,
                    items: r["items"].array, discountCents: r["discountCents"].i, taxRateBp: r["taxRateBp"].i, notes: r["notes"].string, business: biz.object))
                .navigationTitle(r["ref"].str)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button(t("common.close")) { preview = nil } } }
            }
        }
        .sheet(item: rowBinding($deleting)) { r in
            ConfirmDeleteSheet(title: "Delete quote permanently", action: "quotes.delete", input: ["quoteId": .string(r.id)],
                               confirmText: r["ref"].str, confirmLabel: "the quote reference",
                               message: "Quote \(r["ref"].str) for \(r["customer"].str) and all its line items are removed for good. This cannot be undone.\n\nA quote that has already been turned into a booking cannot be deleted — cancel the booking instead.",
                               onDone: { Task { await load() } })
        }
    }

    private func load() async {
        let r = await API.shared.batch([("quotes.list", ["limit": 100]), ("settings.get", [:])])
        switch r[0] { case .success(let v): data = v.array; error = nil; case .failure(let e): error = e.localizedDescription }
        if case .success(let v) = r[1] { biz = v }
    }

    private func setStatus(_ q: JSON, _ status: String) async {
        do { try await API.shared.call("quotes.updateStatus", ["quoteId": .string(q.id), "status": .string(status)]); toast("Quote updated"); await load() }
        catch { toast(humanError(error.localizedDescription), error: true) }
    }

    /// quotes.list is a summary; editing and previewing need the line items.
    private func openEdit(_ id: String) async {
        do { editing = try await API.shared.call("quotes.get", ["quoteId": .string(id)]) }
        catch { toast(humanError(error.localizedDescription), error: true) }
    }
    private func openPreview(_ id: String) async {
        do { preview = try await API.shared.call("quotes.get", ["quoteId": .string(id)]) }
        catch { toast(error.localizedDescription, error: true) }
    }
}

func rowBinding(_ b: Binding<JSON?>) -> Binding<Row?> {
    Binding(get: { b.wrappedValue.map { Row($0) } }, set: { b.wrappedValue = $0?.json })
}

/// Create when `initial` is nil, edit when it is there.
struct QuoteFormView: View {
    let initial: JSON?
    let onDone: () async -> Void
    @Environment(\.dismiss) private var dismiss

    struct Line: Identifiable { let id = UUID(); var name = ""; var qty = 1; var price = ""; var serviceId: String? }

    @State private var services: [JSON] = []
    @State private var customerId = ""
    @State private var items: [Line] = [Line()]
    @State private var discount = ""
    @State private var tax = "0"
    @State private var notes = ""
    @State private var busy = false

    /// QuoteForm's live total: subtotal, less discount, plus tax from the % box.
    private var total: Int {
        let subtotal = items.reduce(0) { $0 + $1.qty * Fmt.toCents($1.price) }
        let afterDisc = max(0, subtotal - Fmt.toCents(discount))
        let rate = Fmt.jsParseFloat(tax.isEmpty ? "0" : tax) * 100
        return afterDisc + Int(Fmt.jsRound(Double(afterDisc) * rate / 10000))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(t("common.customer")) { CustomerPicker(customerId: $customerId, disabled: initial != nil) }
                Section {
                    ForEach($items) { $it in
                        VStack(spacing: 8) {
                            HStack {
                                Menu {
                                    Button("Custom…") { it.serviceId = nil }
                                    ForEach(services.rows()) { s in
                                        Button(s["name"].str) { it.name = s["name"].str; it.price = Fmt.fixed2(s["priceCents"].i); it.serviceId = s.id }
                                    }
                                } label: {
                                    Label(it.serviceId.flatMap { id in services.first { $0.id == id }?["name"].str } ?? "Custom…", systemImage: "list.bullet")
                                        .font(.caption).lineLimit(1)
                                }
                                Spacer()
                                if items.count > 1 {
                                    Button { items.removeAll { $0.id == it.id } } label: { Image(systemName: "minus.circle.fill").foregroundStyle(.red) }.buttonStyle(.plain)
                                }
                            }
                            TextField("Description", text: $it.name)
                            HStack {
                                Stepper("Qty \(it.qty)", value: $it.qty, in: 1...999)
                                Divider()
                                Text("RM").foregroundStyle(.secondary)
                                TextField("0.00", text: $it.price).keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(maxWidth: 90)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    Button { items.append(Line()) } label: { Label("\(t("common.add")) line", systemImage: "plus") }
                } header: { Text(t("inv.items")) }
                Section {
                    MoneyField(label: t("inv.discount"), text: $discount)
                    LabeledField(label: "\(t("inv.tax")) (%)", text: $tax, keyboard: .decimalPad)
                }
                Section("\(t("common.notes")) (\(t("common.optional")))") { TextField(t("common.notes"), text: $notes, axis: .vertical).lineLimit(2...5) }
                Section { HStack { Text(t("common.total")).foregroundStyle(.secondary); Spacer(); MoneyText(cents: total).font(.headline) } }
            }
            .navigationTitle(initial.map { "Edit quote \($0["ref"].str)" } ?? "New quote")
            .navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled(busy)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(busy ? t("common.saving") : initial != nil ? t("common.save") : t("common.create")) { Task { await go() } }.disabled(busy)
                }
            }
            .task {
                if let i = initial {
                    customerId = i["customerId"].str
                    let lines = i["items"].array.map { Line(name: $0["name"].str, qty: max(1, $0["qty"].i), price: Fmt.fixed2($0["priceCents"].i), serviceId: $0["serviceId"].string) }
                    items = lines.isEmpty ? [Line()] : lines
                    discount = i["discountCents"].i != 0 ? Fmt.fixed2(i["discountCents"].i) : ""
                    tax = numberText(.number(Double(i["taxRateBp"].i) / 100))
                    notes = i["notes"].str
                }
                services = (try? await API.shared.call("services.list"))?.array ?? []
            }
        }
    }

    private func go() async {
        if customerId.isEmpty { return toast("Choose a customer", error: true) }
        if items.contains(where: { $0.name.trimmingCharacters(in: .whitespaces).isEmpty || $0.price.isEmpty || $0.qty < 1 || Fmt.toCents($0.price) < 0 }) {
            return toast("Complete every line with a description, quantity and valid price", error: true)
        }
        busy = true
        let lines: [JSON] = items.map { i in
            var l: JSON = ["name": .string(i.name), "qty": .number(Double(i.qty)), "priceCents": .number(Double(Fmt.toCents(i.price)))]
            if let s = i.serviceId, !s.isEmpty { l.set("serviceId", .string(s)) }
            return l
        }
        do {
            if let q = initial {
                // The customer is fixed once a quote exists; quotes.update does not take one.
                var input: JSON = ["quoteId": .string(q.id), "items": .array(lines), "discountCents": .number(Double(Fmt.toCents(discount))),
                                   "taxRateBp": .number(Double(Fmt.percentToBasisPoints(tax)))]
                input.set("notes", .orOmit(notes))
                try await API.shared.call("quotes.update", input)
                toast("Quote updated")
            } else {
                var input: JSON = ["customerId": .string(customerId), "discountCents": .number(Double(Fmt.toCents(discount))),
                                   "taxRateBp": .number(Double(Fmt.percentToBasisPoints(tax))), "items": .array(lines)]
                input.set("notes", .orOmit(notes))
                try await API.shared.call("quotes.create", input)
                toast("Quote created")
            }
            await onDone(); dismiss()
        } catch { toast(humanError(error.localizedDescription), error: true) }
        busy = false
    }
}

struct ConvertQuoteSheet: View {
    let quote: JSON
    let onDone: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var when = Fmt.toMinute(Date().addingTimeInterval(86400))
    @State private var busy = false
    @State private var confirming = false
    var body: some View {
        NavigationStack {
            Form {
                Text("\(quote["ref"].str) · \(quote["customer"].str) · \(Fmt.moneyUI(quote["total"].i))")
                DatePicker("Schedule the visit for", selection: $when)
            }
            .navigationTitle("Convert quote to booking")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(t("common.create")) { confirming = true }.disabled(busy) }
            }
            .confirmationDialog("Book \(quote["ref"].str) for \(Fmt.dateTime(when))?", isPresented: $confirming, titleVisibility: .visible) {
                Button("Create booking") { Task { await go() } }
            }
        }
        .presentationDetents([.medium])
    }
    private func go() async {
        busy = true
        do {
            let r = try await API.shared.call("quotes.convertToBooking", ["quoteId": .string(quote.id), "startAt": .string(Fmt.iso(Fmt.toMinute(when)))])
            toast("Booking \(r["bookingRef"].str) created"); await onDone(); dismiss()
        } catch { toast(error.localizedDescription, error: true) }
        busy = false
    }
}

/// Bills an accepted quote without scheduling it first.
struct BillQuoteSheet: View {
    let quote: JSON
    let defaultDueDays: String?
    let onDone: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var dueDays = "14"
    @State private var busy = false
    @State private var confirming = false
    var body: some View {
        NavigationStack {
            Form {
                Text("\(quote["ref"].str) · \(quote["customer"].str) · \(Fmt.moneyUI(quote["total"].i))")
                Section {
                    LabeledField(label: "Payment terms (days)", text: $dueDays, keyboard: .numberPad)
                } footer: { Text("How long the customer has to pay, counted from today.") }
                Section {
                    Text("The quote's line items, discount and tax are copied onto the invoice, which references \(quote["ref"].str). Use Book it instead if the work still needs scheduling — that invoices from the job once it is done.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Invoice this quote")
            .navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled(busy)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) { Button(busy ? t("common.saving") : "Raise invoice") { check() }.disabled(busy) }
            }
            .onAppear {
                let d = Int(Fmt.jsParseFloat(defaultDueDays ?? ""))
                dueDays = String(d > 0 ? d : 14)
            }
            .confirmationDialog("Raise an invoice for \(Fmt.money(quote["total"].i)), due in \(dueDays) days?", isPresented: $confirming, titleVisibility: .visible) {
                Button("Raise invoice") { Task { await go() } }
            }
        }
        .presentationDetents([.medium, .large])
    }
    private func check() {
        guard let d = Int(dueDays.trimmingCharacters(in: .whitespaces)), d >= 0 else { return toast("Enter a whole number of days", error: true) }
        _ = d
        confirming = true
    }
    private func go() async {
        let days = Int(dueDays.trimmingCharacters(in: .whitespaces)) ?? 14
        busy = true
        do {
            let r = try await API.shared.call("quotes.convertToInvoice", ["quoteId": .string(quote.id), "dueDays": .number(Double(days))])
            toast(r["existing"].truthy ? "This quote is already invoiced as \(r["ref"].str)" : "Invoice \(r["ref"].str) raised")
            await onDone(); dismiss()
            Router.shared.push(.invoice(r["invoiceId"].str))
        } catch { toast(humanError(error.localizedDescription), error: true) }
        busy = false
    }
}

// MARK: - Reports (reports/page.tsx)

struct ReportsView: View {
    @State private var preset = "month"
    @State private var month = Fmt.startOfMonth(Date())
    @State private var s: JSON?
    @State private var byService: [JSON] = []
    @State private var topCust: [JSON] = []
    @State private var staffPerf: [JSON] = []
    @State private var expenses: [JSON] = []
    @State private var trend: [JSON] = []
    @State private var error: String?
    // Summary is the overview; Ledger is the month's money laid out like the spreadsheet.
    @State private var view = "summary"
    @State private var ledger: JSON?

    /// "month" is whichever month the picker shows; the others run back from today.
    private static let presets: [(String, String)] = [("month", "Month"), ("90", "Last 90 days"), ("year", "Last 12 months")]

    private var period: (from: Date, to: Date) {
        let now = Date()
        switch preset {
        case "90": return (Fmt.addDays(now, -90), now)
        case "year": return (Fmt.addMonths(now, -12), now)
        default: return (Fmt.startOfMonth(month), Fmt.endOfMonth(month))
        }
    }

    var body: some View {
        List {
            Section {
                ChipPicker(options: [("summary", t("ledger.view.summary")), ("ledger", t("ledger.view.ledger"))], selection: $view)
                    .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                if view == "summary" {
                    ChipPicker(options: Self.presets, selection: $preset).listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                }
                if preset == "month" || view == "ledger" {
                    HStack { MonthPicker(month: $month); Spacer() }.padding(.horizontal, 16)
                        .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                }
            } footer: { Text("\(Fmt.date(period.from)) — \(Fmt.date(period.to))") }
            LoadErrorView(error: error) { Task { await load() } }
            if view == "ledger" { ledgerSections } else { summarySections }
        }
        .navigationTitle(t("nav.reports"))
        .task(id: "\(view)|\(preset)|\(Fmt.isoDate(month))") { await load() }
        .refreshable { await load() }
        .onChange(of: AppState.shared.refreshTick) { Task { await load() } }
    }

    /// One sheet per person, each a grid that scrolls sideways so the columns stay columns.
    @ViewBuilder private var ledgerSections: some View {
        if let l = ledger {
            Section { Text(t("ledger.intro")).font(.caption).foregroundStyle(.secondary) }
            let o = l["owner"]
            Section(l["ownerName"].str) {
                LedgerSheet(second: t("ledger.customerPaidTo"),
                            cols: [("collectedCents", t("ledger.collected")), ("paidCents", t("ledger.paid")), ("uncollectedCents", t("ledger.uncollected"))],
                            rows: o["rows"].array, totals: o["totals"],
                            foot: [(t("ledger.broughtForward"), "collectedCents", o["broughtForwardCents"].i, false),
                                   (t("ledger.balance"), "collectedCents", o["balanceCents"].i, true)])
            }
            ForEach(l["workers"].array.rows(key: "staffId")) { w in
                Section(w["name"].str) {
                    LedgerSheet(second: t("ledger.itemFrom"),
                                cols: [("expenseCents", t("ledger.expense")), ("driverCents", t("ledger.driver")),
                                       ("fromOwnerCents", "\(t("ledger.from")) \(l["ownerName"].str) (RM)"), ("fromCustomerCents", t("ledger.fromCustomer"))],
                                rows: w["rows"].array, totals: w["totals"],
                                foot: [(t("ledger.broughtForward"), "expenseCents", w["broughtForwardCents"].i, false),
                                       ("\(t("ledger.owedTo")) \(w["name"].str)", "expenseCents", w["owedCents"].i, true)]
                                    + (w["driverEarnedToDateCents"].i != 0 ? [(t("ledger.driverToDate"), "driverCents", w["driverEarnedToDateCents"].i, false)] : []))
                }
            }
        } else if error == nil { LoadingRow() }
    }

    @ViewBuilder private var summarySections: some View {
            Section {
                StatGrid {
                    StatTile(label: "Sales earned", value: Fmt.moneyUI(s?["salesCents"].i ?? 0),
                             sub: "Collected \(Fmt.moneyUI(s?["revenueCollectedCents"].i ?? 0)) · owing \(Fmt.moneyUI(s?["outstandingCents"].i ?? 0))", tone: .good)
                    // Every cost profit is net of, so the three parts add up to what was deducted.
                    StatTile(label: "Costs", value: Fmt.moneyUI(s?["totalCostCents"].i ?? 0),
                             sub: "Expenses \(Fmt.moneyUI(s?["expenseCents"].i ?? 0)) · Labour \(Fmt.moneyUI(s?["labourCents"].i ?? 0)) · Materials \(Fmt.moneyUI(s?["materialCents"].i ?? 0))", tone: .warn)
                    StatTile(label: "Profit", value: Fmt.moneyUI(s?["profitCents"].i ?? 0), sub: "\(numberText(s?["marginPct"] ?? 0))% margin · sales less costs",
                             tone: (s?["profitCents"].i ?? 0) >= 0 ? .good : .bad)
                    StatTile(label: "Jobs", value: "\(s?["jobsScheduled"].i ?? 0)", sub: "\(s?["jobsCompleted"].i ?? 0) completed · \(s?["jobsCancelled"].i ?? 0) cancelled")
                }
                .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
            }
            Section("Revenue trend") { BarChart(data: trend, height: 150).padding(.vertical, 6) }
            table("Revenue by service", byService.map { ($0["service"].str, "\($0["jobs"].i)", Fmt.moneyUI($0["revenueCents"].i)) }, cols: ("Service", "Jobs", "Revenue"))
            table("Top customers", topCust.map { ($0["customer"].str, "\($0["payments"].i)", Fmt.moneyUI($0["paidCents"].i)) }, cols: ("Customer", "Payments", "Paid"))
            Section("Staff performance") {
                if staffPerf.isEmpty { Text(t("common.empty")).foregroundStyle(.secondary) }
                ForEach(staffPerf.rows(key: "staffId")) { r in
                    HStack {
                        Text(r["name"].str).font(.subheadline.weight(.medium))
                        Spacer()
                        VStack(alignment: .trailing, spacing: 1) {
                            MoneyText(cents: r["revenueGeneratedCents"].i).font(.subheadline)
                            Text("\(r["jobsCompleted"].i)/\(r["jobsAssigned"].i) jobs · \(numberText(r["hours"]))h").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            table("Expenses by category", expenses.map { ($0["category"].str, "\($0["count"].i)", Fmt.moneyUI($0["amountCents"].i)) }, cols: ("Category", "Count", "Amount"))
    }

    @ViewBuilder private func table(_ title: String, _ rows: [(String, String, String)], cols: (String, String, String)) -> some View {
        Section {
            if rows.isEmpty { Text(t("common.empty")).foregroundStyle(.secondary) }
            else {
                HStack { Text(cols.0); Spacer(); Text(cols.1).frame(width: 64, alignment: .trailing); Text(cols.2).frame(width: 110, alignment: .trailing) }
                    .font(.caption2.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
            }
            ForEach(Array(rows.enumerated()), id: \.offset) { _, r in
                HStack {
                    Text(r.0).font(.subheadline.weight(.medium)).lineLimit(2)
                    Spacer()
                    Text(r.1).font(.subheadline).monospacedDigit().frame(width: 64, alignment: .trailing)
                    Text(r.2).font(.subheadline).monospacedDigit().frame(width: 110, alignment: .trailing)
                }
            }
        } header: { Text(title) }
    }

    private func load() async {
        if view == "ledger" {
            let m = String(Fmt.isoDate(Fmt.startOfMonth(month)).prefix(7))
            do { ledger = try await API.shared.call("reports.ledger", ["month": .string(m)]); error = nil }
            catch { self.error = error.localizedDescription }
            return
        }
        let from = Fmt.isoDate(period.from), to = Fmt.isoDate(period.to)
        let range: JSON = ["from": .string(from), "to": .string(to)]
        let r = await API.shared.batch([
            ("reports.summary", range),
            ("reports.revenueByService", range),
            ("reports.topCustomers", ["from": .string(from), "to": .string(to), "limit": 10]),
            ("reports.staffPerformance", range),
            ("reports.expenseBreakdown", range),
            ("reports.revenueTrend", ["from": .string(from), "to": .string(to), "granularity": .string(preset == "year" ? "month" : "day")]),
        ])
        switch r[0] { case .success(let v): s = v; error = nil; case .failure(let e): error = e.localizedDescription }
        if case .success(let v) = r[1] { byService = v.array }
        if case .success(let v) = r[2] { topCust = v.array }
        if case .success(let v) = r[3] { staffPerf = v.array }
        if case .success(let v) = r[4] { expenses = v.array }
        if case .success(let v) = r[5] { trend = v.array }
    }
}

/// A month ledger sheet in the spreadsheet's layout: teal header, the lines, then
/// a total row and the brought-forward and balance lines.
struct LedgerSheet: View {
    let second: String
    let cols: [(String, String)]
    let rows: [JSON]
    let totals: JSON
    let foot: [(String, String, Int, Bool)]

    private static let teal = Color(hex: 0x0E7C7B), tealSoft = Color(hex: 0xE2F2F1)
    private static let nf: NumberFormatter = {
        let f = NumberFormatter(); f.numberStyle = .decimal; f.minimumFractionDigits = 2; f.maximumFractionDigits = 2; return f
    }()
    private func num(_ c: Int) -> String { c == 0 ? "-" : (Self.nf.string(from: NSNumber(value: Double(c) / 100)) ?? "") }
    private func day(_ iso: String) -> String { let p = iso.split(separator: "-"); return p.count == 3 ? "\(p[2])/\(p[1])/\(p[0])" : iso }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: true) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    cell(t("ledger.date"), w: 86); cell(second, w: 190)
                    ForEach(cols, id: \.0) { c in cell(c.1, w: 112, trailing: true) }
                }
                .font(.caption.weight(.semibold)).foregroundStyle(.white).background(Self.teal)
                if rows.isEmpty {
                    GridRow { cell(t("ledger.nothing"), w: 276).foregroundStyle(.secondary).gridCellColumns(2) }
                }
                ForEach(Array(rows.enumerated()), id: \.offset) { _, r in
                    GridRow {
                        cell(day(r["date"].str), w: 86).foregroundStyle(.secondary)
                        VStack(alignment: .leading, spacing: 0) {
                            Text(r["label"].str).lineLimit(2)
                            if let ref = r["ref"].nonEmpty { Text(ref).font(.caption2).foregroundStyle(.secondary) }
                        }.frame(width: 182, alignment: .leading).padding(.horizontal, 4).padding(.vertical, 5)
                        ForEach(cols, id: \.0) { c in cell(num(r[c.0].i), w: 112, trailing: true) }
                    }
                    .font(.footnote)
                    Divider().gridCellUnsizedAxes(.horizontal)
                }
                GridRow {
                    cell("", w: 86); cell(t("common.total"), w: 190)
                    ForEach(cols, id: \.0) { c in cell(num(totals[c.0].i), w: 112, trailing: true) }
                }
                .font(.footnote.weight(.semibold)).background(Self.tealSoft)
                ForEach(Array(foot.enumerated()), id: \.offset) { _, f in
                    GridRow {
                        cell("", w: 86); cell(f.0, w: 190)
                        ForEach(cols, id: \.0) { c in cell(c.0 == f.1 ? num(f.2) : "", w: 112, trailing: true) }
                    }
                    .font(f.3 ? .footnote.weight(.semibold) : .footnote)
                }
            }
            .monospacedDigit()
        }
        .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
    }

    private func cell(_ s: String, w: CGFloat, trailing: Bool = false) -> some View {
        Text(s).lineLimit(2).frame(width: w - 8, alignment: trailing ? .trailing : .leading)
            .padding(.horizontal, 4).padding(.vertical, 6)
    }
}
