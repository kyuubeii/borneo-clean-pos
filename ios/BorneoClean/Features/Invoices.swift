import SwiftUI

// MARK: - List (invoices/page.tsx)

struct InvoicesView: View {
    @State private var app = AppState.shared
    @State private var status = ""
    @State private var unpaid = false
    @State private var data: [JSON]?
    @State private var out: JSON?
    @State private var error: String?
    @State private var deleting: JSON?
    @State private var voiding: JSON?
    @State private var busyId: String?
    // Combining: ticked invoices, which must all be one customer's.
    @State private var selecting = false
    @State private var picked: [String] = []
    @State private var merging = false
    @State private var mergeBusy = false

    private var chosen: [JSON] { (data ?? []).filter { picked.contains($0.id) } }
    private func canPick(_ i: JSON) -> Bool {
        i["status"].str != "VOID" && (chosen.first.map { $0["customerId"].str == i["customerId"].str } ?? true)
    }
    private func toggle(_ i: JSON) {
        if picked.contains(i.id) { picked.removeAll { $0 == i.id } }
        else if canPick(i) { picked.append(i.id) }
        else if i["status"].str != "VOID" { toast(t("inv.mergeOneCustomer"), error: true) }
    }

    var body: some View {
        let canVoid = app.user?.can(ADMIN_UP) == true
        let canDelete = app.user?.can(OWNER_ONLY) == true
        List {
            Section {
                StatGrid {
                    StatTile(label: t("dash.outstanding"), value: Fmt.moneyUI(out?["totalOutstandingCents"].i ?? 0), tone: .warn)
                    StatTile(label: "Overdue", value: Fmt.moneyUI(out?["overdueCents"].i ?? 0), sub: "\(out?["overdueInvoices"].i ?? 0) invoices",
                             tone: (out?["overdueCents"].i ?? 0) > 0 ? .bad : .normal)
                    StatTile(label: "Open invoices", value: "\(out?["openInvoices"].i ?? 0)")
                    StatTile(label: "Customers owing", value: "\(out?["byCustomer"].array.count ?? 0)")
                }
                .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
            }
            Section {
                Picker(t("common.status"), selection: $status) {
                    Text("\(t("common.all")) \(t("common.status").lowercased())").tag("")
                    ForEach(["DRAFT", "SENT", "PARTIAL", "PAID", "OVERDUE", "VOID"], id: \.self) { Text(t("inv.status.\($0)")).tag($0) }
                }
                Toggle("Unpaid only", isOn: $unpaid)
            }
            LoadErrorView(error: error) { Task { await load() } }
            if data == nil && error == nil { LoadingRow() }
            else if data?.isEmpty == true { EmptyState(text: t("common.empty")) }
            if selecting, let first = chosen.first {
                let unpaidOfCustomer = (data ?? []).filter { $0["customerId"].str == first["customerId"].str && $0["status"].str != "VOID" && $0["balanceCents"].i > 0 }
                Section {
                    HStack {
                        Text("\(chosen.count) \(t("inv.selected")) · \(first["customer"].str)").font(.subheadline.weight(.medium))
                        Spacer()
                        MoneyText(cents: chosen.reduce(0) { $0 + $1["balanceCents"].i }).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.warn)
                    }
                    if unpaidOfCustomer.count > chosen.count {
                        Button("\(t("inv.selectAllFor")) \(first["customer"].str)") {
                            for i in unpaidOfCustomer where !picked.contains(i.id) { picked.append(i.id) }
                        }
                    }
                    Button(t("inv.merge")) { merging = true }
                        .disabled(chosen.count < 2 || mergeBusy)
                        .font(.body.weight(.semibold))
                }
            }
            Section {
                ForEach((data ?? []).rows()) { i in
                    if selecting {
                        Button { toggle(i.json) } label: {
                            HStack(spacing: 12) {
                                Image(systemName: picked.contains(i.id) ? "checkmark.circle.fill" : "circle")
                                    .font(.title3)
                                    .foregroundStyle(picked.contains(i.id) ? Brand.b600 : Color.secondary)
                                row(i)
                            }
                            .opacity(picked.contains(i.id) || canPick(i.json) ? 1 : 0.35)
                        }
                        .buttonStyle(.plain)
                    } else {
                    NavigationLink(value: Route.invoice(i.id)) {
                        row(i)
                        .opacity(busyId == i.id ? 0.5 : 1)
                    }
                    .swipeActions {
                        if canDelete { Button(t("common.delete"), role: .destructive) { deleting = i.json }.tint(.red) }
                        if canVoid && i["status"].str != "VOID" { Button("Void") { voiding = i.json }.tint(.orange) }
                    }
                    }
                }
            }
        }
        .navigationTitle(t("nav.invoices"))
        .toolbar {
            if canVoid {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(selecting ? t("common.cancel") : t("inv.select")) { selecting.toggle(); picked = [] }
                }
            }
        }
        .confirmationDialog(t("inv.mergeTitle"), isPresented: $merging, titleVisibility: .visible) {
            Button("\(t("inv.mergeGo")) \(chosen.count) · \(Fmt.moneyUI(chosen.reduce(0) { $0 + $1["totalCents"].i }))") { Task { await merge() } }
        } message: {
            Text("\(chosen.sorted { ($0["issuedAt"].date ?? .distantPast) < ($1["issuedAt"].date ?? .distantPast) }.map { $0["ref"].str }.joined(separator: ", "))\n\n\(t("inv.mergeBody"))")
        }
        .task(id: "\(status)|\(unpaid)") { await load() }
        .modifier(InvoiceListSheets(app: app, deleting: $deleting, voiding: $voiding, load: { await load() }, setStatus: { await setStatus($0, $1) }))
    }

    @ViewBuilder private func row(_ i: Row) -> some View {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(i["ref"].str).font(.subheadline.weight(.semibold))
                                Spacer()
                                StatusBadge(status: i["status"].str, label: t("inv.status.\(i["status"].str)"))
                            }
                            Text(i["customer"].str).font(.body.weight(.medium))
                            HStack {
                                Text("\(i["issuedAt"].date.map(Fmt.date) ?? "") · due ").foregroundStyle(.secondary)
                                + Text(i["dueAt"].date.map(Fmt.date) ?? "—").foregroundStyle(i["overdue"].truthy ? Color.red : .secondary)
                                Spacer()
                            }
                            .font(.caption)
                            HStack(spacing: 12) {
                                VStack(alignment: .leading) { Text(t("common.total")).font(.caption2).foregroundStyle(.secondary); MoneyText(cents: i["totalCents"].i).font(.caption) }
                                VStack(alignment: .leading) { Text(t("inv.paid")).font(.caption2).foregroundStyle(.secondary); MoneyText(cents: i["paidCents"].i).font(.caption).foregroundStyle(Brand.good) }
                                Spacer()
                                VStack(alignment: .trailing) {
                                    Text(t("inv.balance")).font(.caption2).foregroundStyle(.secondary)
                                    MoneyText(cents: i["balanceCents"].i).font(.subheadline.weight(.semibold)).foregroundStyle(i["balanceCents"].i > 0 ? Brand.warn : Brand.ink300)
                                }
                            }
                        }
    }

    private func merge() async {
        mergeBusy = true
        do {
            let r = try await API.shared.call("invoices.merge", ["invoices": .array(chosen.map { .string($0["ref"].str) })])
            toast("\(r["ref"].str) combines \(r["combined"].array.map { $0.str }.joined(separator: ", "))")
            selecting = false; picked = []
            await load()
            Router.shared.push(.invoice(r["invoiceId"].str))
        } catch { toast(humanError(error.localizedDescription), error: true) }
        mergeBusy = false
    }

    private func load() async {
        var input: JSON = ["unpaidOnly": .bool(unpaid), "limit": 200]
        input.set("status", .orOmit(status))
        let r = await API.shared.batch([("invoices.list", input), ("payments.outstanding", [:])])
        switch r[0] { case .success(let v): data = v.array; error = nil; case .failure(let e): error = e.localizedDescription }
        if case .success(let v) = r[1] { out = v }
    }

    private func setStatus(_ inv: JSON, _ next: String) async {
        busyId = inv.id
        do {
            try await API.shared.call("invoices.updateStatus", ["invoiceId": .string(inv.id), "status": .string(next)])
            toast(next == "VOID" ? "\(inv["ref"].str) voided" : "\(inv["ref"].str) set to \(next.lowercased())")
            await load()
        } catch { toast(humanError(error.localizedDescription), error: true) }
        busyId = nil
    }
}

