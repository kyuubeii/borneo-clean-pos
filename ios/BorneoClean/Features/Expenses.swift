import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

// MARK: - Expenses (expenses/page.tsx)

struct ExpensesView: View {
    @State private var app = AppState.shared
    @State private var days = 30
    @State private var data: [JSON]?
    @State private var breakdown: [JSON] = []
    @State private var advances: [JSON] = []
    @State private var error: String?
    @State private var creating = false
    @State private var editing: JSON?
    @State private var reimbursing: JSON?

    private var isStaff: Bool { app.user?.isStaff == true }

    var body: some View {
        let total = (data ?? []).reduce(0) { $0 + $1["amountCents"].i }
        // Net of reimbursements already paid back, not the gross of every advance.
        let owedTotal = advances.reduce(0) { $0 + $1["stillOwedCents"].i }
        List {
            Section {
                StatGrid {
                    StatTile(label: isStaff ? t("staff.myExpenses") : "Total spent", value: Fmt.moneyUI(total), sub: "\(data?.count ?? 0) entries", tone: .warn)
                    // staff.advances is owner/admin only, so a cleaner is not shown a figure that never loads.
                    if !isStaff {
                        StatTile(label: t("staff.reimbDue"), value: Fmt.moneyUI(owedTotal),
                                 sub: advances.filter { $0["stillOwedCents"].i > 0 }.map { "\($0["name"].str) \(Int(Fmt.jsRound(Double($0["stillOwedCents"].i) / 100)))" }.joined(separator: " · "))
                        StatTile(label: "Categories used", value: "\(breakdown.count)")
                        StatTile(label: "Top category", value: breakdown.first?["category"].str ?? "—",
                                 sub: breakdown.first.map { Fmt.moneyUI($0["amountCents"].i) })
                    }
                }
                .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
            }
            LoadErrorView(error: error) { Task { await load() } }
            Section {
                if data == nil && error == nil { LoadingRow() }
                else if data?.isEmpty == true { Text(t("common.empty")).foregroundStyle(.secondary) }
                ForEach((data ?? []).rows()) { e in
                    Button { if !isStaff { editing = e.json } } label: { ExpenseRowView(e: e, isStaff: isStaff) }
                        .buttonStyle(.row)
                        .swipeActions {
                            if !isStaff && e["reimbursable"].truthy && !e["reimbursed"].truthy {
                                Button("Reimburse") { reimbursing = e.json }.tint(Brand.good)
                            }
                            if !isStaff { Button(t("common.edit")) { editing = e.json }.tint(Brand.b600) }
                        }
                }
            }
            if !isStaff {
                Section("Money advanced by staff") {
                    if advances.isEmpty { Text("Nobody has advanced money").foregroundStyle(.secondary) }
                    ForEach(advances.rows(key: "staffId")) { x in
                        VStack(alignment: .leading, spacing: 3) {
                            HStack {
                                Text(x["name"].str).font(.subheadline.weight(.medium))
                                Spacer()
                                MoneyText(cents: x["stillOwedCents"].i).font(.subheadline.weight(x["stillOwedCents"].i > 0 ? .semibold : .regular))
                                    .foregroundStyle(x["stillOwedCents"].i > 0 ? Brand.warn : Brand.ink300)
                            }
                            Text("advanced \(Fmt.moneyUI(x["advancedCents"].i)) · settled on rows \(Fmt.moneyUI(x["clearedCents"].i)) · \(x["entries"].i) entries")
                                .font(.caption).foregroundStyle(.secondary)
                            if x["unallocatedCents"].i > 0 {
                                Text("of \(Fmt.moneyUI(x["repaidCents"].i)) paid back, \(Fmt.moneyUI(x["unallocatedCents"].i)) is not yet matched to rows — ticking those rows records which advance it covered and will not change what is owed")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                Section("By category") {
                    ForEach(breakdown.rows(key: "category")) { c in
                        let pct = total > 0 ? Double(c["amountCents"].i) / Double(total) : 0
                        VStack(alignment: .leading, spacing: 5) {
                            HStack { Text(c["category"].str).font(.subheadline.weight(.medium)); Spacer(); MoneyText(cents: c["amountCents"].i).font(.subheadline) }
                            ProgressView(value: min(1, max(0, pct))).tint(Brand.b500)
                        }
                    }
                }
            }
        }
        .navigationTitle(t("nav.expenses"))
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Picker("Period", selection: $days) {
                    ForEach([7, 30, 90, 365], id: \.self) { d in Text(t("common.lastDays").replacingOccurrences(of: "{n}", with: "\(d)")).tag(d) }
                }
                .pickerStyle(.menu)
                Button { creating = true } label: { Image(systemName: "plus") }.accessibilityLabel(t("common.new"))
            }
            if isStaff { ShellToolbar() }
        }
        .task(id: days) { await load() }
        .refreshable { await load() }
        .onChange(of: app.refreshTick) { Task { await load() } }
        .sheet(isPresented: $creating) { ExpenseFormView(expense: nil) { await load() } }
        .sheet(item: Binding(get: { editing.map { Row($0) } }, set: { editing = $0?.json })) { r in ExpenseFormView(expense: r.json) { await load() } }
        .confirmationDialog("Mark reimbursed?", isPresented: Binding(get: { reimbursing != nil }, set: { if !$0 { reimbursing = nil } }), titleVisibility: .visible) {
            Button("Mark \(Fmt.money(reimbursing?["amountCents"].i ?? 0)) reimbursed") { if let e = reimbursing { Task { await reimburse(e.id) } } }
        } message: { Text("Records that \(reimbursing?["staff"].nonEmpty ?? "the cleaner") has been paid back for \(reimbursing?["ref"].str ?? "").") }
    }

    private func load() async {
        let from = Fmt.isoDate(Fmt.addDays(Date(), -days))
        var calls: [(String, JSON)] = [("expenses.list", ["from": .string(from), "limit": 200])]
        // reports.expenseBreakdown and staff.advances are owner/admin only.
        if !isStaff {
            calls.append(("reports.expenseBreakdown", ["from": .string(from), "to": .string(Fmt.isoDate(Date()))]))
            calls.append(("staff.advances", [:]))
        }
        let r = await API.shared.batch(calls)
        switch r[0] { case .success(let v): data = v.array; error = nil; case .failure(let e): error = e.localizedDescription }
        if r.count > 1, case .success(let v) = r[1] { breakdown = v.array }
        if r.count > 2, case .success(let v) = r[2] { advances = v.array }
    }

    private func reimburse(_ id: String) async {
        do { try await API.shared.call("expenses.markReimbursed", ["expenseId": .string(id)]); toast("Marked reimbursed"); await load() }
        catch { toast(error.localizedDescription, error: true) }
    }
}

struct ExpenseRowView: View {
    let e: Row
    let isStaff: Bool
    var body: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Tag(text: e["category"].str)
                    if let j = e["jobRef"].nonEmpty { Text(j).font(.caption2).foregroundStyle(.secondary) }
                }
                Text(e["vendor"].nonEmpty ?? "—").font(.subheadline)
                if let n = e["note"].nonEmpty { Text(n).font(.caption).foregroundStyle(.secondary) }
                HStack(spacing: 6) {
                    Text(e["spentAt"].date.map(Fmt.date) ?? "").font(.caption).foregroundStyle(.secondary)
                    if let r = e["receiptUrl"].nonEmpty, let url = URL(string: r) { Link("receipt", destination: url).font(.caption) }
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                MoneyText(cents: e["amountCents"].i).font(.subheadline.weight(.semibold))
                if e["reimbursable"].truthy {
                    if e["reimbursed"].truthy { Tag(text: "Reimbursed", bg: Color(hex: 0xECFDF5), fg: Brand.good) }
                    else if isStaff { Tag(text: t("staff.awaitingReimb"), bg: Color(hex: 0xFFFBEB), fg: Color(hex: 0xB45309)) }
                    else { Tag(text: "Owed\(e["staff"].nonEmpty.map { " · \($0.split(separator: " ").first.map(String.init) ?? $0)" } ?? "")", bg: Color(hex: 0xFFFBEB), fg: Color(hex: 0xB45309)) }
                }
            }
        }
        .contentShape(Rectangle())
    }
}

