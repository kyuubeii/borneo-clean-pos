import SwiftUI

/**
 jobs/[id] CostingModal, ported line for line.

 Everything that costs the job money, edited together: what each cleaner is
 paid for it, the materials it used, and the expenses booked against it.
 Labour set here is what payroll pays and the reports deduct. The save sends
 only what changed, with the same rules as the web -- a blank labour amount is
 `null` (back to the pay rate), an untouched vendor is left alone, and
 "owed back" only holds while a cleaner paid.
 */
struct CostingSheet: View {
    let job: JSON
    let costing: JSON
    let onDone: () async -> Void
    @Environment(\.dismiss) private var dismiss

    struct LabourRow: Identifiable {
        var id: String { staffId }
        let staffId: String, name: String, basis: String, calculatedCents: Int
        var amount: String
        let isNew: Bool
        let original: Int?
    }
    struct ExpenseRow: Identifiable {
        let key: String
        var id: String { key }
        var expenseId: String?
        var ref: String?
        var amount: String
        var category: String
        var vendor: String
        var staffId: String
        var reimbursable: Bool
        var reimbursed: Bool
        var date: Date
        var original: JSON?
    }

    @State private var staff: [JSON] = []
    @State private var cats: [JSON] = []
    @State private var labour: [LabourRow] = []
    @State private var materials = ""
    @State private var expenses: [ExpenseRow] = []
    @State private var removed: [String] = []
    @State private var busy = false
    @State private var seeded = false

    private var jobDate: String { Fmt.isoDate(job["scheduledAt"].date ?? Date()) }

    /// `cents()` in the modal: blank means "not set", anything else is toCents.
    private func cents(_ s: String) -> Int? { s.trimmingCharacters(in: .whitespaces).isEmpty ? nil : Fmt.toCents(s) }

    private static func payBasis(payType: String, payRate: Int) -> String {
        if payRate == 0 { return "no pay rate set" }
        switch payType {
        case "HOURLY": return "\(Fmt.money(payRate))/hr"
        case "PER_JOB": return "\(Fmt.money(payRate))/job"
        default:
            let p = Double(payRate) / 100
            return "\(p.rounded() == p ? String(Int(p)) : String(p))% of job"
        }
    }