/// The void and delete prompts, kept apart so the list's body stays small enough to type-check.
private struct InvoiceListSheets: ViewModifier {
    let app: AppState
    @Binding var deleting: JSON?
    @Binding var voiding: JSON?
    let load: () async -> Void
    let setStatus: (JSON, String) async -> Void

    func body(content: Content) -> some View {
        content
        .refreshable { await load() }
        .onChange(of: app.refreshTick) { Task { await load() } }
        .confirmationDialog("Void this invoice?", isPresented: Binding(get: { voiding != nil }, set: { if !$0 { voiding = nil } }), titleVisibility: .visible) {
            Button("Void \(voiding?["ref"].str ?? "")", role: .destructive) { if let v = voiding { Task { await setStatus(v, "VOID") } } }
        } message: { Text("The record and any payments are kept; it simply stops counting as owed.") }
        .sheet(item: Binding(get: { deleting.map { Row($0) } }, set: { deleting = $0?.json })) { r in
            ConfirmDeleteSheet(title: "Delete invoice permanently", action: "invoices.delete", input: ["invoiceId": .string(r.id)],
                               confirmText: r["ref"].str, confirmLabel: "the invoice reference",
                               message: "Invoice \(r["ref"].str) for \(r["customer"].str) and its line items are removed for good. It will disappear from your takings and outstanding figures. This cannot be undone.\n\nIt is refused once any payment has been recorded against it.",
                               alternative: "To cancel an invoice that has already gone out, close this and use Void — the record and any payments are kept, it just stops counting as owed.",
                               onDone: { Task { await load() } })
        }
    }
}

