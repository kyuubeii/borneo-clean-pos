import SwiftUI

private let DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
private let DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

// MARK: - Cleaners (staff/page.tsx)

struct StaffView: View {
    @State private var app = AppState.shared
    @State private var data: [JSON]?
    @State private var error: String?
    @State private var creating = false
    @State private var editing: JSON?
    @State private var deleting: JSON?
    @State private var busyId: String?

    var body: some View {
        let manage = app.user?.can(ADMIN_UP) == true
        List {
            LoadErrorView(error: error) { Task { await load() } }
            if data == nil && error == nil { LoadingRow() }
            else if data?.isEmpty == true { EmptyState(text: t("common.empty")) }
            ForEach((data ?? []).rows()) { s in
                NavigationLink(value: Route.staff(s.id)) {
                    HStack(spacing: 12) {
                        Avatar(name: s["name"].str, colour: s["colour"].str, size: 40)
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 6) {
                                Text(s["name"].str).font(.body.weight(.semibold))
                                if !s["active"].truthy { Tag(text: "INACTIVE") }
                            }
                            Text(s["phone"].nonEmpty ?? s["email"].nonEmpty ?? "—").font(.caption).foregroundStyle(.secondary)
                            HStack(spacing: 3) {
                                ForEach(0..<7, id: \.self) { i in
                                    let on = s["availability"].array.contains { $0["weekday"].i == i }
                                    Text(DAYS[i]).font(.system(size: 9, weight: .medium))
                                        .padding(.horizontal, 3).padding(.vertical, 1)
                                        .background(on ? Brand.b50 : Brand.ink50, in: .rect(cornerRadius: 3))
                                        .foregroundStyle(on ? Brand.b600 : Brand.ink300)
                                }
                            }
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(s["payType"].str == "HOURLY" ? "Hourly" : s["payType"].str == "PER_JOB" ? "Per job" : "Commission").font(.caption2).foregroundStyle(.secondary)
                            Text(s["payType"].str == "PERCENT" ? "\(numberText(.number(Double(s["payRate"].i) / 100)))%"
                                 : "\(Fmt.moneyUI(s["payRate"].i))\(s["payType"].str == "HOURLY" ? " /hr" : " /job")").font(.caption.weight(.medium))
                        }
                    }
                    .opacity(s["active"].truthy ? 1 : 0.6)
                }
                .swipeActions(edge: .trailing) {
                    if manage {
                        Button(t("common.delete"), role: .destructive) { deleting = s.json }.tint(.red)
                        Button(s["active"].truthy ? "Deactivate" : "Reactivate") { Task { await setActive(s.json, !s["active"].truthy) } }.tint(.orange)
                    }
                }
                .swipeActions(edge: .leading) { if manage { Button(t("common.edit")) { editing = s.json }.tint(Brand.b600) } }
                .opacity(busyId == s.id ? 0.5 : 1)
            }
        }
        .navigationTitle(t("nav.staff"))
        .toolbar { ToolbarItem(placement: .primaryAction) { Button { creating = true } label: { Image(systemName: "plus") }.accessibilityLabel(t("common.new")) } }
        .loads(load)
        .sheet(isPresented: $creating) { StaffFormView(initial: nil) { await load() } }
        .sheet(item: rowBinding($editing)) { r in StaffFormView(initial: r.json) { await load() } }
        .sheet(item: rowBinding($deleting)) { r in
            ConfirmDeleteSheet(title: "Delete cleaner permanently", action: "staff.delete", input: ["staffId": .string(r.id)],
                               confirmText: r["name"].str, confirmLabel: "the cleaner’s name",
                               message: "\(r["name"].str) is removed for good, along with their weekly availability. This cannot be undone.\n\nIt only works for a cleaner who has never been assigned a job. Once there is any work history, the record has to be kept so past jobs and payroll still add up.",
                               onDone: { Task { await load() } })
        }
    }

    private func load() async {
        do { data = try await API.shared.call("staff.list", ["includeInactive": true]).array; error = nil }
        catch { self.error = error.localizedDescription }
    }

    /// Freeze / unfreeze. Keeps every job, hour and payout the cleaner is attached to.
    private func setActive(_ s: JSON, _ active: Bool) async {
        busyId = s.id
        do {
            try await API.shared.call("staff.update", ["staffId": .string(s.id), "active": .bool(active)])
            toast(active ? "\(s["name"].str) reactivated" : "\(s["name"].str) deactivated — history kept")
            await load()
        } catch { toast(humanError(error.localizedDescription), error: true) }
        busyId = nil
    }
}