    // Live totals, so the effect of an edit on profit is visible before saving.
    private var labourTotal: Int { labour.reduce(0) { $0 + (cents($1.amount) ?? $1.calculatedCents) } }
    private var materialTotal: Int { cents(materials) ?? 0 }
    private var expenseTotal: Int { expenses.reduce(0) { $0 + (cents($1.amount) ?? 0) } }
    private var profit: Int { job["revenueCents"].i - labourTotal - materialTotal - expenseTotal }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach($labour) { $l in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(l.name).font(.subheadline.weight(.medium))
                                if l.isNew { Tag(text: "new", bg: Brand.b50, fg: Brand.b600) }
                                Spacer()
                                if l.isNew {
                                    Button { labour.removeAll { $0.staffId == l.staffId } } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                                        .buttonStyle(.plain)
                                }
                            }
                            Text("\(l.basis) · calculated \(Fmt.moneyUI(l.calculatedCents))").font(.caption).foregroundStyle(.secondary)
                            HStack {
                                Text("Paid for this job").font(.subheadline)
                                Spacer()
                                Text("RM").foregroundStyle(.secondary)
                                TextField(Fmt.fixed2(l.calculatedCents), text: $l.amount)
                                    .keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(maxWidth: 110)
                                    .accessibilityLabel("Labour for \(l.name)")
                            }
                        }
                        .padding(.vertical, 2)
                    }
                    if labour.isEmpty { Text("No cleaner on this job yet. Add one below to record what they were paid.").font(.footnote).foregroundStyle(.secondary) }
                    let available = staff.filter { s in !labour.contains { $0.staffId == s.id } }
                    if !available.isEmpty {
                        Menu {
                            ForEach(available.rows()) { s in Button(s["name"].str) { addCleaner(s.id) } }
                        } label: { Label("Add cleaner…", systemImage: "plus") }
                    }
                } header: {
                    HStack { Text(t("job.labour")); Spacer(); Text(Fmt.moneyUI(labourTotal)) }
                } footer: {
                    Text("What you pay each cleaner for this job. Leave blank to use their pay rate. This is the amount Payroll pays.\nPaid someone who is not on your staff list? Add it under Other expenses with the category Labour.")
                }

                Section {
                    MoneyField(label: "Materials cost", text: $materials)
                } header: {
                    HStack { Text(t("job.material")); Spacer(); Text(Fmt.moneyUI(materialTotal)) }
                } footer: { Text("Supplies and consumables from your own stock that this job used up.") }

                Section {
                    ForEach($expenses) { $e in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                TextField("Category", text: $e.category)
                                if !cats.isEmpty {
                                    Menu {
                                        ForEach(cats.rows()) { c in Button(c["name"].str) { e.category = c["name"].str } }
                                    } label: { Image(systemName: "chevron.down.circle").foregroundStyle(.secondary) }
                                }
                                Divider()
                                Text("RM").foregroundStyle(.secondary)
                                TextField("0.00", text: $e.amount).keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(maxWidth: 90)
                            }
                            TextField("What / where (optional)", text: $e.vendor).font(.subheadline)
                            DatePicker("Date", selection: $e.date, displayedComponents: .date).font(.subheadline)
                            Picker("Paid by", selection: Binding(get: { e.staffId }, set: { e.staffId = $0; e.reimbursable = !$0.isEmpty })) {
                                Text("Paid by business").tag("")
                                ForEach(staff.rows()) { s in Text("Paid by \(s["name"].str)").tag(s.id) }
                            }
                            .font(.subheadline)
                            if !e.staffId.isEmpty { Toggle("Owed back", isOn: $e.reimbursable).font(.subheadline) }
                            HStack(spacing: 6) {
                                if e.reimbursed { Tag(text: "Reimbursed", bg: Color(hex: 0xECFDF5), fg: Brand.good) }
                                if let r = e.ref { Text(r).font(.caption2).foregroundStyle(.tertiary) }
                                Spacer()
                                Button("Remove", role: .destructive) { removeExpense(e.key) }.font(.caption).buttonStyle(.borderless)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    Button {
                        expenses.append(ExpenseRow(key: "new-\(Date().timeIntervalSince1970)", amount: "", category: "", vendor: "", staffId: "",
                                                   reimbursable: false, reimbursed: false, date: Fmt.localDate(jobDate) ?? Date()))
                    } label: { Label("Add expense", systemImage: "plus") }
                } header: {
                    HStack { Text(t("job.otherExpenses")); Spacer(); Text(Fmt.moneyUI(expenseTotal)) }
                } footer: { Text("Money spent for this job — transport, parking, supplies bought for it. Saved as expenses, so they also appear under Expenses.") }

                Section {
                    KV(k: t("job.revenue"), v: Fmt.moneyUI(job["revenueCents"].i))
                    KV(k: "Total costs", v: Fmt.moneyUI(-(labourTotal + materialTotal + expenseTotal)))
                    HStack {
                        Text("Profit").bold(); Spacer()
                        MoneyText(cents: profit).bold().foregroundStyle(profit >= 0 ? Brand.good : Brand.bad)
                    }
                }
            }
            .navigationTitle("\(t("job.costing")) · \(job["ref"].str)")
            .navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled(busy)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(busy ? t("common.saving") : t("common.save")) { Task { await save() } }.disabled(busy) }
                ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) } }
            }
            .task { await seed() }
        }
    }

    private func seed() async {
        guard !seeded else { return }
        seeded = true
        labour = costing["labourBreakdown"].array.map { b in
            LabourRow(staffId: b["staffId"].str, name: b["staff"].str,
                      basis: Self.payBasis(payType: b["payType"].str, payRate: b["payRate"].i),
                      calculatedCents: b["calculatedCents"].i,
                      amount: b["fixed"].truthy ? Fmt.fixed2(b["costCents"].i) : "",
                      isNew: false, original: b["fixed"].truthy ? b["costCents"].i : nil)
        }
        materials = Fmt.fixed2(costing["materialCents"].i)
        expenses = costing["expenses"].array.map { e in
            ExpenseRow(key: e.id, expenseId: e.id, ref: e["ref"].string, amount: Fmt.fixed2(e["amountCents"].i),
                       category: e["category"].string ?? "", vendor: e["vendor"].string ?? e["note"].string ?? "",
                       staffId: e["staffId"].string ?? "", reimbursable: e["reimbursable"].truthy, reimbursed: e["reimbursed"].truthy,
                       date: Fmt.startOfDay(e["spentAt"].date ?? Date()), original: e)
        }
        removed = []
        let r = await API.shared.batch([("staff.list", [:]), ("expenses.categories", [:])])
        if case .success(let v) = r[0] { staff = v.array }
        if case .success(let v) = r[1] { cats = v.array }
    }

    /// Mirrors labourFor() on the server: hourly on a finished job with nothing
    /// tracked is estimated from the scheduled duration.
    private func addCleaner(_ id: String) {
        guard let s = staff.first(where: { $0.id == id }) else { return }
        let payType = s["payType"].str, payRate = s["payRate"].i
        let calc: Int
        if payType == "PER_JOB" { calc = payRate }
        else if payType == "PERCENT" { calc = Int(Fmt.jsRound(Double(job["revenueCents"].i * payRate) / 10000)) }
        else if job["status"].str == "COMPLETED" { calc = Int(Fmt.jsRound(Double(job["durationMin"].i) / 60 * Double(payRate))) }
        else { calc = 0 }
        labour.append(LabourRow(staffId: s.id, name: s["name"].str, basis: Self.payBasis(payType: payType, payRate: payRate),
                                calculatedCents: calc, amount: "", isNew: true, original: nil))
    }

    private func removeExpense(_ key: String) {
        guard let row = expenses.first(where: { $0.key == key }) else { return }
        if let id = row.expenseId { removed.append(id) }
        expenses.removeAll { $0.key == key }
    }

    private func fields(_ e: ExpenseRow) -> [String: JSON] {
        var f: [String: JSON] = [
            "amountCents": .number(Double(Fmt.toCents(e.amount))),
            "vendor": JSON.orNull(e.vendor.trimmingCharacters(in: .whitespaces)),
            "staffId": JSON.orNull(e.staffId),
            "reimbursable": .bool(!e.staffId.isEmpty && e.reimbursable),
            // `new Date(e.date || jobDate).toISOString()`: UTC midnight of that day.
            "spentAt": .string(Fmt.utcMidnightISO(Fmt.isoDate(e.date))),
        ]
        let cat = e.category.trimmingCharacters(in: .whitespaces)
        if !cat.isEmpty { f["categoryName"] = .string(cat) }
        return f
    }

    private func changed(_ e: ExpenseRow) -> Bool {
        guard let o = e.original else { return true }
        let f = fields(e)
        return f["amountCents"]!.i != o["amountCents"].i
            || (f["categoryName"]?.string ?? "") != (o["category"].string ?? "")
            || (f["vendor"]!.string ?? "") != (o["vendor"].string ?? o["note"].string ?? "")
            || f["staffId"]!.string != o["staffId"].string
            || f["reimbursable"]!.bool != o["reimbursable"].truthy
            || Fmt.isoDate(e.date) != Fmt.isoDate(o["spentAt"].date ?? Date())
    }

    private func save() async {
        for l in labour where !l.amount.trimmingCharacters(in: .whitespaces).isEmpty {
            if !(Fmt.toCents(l.amount) >= 0 && l.amount.contains(where: \.isNumber)) { return toast("Check the labour amount for \(l.name)", error: true) }
        }
        if materialTotal < 0 { return toast("Materials cannot be negative", error: true) }
        for e in expenses where !((cents(e.amount) ?? 0) > 0) { return toast("Every expense needs an amount above zero", error: true) }

        let labourChanges: [JSON] = labour.filter { $0.isNew || cents($0.amount) != $0.original }.map { l in
            ["staffId": .string(l.staffId), "labourCents": cents(l.amount).map { .number(Double($0)) } ?? .null]
        }
        var payload: JSON = ["jobId": .string(job.id)]
        if !labourChanges.isEmpty { payload.set("labour", .array(labourChanges)) }
        if materialTotal != costing["materialCents"].i { payload.set("materialCostCents", .number(Double(materialTotal))) }
        let adds: [JSON] = expenses.filter { $0.expenseId == nil }.map { .object(fields($0)) }
        let updates: [JSON] = expenses.filter { $0.expenseId != nil && changed($0) }.map { e in
            var f = fields(e)
            // An unchanged vendor may really be the note; leave it alone rather than move it.
            if (f["vendor"]?.string ?? "") == (e.original?["vendor"].string ?? e.original?["note"].string ?? "") { f.removeValue(forKey: "vendor") }
            f["expenseId"] = .string(e.expenseId!)
            return .object(f)
        }
        if !adds.isEmpty { payload.set("addExpenses", .array(adds)) }
        if !updates.isEmpty { payload.set("updateExpenses", .array(updates)) }
        if !removed.isEmpty { payload.set("removeExpenseIds", JSON(removed)) }
        if payload.object.count == 1 { dismiss(); return }

        busy = true
        do { try await API.shared.call("jobs.updateCosting", payload); toast("Costing saved"); await onDone(); dismiss() }
        catch { toast(error.localizedDescription, error: true) }
        busy = false
    }
}