// MARK: - Detail (invoices/[id]/page.tsx)

struct InvoiceDetailView: View {
    let id: String
    @State private var app = AppState.shared
    @State private var inv: JSON?
    @State private var biz: JSON = [:]
    @State private var error: String?
    @State private var pay = false
    @State private var refund = false
    @State private var showDoc = false

    var body: some View {
        List {
            if let error, inv == nil { LoadErrorView(error: error) { Task { await load() } } }
            if inv == nil && error == nil { LoadingRow() }
            if let inv {
                Section {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(inv["customer"]["name"].str).font(.headline)
                            Text("\(t("inv.issued")) \(inv["issuedAt"].date.map(Fmt.date) ?? "") · \(t("inv.dueDate")) \(inv["dueAt"].date.map(Fmt.date) ?? "—")")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        StatusBadge(status: inv["status"].str, label: t("inv.status.\(inv["status"].str)"))
                    }
                    Button { showDoc = true } label: { Label("View / print \(inv["ref"].str)", systemImage: "doc.richtext") }
                }

                Section(t("inv.items")) {
                    ForEach(inv["items"].array.rows()) { i in
                        HStack {
                            Text(i["qty"].i > 1 ? "\(i["name"].str) × \(i["qty"].i)" : i["name"].str)
                            Spacer()
                            MoneyText(cents: i["qty"].i * i["priceCents"].i)
                        }
                        .font(.subheadline)
                    }
                    KV(k: t("inv.subtotal"), v: Fmt.moneyUI(inv["subtotal"].i))
                    if inv["discount"].i > 0 { KV(k: t("inv.discount"), v: Fmt.moneyUI(-inv["discount"].i)) }
                    if inv["tax"].i > 0 { KV(k: "\(t("inv.tax")) (\(String(format: "%.2f", Double(inv["taxRateBp"].i) / 100))%)", v: Fmt.moneyUI(inv["tax"].i)) }
                }

                // What is owed after payments. The printed sheet states the amount due
                // on the day it was raised, so this sits beside it rather than on it.
                Section(t("inv.balance")) {
                    KV(k: t("common.total"), v: Fmt.moneyUI(inv["total"].i))
                    KV(k: t("inv.paid"), v: Fmt.moneyUI(inv["paid"].i), tone: Brand.good)
                    HStack {
                        Text(t("inv.balance")).bold(); Spacer()
                        MoneyText(cents: inv["balance"].i).font(.headline).foregroundStyle(inv["balance"].i > 0 ? Brand.warn : Brand.good)
                    }
                    if inv["balance"].i > 0 && inv["status"].str != "VOID" {
                        Button { pay = true } label: { Label(t("inv.recordPayment"), systemImage: "banknote").frame(maxWidth: .infinity) }
                            .buttonStyle(.borderedProminent).controlSize(.large)
                            .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                    }
                }

                if !inv["payments"].array.isEmpty {
                    Section(t("nav.payments")) {
                        ForEach(inv["payments"].array.rows()) { p in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("\(p["ref"].str)  ").font(.subheadline.weight(.medium)) + Text(p["method"].str + (p["receivedBy"]["name"].nonEmpty.map { " · \(t("pay.collectedBy")) \($0)" } ?? "")).font(.caption).foregroundStyle(.secondary)
                                    Text("\(p["paidAt"].date.map(Fmt.dateTime) ?? "")\(p["note"].nonEmpty.map { " · \($0)" } ?? "")").font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                MoneyText(cents: p["isRefund"].truthy ? -p["amountCents"].i : p["amountCents"].i)
                                    .font(.subheadline.weight(.medium)).foregroundStyle(p["isRefund"].truthy ? Color.red : Brand.good)
                            }
                        }
                    }
                }

                if !inv["jobs"].array.isEmpty {
                    Section(t("nav.jobs")) {
                        ForEach(inv["jobs"].array.rows()) { j in NavigationLink(value: Route.job(j.id)) { Text(j["ref"].str) } }
                    }
                }
            }
        }
        .navigationTitle(inv?["ref"].str ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let inv {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        if inv["balance"].i > 0 && inv["status"].str != "VOID" { Button { pay = true } label: { Label(t("inv.recordPayment"), systemImage: "banknote") } }
                        if app.user?.can(ADMIN_UP) == true && inv["paid"].i > 0 && inv["status"].str != "VOID" {
                            Button { refund = true } label: { Label("Refund", systemImage: "arrow.uturn.backward") }
                        }
                        Button { showDoc = true } label: { Label(t("common.print"), systemImage: "printer") }
                        NavigationLink(value: Route.customer(inv["customerId"].str)) { Label(t("common.customer"), systemImage: "person") }
                    } label: { Image(systemName: "ellipsis.circle") }
                }
            }
        }
        .loads(load)
        .sheet(isPresented: $pay) { if let inv { PaySheet(invoice: inv) { await load() } } }
        .sheet(isPresented: $refund) { if let inv { RefundSheet(invoice: inv) { await load() } } }
        .sheet(isPresented: $showDoc) {
            if let inv {
                NavigationStack {
                    DocumentPreview(title: inv["ref"].str, html: InvoiceDocument.html(
                        kind: .invoice, ref: inv["ref"].str, customer: inv["customer"], issuedAt: inv["issuedAt"].date, dueAt: inv["dueAt"].date,
                        items: inv["items"].array, discountCents: inv["discountCents"].i, taxRateBp: inv["taxRateBp"].i,
                        notes: inv["notes"].string, business: biz.object, paidCents: inv["paid"].i))
                    .navigationTitle(inv["ref"].str)
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button(t("common.close")) { showDoc = false } } }
                }
            }
        }
    }

    private func load() async {
        let r = await API.shared.batch([("invoices.get", ["invoiceId": .string(id)]), ("settings.get", [:])])
        switch r[0] { case .success(let v): inv = v; error = nil; case .failure(let e): error = e.localizedDescription }
        if case .success(let v) = r[1] { biz = v }
    }
}