/// Create when `initial` is nil, edit when it is there.
struct StaffFormView: View {
    let initial: JSON?
    let onDone: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var phone = ""
    @State private var email = ""
    @State private var payType = "HOURLY"
    @State private var rate = "18.00"
    @State private var colour = Color(css: "#3385fb")
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(t("common.name"), text: $name)
                    TextField(t("common.phone"), text: $phone).keyboardType(.phonePad)
                    TextField(t("common.email"), text: $email).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                }
                Section {
                    Picker("Pay type", selection: $payType) {
                        Text("Hourly rate").tag("HOURLY"); Text("Fixed per job").tag("PER_JOB"); Text("Percentage of job value").tag("PERCENT")
                    }
                    if payType == "PERCENT" { LabeledField(label: "Percent", text: $rate, keyboard: .decimalPad) }
                    else { MoneyField(label: "Rate", text: $rate) }
                }
                Section { ColorPicker("Calendar colour", selection: $colour, supportsOpacity: false) }
            }
            .navigationTitle(initial.map { "Edit \($0["name"].str)" } ?? "New cleaner")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(busy ? t("common.saving") : initial != nil ? t("common.save") : t("common.create")) { Task { await save() } }.disabled(busy)
                }
            }
            .onAppear {
                if let i = initial {
                    name = i["name"].str; phone = i["phone"].str; email = i["email"].str; payType = i["payType"].str
                    colour = Color(css: i["colour"].str)
                    rate = payType == "PERCENT" ? numberText(.number(Double(i["payRate"].i) / 100)) : Fmt.fixed2(i["payRate"].i)
                }
            }
        }
    }

    private func save() async {
        if name.trimmingCharacters(in: .whitespaces).isEmpty { return toast("Name is required", error: true) }
        busy = true
        let payRate = payType == "PERCENT" ? Fmt.percentToBasisPoints(rate) : Fmt.toCents(rate.isEmpty ? "0" : rate)
        var payload: JSON = ["name": .string(name), "payType": .string(payType), "colour": .string(colour.cssHex), "payRate": .number(Double(payRate))]
        payload.set("phone", .orOmit(phone)); payload.set("email", .orOmit(email))
        do {
            if let i = initial {
                payload.set("staffId", .string(i.id))
                try await API.shared.call("staff.update", payload)
                toast("Cleaner updated")
            } else {
                try await API.shared.call("staff.create", payload)
                toast("Cleaner added")
            }
            await onDone(); dismiss()
        } catch { toast(humanError(error.localizedDescription), error: true) }
        busy = false
    }
}

// MARK: - Cleaner detail (staff/[id]/page.tsx)