/// Records a new expense, or edits one when `expense` is passed.
struct ExpenseFormView: View {
    let expense: JSON?
    let onDone: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var app = AppState.shared
    @State private var cats: [JSON] = []
    @State private var jobs: [JSON] = []
    @State private var staff: [JSON] = []
    @State private var amount = ""
    @State private var categoryName = "Fuel"
    @State private var vendor = ""
    @State private var note = ""
    @State private var jobId = ""
    @State private var staffId = ""
    @State private var reimbursable = false
    @State private var spentAt = Date()
    @State private var receipt: String?
    @State private var uploading = false
    @State private var busy = false
    @State private var pickerItem: PhotosPickerItem?
    @State private var camera = false
    @State private var importingPDF = false
    @State private var confirmDelete = false

    private var editing: Bool { expense != nil }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    MoneyField(label: t("common.amount"), text: $amount, placeholder: "120.00")
                    DatePicker(t("common.date"), selection: $spentAt, displayedComponents: .date)
                    HStack {
                        TextField("Category", text: $categoryName)
                        if !cats.isEmpty {
                            Menu { ForEach(cats.rows()) { c in Button(c["name"].str) { categoryName = c["name"].str } } }
                            label: { Image(systemName: "chevron.down.circle").foregroundStyle(.secondary) }
                        }
                    }
                }
                Section {
                    TextField("Vendor (\(t("common.optional")))", text: $vendor)
                    TextField("Note (\(t("common.optional")))", text: $note)
                }
                Section {
                    Picker("Link to job (\(t("common.optional")))", selection: $jobId) {
                        Text("— none —").tag("")
                        ForEach(jobs.rows()) { j in Text("\(j["ref"].str) · \(j["customer"].str)").tag(j.id) }
                    }
                } footer: { Text("Linked expenses appear in that job's costing.") }
                Section {
                    Picker("Paid by (\(t("common.optional")))", selection: $staffId) {
                        Text("Business").tag("")
                        ForEach(staff.rows()) { s in Text(s["name"].str).tag(s.id) }
                    }
                    Toggle("Reimbursable to staff", isOn: $reimbursable)
                }
                if !editing {
                    Section("Receipt") {
                        if let r = receipt, let url = URL(string: r) {
                            HStack { Label("Attached", systemImage: "checkmark.circle.fill").foregroundStyle(Brand.good); Spacer(); Link("View", destination: url) }
                        }
                        HStack {
                            Button { camera = true } label: { Label("Camera", systemImage: "camera") }
                                .disabled(!UIImagePickerController.isSourceTypeAvailable(.camera))
                            Spacer()
                            PhotosPicker(selection: $pickerItem, matching: .images) { Label("Photo", systemImage: "photo") }
                            Spacer()
                            Button { importingPDF = true } label: { Label("PDF", systemImage: "doc") }
                        }
                        .buttonStyle(.borderless)
                        if uploading { HStack { ProgressView(); Text("Uploading…").foregroundStyle(.secondary) } }
                    }
                }
                if editing, expense?["reimbursed"].truthy == true {
                    Section { Text("This row is marked reimbursed. Changing who paid it clears that tick, because it recorded a repayment to \(expense?["staff"].str ?? "").").font(.footnote).foregroundStyle(Color(hex: 0x78350F)) }
                }
                if editing {
                    Section { Button(t("common.delete"), role: .destructive) { confirmDelete = true }.disabled(busy) }
                }
            }
            .navigationTitle(editing ? "Edit \(expense?["ref"].str ?? "")" : "Record expense")
            .navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled(busy)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(busy ? t("common.saving") : editing ? t("common.save") : "Record") { Task { await go() } }.disabled(busy || uploading)
                }
            }
            .task { await seed() }
            .onChange(of: pickerItem) { _, item in
                guard let item else { return }
                Task {
                    if let d = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: d) { await uploadImage(img) }
                    pickerItem = nil
                }
            }
            .fullScreenCover(isPresented: $camera) { CameraPicker { img in if let img { Task { await uploadImage(img) } } }.ignoresSafeArea() }
            .fileImporter(isPresented: $importingPDF, allowedContentTypes: [.pdf]) { result in
                if case .success(let url) = result { Task { await uploadPDF(url) } }
            }
            .confirmationDialog("Delete \(expense?["ref"].str ?? "") for \(Fmt.money(expense?["amountCents"].i ?? 0))? This cannot be undone.", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button(t("common.delete"), role: .destructive) { Task { await remove() } }
            }
        }
    }

    private func seed() async {
        if let e = expense {
            amount = Fmt.fixed2(e["amountCents"].i)
            categoryName = e["category"].str == "Uncategorised" ? "" : e["category"].str
            vendor = e["vendor"].str; note = e["note"].str; jobId = e["jobId"].str; staffId = e["staffId"].str
            reimbursable = e["reimbursable"].truthy; spentAt = e["spentAt"].date ?? Date(); receipt = e["receiptUrl"].string
        }
        // An old expense can be linked to an old job, so the list reaches back far enough to contain it.
        let jobFrom = expense.map { Fmt.isoDate(Fmt.addDays($0["spentAt"].date ?? Date(), -60)) } ?? Fmt.isoDate(Fmt.addDays(Date(), -14))
        let r = await API.shared.batch([
            ("expenses.categories", [:]),
            ("jobs.list", ["from": .string(jobFrom), "to": .string(Fmt.isoDate(Fmt.addDays(Date(), 7))), "limit": 200]),
            ("staff.list", [:]),
        ])
        if case .success(let v) = r[0] { cats = v.array }
        if case .success(let v) = r[1] { jobs = v.array }
        if case .success(let v) = r[2] { staff = v.array }
    }

    private func uploadImage(_ img: UIImage) async {
        uploading = true
        do { let (d, m, n) = try ImageUpload.jpeg(img); receipt = try await API.shared.upload(d, filename: n, mime: m); toast("Receipt attached") }
        catch { toast(error.localizedDescription, error: true) }
        uploading = false
    }

    private func uploadPDF(_ url: URL) async {
        uploading = true
        let ok = url.startAccessingSecurityScopedResource()
        defer { if ok { url.stopAccessingSecurityScopedResource() } }
        do {
            let d = try Data(contentsOf: url)
            receipt = try await API.shared.upload(d, filename: url.lastPathComponent, mime: "application/pdf")
            toast("Receipt attached")
        } catch { toast(error.localizedDescription, error: true) }
        uploading = false
    }

    private func go() async {
        if amount.isEmpty { return toast("Enter an amount", error: true) }
        busy = true
        // `new Date(f.spentAt).toISOString()` on a date input: UTC midnight of that day.
        let spent = Fmt.utcMidnightISO(Fmt.isoDate(spentAt))
        do {
            if let e = expense {
                // Blanks go as null, not omitted, so clearing a vendor or note clears it.
                var input: JSON = ["expenseId": .string(e.id), "amountCents": .number(Double(Fmt.toCents(amount))),
                                   "vendor": .orNull(vendor), "note": .orNull(note), "jobId": .orNull(jobId), "staffId": .orNull(staffId),
                                   "spentAt": .string(spent), "reimbursable": .bool(reimbursable)]
                input.set("categoryName", .orOmit(categoryName))
                try await API.shared.call("expenses.update", input)
                toast("Expense updated")
            } else {
                var input: JSON = ["amountCents": .number(Double(Fmt.toCents(amount))), "spentAt": .string(spent), "reimbursable": .bool(reimbursable)]
                input.set("categoryName", .orOmit(categoryName)); input.set("vendor", .orOmit(vendor)); input.set("note", .orOmit(note))
                input.set("jobId", .orOmit(jobId)); input.set("staffId", .orOmit(staffId)); input.set("receiptUrl", receipt.map { .string($0) })
                try await API.shared.call("expenses.record", input)
                toast("Expense recorded")
            }
            await onDone(); dismiss()
        } catch { toast(error.localizedDescription, error: true) }
        busy = false
    }

    private func remove() async {
        guard let e = expense else { return }
        busy = true
        do { try await API.shared.call("expenses.delete", ["expenseId": .string(e.id)]); toast("Expense deleted"); await onDone(); dismiss() }
        catch { toast(error.localizedDescription, error: true) }
        busy = false
    }
}