private let METHODS = ["CASH", "BANK", "CARD", "EWALLET", "CHEQUE"]

struct PaySheet: View {
    let invoice: JSON
    let onDone: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var amount = ""
    @State private var method = "BANK"
    @State private var reference = ""
    // Empty means the owner received it; a cleaner's id means they collected it and keep it.
    @State private var receivedById = ""
    @State private var staff: [JSON] = []
    @State private var busy = false
    @State private var confirming = false

    var body: some View {
        NavigationStack {
            Form {
                Section { KV(k: t("inv.balance"), v: Fmt.moneyUI(invoice["balance"].i)) }
                Section {
                    MoneyField(label: t("common.amount"), text: $amount)
                    Picker("Method", selection: $method) { ForEach(METHODS, id: \.self) { Text($0).tag($0) } }
                    Picker(t("pay.receivedBy"), selection: $receivedById) {
                        Text(t("pay.me")).tag("")
                        ForEach(staff.rows()) { s in Text(s["name"].str).tag(s.id) }
                    }
                    TextField("Reference (\(t("common.optional")))", text: $reference)
                } footer: { Text(receivedById.isEmpty ? "Partial payments are supported." : t("pay.keptHint")) }
            }
            .navigationTitle(t("inv.recordPayment"))
            .navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled(busy)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) { Button(busy ? t("common.saving") : "Record") { check() }.disabled(busy) }
            }
            .onAppear { amount = Fmt.fixed2(invoice["balance"].i); reference = ""; receivedById = "" }
            .task { if let v = try? await API.shared.call("staff.list", [:]) { staff = v.array } }
            .confirmationDialog("Record \(Fmt.money(Fmt.toCents(amount))) by \(method) against \(invoice["ref"].str)?", isPresented: $confirming, titleVisibility: .visible) {
                Button(t("inv.recordPayment")) { Task { await go() } }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func check() {
        let c = Fmt.toCents(amount)
        if c <= 0 || c > invoice["balance"].i { return toast("Enter an amount greater than zero and no more than the balance", error: true) }
        confirming = true
    }

    private func go() async {
        busy = true
        var input: JSON = ["invoiceId": .string(invoice.id), "amountCents": .number(Double(Fmt.toCents(amount))), "method": .string(method)]
        input.set("reference", .orOmit(reference))
        input.set("receivedById", .orOmit(receivedById))
        do { try await API.shared.call("payments.record", input); toast("Payment recorded"); await onDone(); dismiss() }
        catch { toast(error.localizedDescription, error: true) }
        busy = false
    }
}

/// A second entry rather than an edit of the payment, so the history says what happened.
struct RefundSheet: View {
    let invoice: JSON
    let onDone: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var amount = ""
    @State private var method = "BANK"
    @State private var note = ""
    @State private var busy = false
    @State private var confirming = false