struct StaffDetailView: View {
    let id: String
    @State private var list: [JSON]?
    @State private var hist: JSON?
    @State private var pay: JSON?
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        let s = list?.first { $0.id == id }
        List {
            if let error, list == nil { LoadErrorView(error: error) { Task { await load() } } }
            if list == nil && error == nil { LoadingRow() }
            if list != nil && s == nil { EmptyState(text: "Cleaner not found") }
            if let s {
                Section {
                    StatGrid {
                        StatTile(label: "Jobs (90d)", value: "\(hist?["jobsAssigned"].i ?? 0)")
                        StatTile(label: t("dash.completed"), value: "\(hist?["jobsCompleted"].i ?? 0)", tone: .good)
                        StatTile(label: "Hours", value: numberText(hist?["totalHours"] ?? 0))
                        StatTile(label: "Earned (90d)", value: Fmt.moneyUI(pay?["lines"][0]["earnedCents"].i ?? 0))
                    }
                    .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                }
                if let p = s["phone"].nonEmpty { Section { Button { call(p) } label: { Label(p, systemImage: "phone") } } }
                Section {
                    ForEach(0..<7, id: \.self) { i in
                        let slot = s["availability"].array.first { $0["weekday"].i == i }
                        Button { Task { await toggleDay(s, i) } } label: {
                            HStack {
                                Text(DAYS_LONG[i]).foregroundStyle(slot != nil ? Brand.b700 : .secondary)
                                Spacer()
                                Text(slot.map { String(format: "%02d:00 – %02d:00", $0["startMin"].i / 60, $0["endMin"].i / 60) } ?? "Off")
                                    .monospacedDigit().foregroundStyle(slot != nil ? Brand.b700 : .secondary)
                            }
                        }
                        .disabled(saving)
                        .listRowBackground(slot != nil ? Brand.b50 : Color(.secondarySystemGroupedBackground))
                    }
                } header: { Text("Weekly availability") } footer: { Text("Default shift is 08:00–18:00. Tap a day to toggle it.") }
                Section("Assigned jobs") {
                    let jobs = hist?["jobs"].array ?? []
                    if jobs.isEmpty { Text(t("common.empty")).foregroundStyle(.secondary) }
                    ForEach(jobs.rows()) { j in
                        NavigationLink(value: Route.job(j.id)) {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(j["customer"].str).font(.subheadline.weight(.medium))
                                    Text("\(j["ref"].str) · \(j["scheduledAt"].date.map(Fmt.dateTime) ?? "")").font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                StatusBadge(status: j["status"].str, label: t("job.status.\(j["status"].str)"))
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle(s?["name"].str ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .loads(load)
    }

    private func load() async {
        let from = Fmt.isoDate(Date().addingTimeInterval(-90 * 86400)), to = Fmt.isoDate(Date())
        let r = await API.shared.batch([
            ("staff.list", ["includeInactive": true]),
            ("staff.workHistory", ["staffId": .string(id), "from": .string(from), "to": .string(to)]),
            ("payroll.calculate", ["from": .string(from), "to": .string(to), "staffId": .string(id)]),
        ])
        switch r[0] { case .success(let v): list = v.array; error = nil; case .failure(let e): error = e.localizedDescription }
        if case .success(let v) = r[1] { hist = v }
        if case .success(let v) = r[2] { pay = v }
    }

    private func toggleDay(_ s: JSON, _ weekday: Int) async {
        let avail = s["availability"].array
        let has = avail.contains { $0["weekday"].i == weekday }
        var slots: [JSON] = avail.filter { !has || $0["weekday"].i != weekday }
            .map { ["weekday": $0["weekday"], "startMin": $0["startMin"], "endMin": $0["endMin"]] }
        if !has { slots.append(["weekday": .number(Double(weekday)), "startMin": 480, "endMin": 1080]) }
        saving = true
        do { try await API.shared.call("staff.setAvailability", ["staffId": .string(id), "slots": .array(slots)]); await load(); toast("Availability updated") }
        catch { toast(error.localizedDescription, error: true) }
        saving = false
    }
}

// MARK: - Services (services/page.tsx)

struct ServicesView: View {
    @State private var app = AppState.shared
    @State private var data: [JSON]?
    @State private var error: String?
    @State private var creating = false
    @State private var editing: JSON?
    @State private var deleting: JSON?

    var body: some View {
        let manage = app.user?.can(ADMIN_UP) == true
        List {
            LoadErrorView(error: error) { Task { await load() } }
            if data == nil && error == nil { LoadingRow() }
            group("Services", (data ?? []).filter { !$0["isAddon"].truthy }, manage: manage)
            group("Add-ons", (data ?? []).filter { $0["isAddon"].truthy }, manage: manage)
        }
        .navigationTitle(t("nav.services"))
        .toolbar { ToolbarItem(placement: .primaryAction) { Button { creating = true } label: { Image(systemName: "plus") }.accessibilityLabel(t("common.new")) } }
        .loads(load)
        .sheet(isPresented: $creating) { ServiceFormView(initial: nil) { await load() } }
        .sheet(item: rowBinding($editing)) { r in ServiceFormView(initial: r.json) { await load() } }
        .sheet(item: rowBinding($deleting)) { r in
            ConfirmDeleteSheet(title: "Delete service permanently", action: "services.delete", input: ["serviceId": .string(r.id)],
                               confirmText: r["name"].str, confirmLabel: "the service name",
                               message: "\(r["name"].str) is removed from the catalogue for good. This cannot be undone.\n\nIt only works for a service that has never been booked or quoted. Once it appears on any record, it has to stay so those prices still make sense.",
                               alternative: "To retire it from new bookings while keeping past ones intact, close this and use Deactivate.",
                               onDone: { Task { await load() } })
        }
    }

    @ViewBuilder private func group(_ title: String, _ rows: [JSON], manage: Bool) -> some View {
        if !rows.isEmpty {
            Section(title) {
                ForEach(rows.rows()) { s in
                    Button { editing = s.json } label: {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(AppState.shared.locale == .zh ? (s["nameZh"].nonEmpty ?? s["name"].str) : s["name"].str).font(.body.weight(.medium)).foregroundStyle(.primary)
                                if let d = s["description"].nonEmpty { Text(d).font(.caption).foregroundStyle(.secondary) }
                                HStack(spacing: 6) {
                                    Tag(text: s["category"].str)
                                    Text(Fmt.minsToLabel(s["durationMin"].i)).font(.caption).foregroundStyle(.secondary)
                                    Text("materials \(Fmt.moneyUI(s["materialCostCents"].i))").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            MoneyText(cents: s["priceCents"].i).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                        }
                        .opacity(s["active"].truthy ? 1 : 0.5)
                    }
                    .swipeActions {
                        if manage {
                            Button(t("common.delete"), role: .destructive) { deleting = s.json }.tint(.red)
                            Button(s["active"].truthy ? "Deactivate" : "Reactivate") { Task { await setActive(s.json, !s["active"].truthy) } }.tint(.orange)
                        }
                    }
                }
            }
        }
    }

    private func load() async {
        do { data = try await API.shared.call("services.list", ["includeInactive": true]).array; error = nil }
        catch { self.error = error.localizedDescription }
    }

    private func setActive(_ sv: JSON, _ active: Bool) async {
        do {
            try await API.shared.call("services.update", ["serviceId": .string(sv.id), "active": .bool(active)])
            toast(active ? "\(sv["name"].str) reactivated" : "\(sv["name"].str) deactivated — existing bookings keep their price")
            await load()
        } catch { toast(humanError(error.localizedDescription), error: true) }
    }
}

struct ServiceFormView: View {
    let initial: JSON?
    let onDone: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var nameZh = ""
    @State private var category = "Residential"
    @State private var price = ""
    @State private var durationMin = "120"
    @State private var material = ""
    @State private var isAddon = false
    @State private var description = ""
    @State private var active = true
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(t("common.name"), text: $name)
                    TextField("名称 (中文)", text: $nameZh)
                    Picker("Category", selection: $category) {
                        ForEach(["Residential", "Commercial", "Specialty", "Add-on", "General"], id: \.self) { Text($0).tag($0) }
                    }
                    LabeledField(label: "\(t("common.duration")) (minutes)", text: $durationMin, keyboard: .numberPad)
                }
                Section {
                    MoneyField(label: t("common.price"), text: $price, placeholder: "150.00")
                    MoneyField(label: "Material cost", text: $material, placeholder: "15.00")
                }
                Section("Description (\(t("common.optional")))") { TextField("Description", text: $description, axis: .vertical).lineLimit(2...4) }
                Section {
                    if initial != nil { Toggle("Active", isOn: $active) } else { Toggle("This is an add-on", isOn: $isAddon) }
                }
            }
            .navigationTitle(initial != nil ? "\(t("common.edit")) service" : "New service")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(busy ? t("common.saving") : t("common.save")) { Task { await save() } }.disabled(busy) }
            }
            .onAppear {
                if let i = initial {
                    name = i["name"].str; nameZh = i["nameZh"].str; category = i["category"].str
                    price = Fmt.fixed2(i["priceCents"].i); durationMin = String(i["durationMin"].i)
                    material = Fmt.fixed2(i["materialCostCents"].i); isAddon = i["isAddon"].truthy
                    description = i["description"].str; active = i["active"].truthy
                }
            }
        }
    }

    private func save() async {
        if name.trimmingCharacters(in: .whitespaces).isEmpty { return toast("Name is required", error: true) }
        busy = true
        let n = Fmt.jsNumber(durationMin)
        var payload: JSON = ["name": .string(name), "category": .string(category), "priceCents": .number(Double(Fmt.toCents(price))),
                             "durationMin": .number((n.isNaN || n == 0) ? 120 : n), "materialCostCents": .number(Double(Fmt.toCents(material)))]
        payload.set("nameZh", .orOmit(nameZh)); payload.set("description", .orOmit(description))
        do {
            if let i = initial {
                payload.set("serviceId", .string(i.id)); payload.set("active", .bool(active))
                try await API.shared.call("services.update", payload)
            } else {
                payload.set("isAddon", .bool(isAddon))
                try await API.shared.call("services.create", payload)
            }
            toast(initial != nil ? "Service updated" : "Service created")
            await onDone(); dismiss()
        } catch { toast(error.localizedDescription, error: true) }
        busy = false
    }
}