// MARK: - Payroll (payroll/page.tsx)

struct PayrollView: View {
    @State private var app = AppState.shared
    @State private var from = Fmt.startOfMonth(Date())
    @State private var to = Fmt.endOfMonth(Date())
    @State private var calc: JSON?
    @State private var payouts: [JSON] = []
    @State private var error: String?
    @State private var busy = ""
    @State private var creating: JSON?
    @State private var paying: JSON?

    private var fromS: String { Fmt.isoDate(from) }
    private var toS: String { Fmt.isoDate(to) }

    var body: some View {
        let pending = payouts.filter { $0["status"].str == "PENDING" }
        List {
            Section {
                DatePicker(t("common.from"), selection: $from, displayedComponents: .date)
                DatePicker(t("common.to"), selection: $to, in: from..., displayedComponents: .date)
            }
            Section {
                StatGrid {
                    StatTile(label: "Period earnings", value: Fmt.moneyUI(calc?["grandTotalCents"].i ?? 0))
                    StatTile(label: "Outstanding payouts", value: Fmt.moneyUI(pending.reduce(0) { $0 + $1["amountCents"].i }), sub: "\(pending.count) pending", tone: .warn)
                    StatTile(label: "Cleaners", value: "\(calc?["lines"].array.count ?? 0)")
                }
                .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
            }
            LoadErrorView(error: error) { Task { await load() } }
            Section("Earnings · \(Fmt.date(Fmt.parseISO(fromS) ?? from)) — \(Fmt.date(Fmt.parseISO(toS) ?? to))") {
                if calc == nil && error == nil { LoadingRow() }
                else if calc?["lines"].array.isEmpty == true { Text(t("common.empty")).foregroundStyle(.secondary) }
                ForEach((calc?["lines"].array ?? []).rows(key: "staffId")) { l in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(l["name"].str).font(.headline)
                            Spacer()
                            MoneyText(cents: l["totalCents"].i).font(.headline)
                        }
                        let basis = l["payType"].str == "HOURLY" ? "\(Fmt.moneyUI(l["payRate"].i))/hr"
                            : l["payType"].str == "PER_JOB" ? "\(Fmt.moneyUI(l["payRate"].i))/job"
                            : "\(numberText(.number(Double(l["payRate"].i) / 100)))% of job value"
                        Text(basis + (l["fixedJobs"].i > 0 ? " · \(l["fixedJobs"].i) job\(l["fixedJobs"].i > 1 ? "s" : "") at a set amount" : ""))
                            .font(.caption).foregroundStyle(.secondary)
                        HStack(spacing: 14) {
                            mini("Hours", numberText(l["hours"]))
                            mini("Jobs", "\(l["jobsCompleted"].i)")
                            mini("Earned", Fmt.moneyUI(l["earnedCents"].i))
                            mini("Reimburse", Fmt.moneyUI(l["reimbursementsCents"].i))
                        }
                        Button("Create payout") { creating = l.json }
                            .buttonStyle(.bordered).controlSize(.small)
                            .disabled(busy == l["staffId"].str || l["totalCents"].i <= 0)
                    }
                    .padding(.vertical, 4)
                }
            }
            Section("Payout history") {
                if payouts.isEmpty { Text(t("common.empty")).foregroundStyle(.secondary) }
                ForEach(payouts.rows()) { p in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(p["ref"].str) · \(p["staff"].str)").font(.subheadline.weight(.medium))
                            Text("\(p["periodStart"].date.map(Fmt.date) ?? "") — \(p["periodEnd"].date.map(Fmt.date) ?? "")").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 3) {
                            MoneyText(cents: p["amountCents"].i).font(.subheadline.weight(.medium))
                            StatusBadge(status: p["status"].str == "PAID" ? "PAID" : "PENDING")
                        }
                    }
                    .swipeActions { if p["status"].str == "PENDING" { Button("Mark paid") { paying = p.json }.tint(Brand.good) } }
                    .contextMenu { if p["status"].str == "PENDING" { Button("Mark paid") { paying = p.json } } }
                }
            }
        }
        .navigationTitle(t("nav.payroll"))
        .task(id: "\(fromS)|\(toS)") { await load() }
        .refreshable { await load() }
        .onChange(of: app.refreshTick) { Task { await load() } }
        .confirmationDialog("Create payout?", isPresented: Binding(get: { creating != nil }, set: { if !$0 { creating = nil } }), titleVisibility: .visible) {
            Button("Create \(Fmt.money(creating?["totalCents"].i ?? 0)) payout") { if let l = creating { Task { await createPayout(l) } } }
        } message: { Text("For \(creating?["name"].str ?? ""), \(Fmt.date(from)) — \(Fmt.date(to)).") }
        .confirmationDialog("Mark this payout paid?", isPresented: Binding(get: { paying != nil }, set: { if !$0 { paying = nil } }), titleVisibility: .visible) {
            Button("Mark \(Fmt.money(paying?["amountCents"].i ?? 0)) paid") { if let p = paying { Task { await markPaid(p.id) } } }
        } message: { Text("\(paying?["ref"].str ?? "") · \(paying?["staff"].str ?? "")") }
    }

    private func mini(_ k: String, _ v: String) -> some View {
        VStack(alignment: .leading, spacing: 1) { Text(k).font(.caption2).foregroundStyle(.secondary); Text(v).font(.caption.weight(.medium)).monospacedDigit() }
    }

    private func load() async {
        let r = await API.shared.batch([("payroll.calculate", ["from": .string(fromS), "to": .string(toS)]), ("payroll.list", [:])])
        switch r[0] { case .success(let v): calc = v; error = nil; case .failure(let e): error = e.localizedDescription }
        if case .success(let v) = r[1] { payouts = v.array }
    }

    private func createPayout(_ l: JSON) async {
        busy = l["staffId"].str
        do {
            // `new Date(from).toISOString()` on a YYYY-MM-DD: UTC midnight.
            try await API.shared.call("payroll.createPayout", ["staffId": l["staffId"], "periodStart": .string(Fmt.utcMidnightISO(fromS)),
                                                                 "periodEnd": .string(Fmt.utcMidnightISO(toS)), "amountCents": l["totalCents"]])
            toast("Payout created for \(l["name"].str)")
            await load()
        } catch { toast(error.localizedDescription, error: true) }
        busy = ""
    }

    private func markPaid(_ id: String) async {
        do { try await API.shared.call("payroll.markPaid", ["payoutId": .string(id)]); toast("Marked paid"); await load() }
        catch { toast(error.localizedDescription, error: true) }
    }
}