    var body: some View {
        NavigationStack {
            Form {
                Section { KV(k: t("inv.paid"), v: Fmt.moneyUI(invoice["paid"].i)) }
                Section {
                    MoneyField(label: t("common.amount"), text: $amount)
                    Picker("Method", selection: $method) { ForEach(METHODS, id: \.self) { Text($0).tag($0) } }
                    TextField("Reason (\(t("common.optional")))", text: $note)
                } footer: { Text("Cannot exceed what has been paid.") }
            }
            .navigationTitle("Record a refund")
            .navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled(busy)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) { Button(busy ? t("common.saving") : "Refund") { check() }.disabled(busy).tint(.red) }
            }
            .onAppear { amount = Fmt.fixed2(invoice["paid"].i); note = "" }
            .confirmationDialog("Refund \(Fmt.money(Fmt.toCents(amount))) on \(invoice["ref"].str)?", isPresented: $confirming, titleVisibility: .visible) {
                Button("Record refund", role: .destructive) { Task { await go() } }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func check() {
        let c = Fmt.toCents(amount)
        if c <= 0 { return toast("Enter an amount to refund", error: true) }
        if c > invoice["paid"].i { return toast("That is more than has been paid on this invoice", error: true) }
        confirming = true
    }

    private func go() async {
        busy = true
        var input: JSON = ["invoiceId": .string(invoice.id), "amountCents": .number(Double(Fmt.toCents(amount))), "method": .string(method)]
        input.set("note", .orOmit(note))
        do { try await API.shared.call("payments.refund", input); toast("Refund recorded"); await onDone(); dismiss() }
        catch { toast(humanError(error.localizedDescription), error: true) }
        busy = false
    }
}

// MARK: - Payments (payments/page.tsx)

struct PaymentsView: View {
    @State private var app = AppState.shared
    @State private var days = 30
    @State private var data: [JSON]?
    @State private var out: JSON?
    @State private var error: String?
    @State private var deleting: JSON?

    var body: some View {
        let canDelete = app.user?.can(OWNER_ONLY) == true
        let received = (data ?? []).reduce(0) { $0 + $1["amountCents"].i }
        List {
            Section {
                StatGrid {
                    StatTile(label: "Received", value: Fmt.moneyUI(received), sub: "\(data?.count ?? 0) payments", tone: .good)
                    StatTile(label: t("dash.outstanding"), value: Fmt.moneyUI(out?["totalOutstandingCents"].i ?? 0), tone: .warn)
                    StatTile(label: "Overdue", value: Fmt.moneyUI(out?["overdueCents"].i ?? 0), tone: .bad)
                    StatTile(label: "Customers owing", value: "\(out?["byCustomer"].array.count ?? 0)")
                }
                .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
            }
            LoadErrorView(error: error) { Task { await load() } }
            Section("Payment history") {
                if data == nil && error == nil { LoadingRow() }
                else if data?.isEmpty == true { Text(t("common.empty")).foregroundStyle(.secondary) }
                ForEach((data ?? []).rows()) { p in
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 6) {
                                Text(p["ref"].str).font(.subheadline.weight(.medium))
                                if p["isRefund"].truthy { Tag(text: "Refund", bg: Color(hex: 0xFEF2F2), fg: .red) }
                                Tag(text: p["method"].str)
                            }
                            Text(p["customer"].str).font(.subheadline)
                            Text("\(p["paidAt"].date.map(Fmt.dateTime) ?? "")\(p["invoiceRef"].nonEmpty.map { " · \($0)" } ?? "")\(p["collectedBy"].nonEmpty.map { " · \(t("pay.collectedBy")) \($0)" } ?? "")").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        MoneyText(cents: p["amountCents"].i).font(.subheadline.weight(.semibold)).foregroundStyle(p["amountCents"].i < 0 ? Color.red : Brand.good)
                    }
                    .swipeActions { if canDelete { Button(t("common.delete"), role: .destructive) { deleting = p.json }.tint(.red) } }
                }
            }
            Section("Who owes money") {
                let owing = out?["byCustomer"].array ?? []
                if owing.isEmpty { Text("Everyone's paid up").foregroundStyle(.secondary) }
                ForEach(owing.rows(key: "customerId")) { c in
                    NavigationLink(value: Route.customer(c["customerId"].str)) {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(c["customer"].str).font(.subheadline.weight(.medium))
                                Text("\(c["invoices"].i) invoice\(c["invoices"].i == 1 ? "" : "s")").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            MoneyText(cents: c["balanceCents"].i).font(.subheadline.weight(.medium)).foregroundStyle(Brand.warn)
                        }
                    }
                }
            }
        }
        .navigationTitle(t("nav.payments"))
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Picker("Period", selection: $days) {
                    ForEach([7, 30, 90, 365], id: \.self) { d in Text(t("common.lastDays").replacingOccurrences(of: "{n}", with: "\(d)")).tag(d) }
                }
                .pickerStyle(.menu)
            }
        }
        .task(id: days) { await load() }
        .refreshable { await load() }
        .onChange(of: app.refreshTick) { Task { await load() } }
        .sheet(item: Binding(get: { deleting.map { Row($0) } }, set: { deleting = $0?.json })) { r in
            ConfirmDeleteSheet(title: "Delete payment entry permanently", action: "payments.delete", input: ["paymentId": .string(r.id)],
                               confirmText: r["ref"].str, confirmLabel: "the payment reference",
                               message: "Payment \(r["ref"].str) from \(r["customer"].str) is removed for good, and your takings will change by \(Fmt.moneyUI(abs(r["amountCents"].i))).\(r["invoiceRef"].nonEmpty.map { " Invoice \($0) will be re-checked and may go back to unpaid." } ?? "")\n\nUse this only for an entry recorded in error — a typo, or the same payment entered twice. This cannot be undone.",
                               alternative: "If the money was genuinely returned to the customer, record a refund on the invoice instead. That keeps both entries and leaves an honest trail.",
                               onDone: { Task { await load() } })
        }
    }

    private func load() async {
        let r = await API.shared.batch([
            ("payments.list", ["from": .string(Fmt.isoDate(Fmt.addDays(Date(), -days))), "limit": 200]),
            ("payments.outstanding", [:]),
        ])
        switch r[0] { case .success(let v): data = v.array; error = nil; case .failure(let e): error = e.localizedDescription }
        if case .success(let v) = r[1] { out = v }
    }
}
