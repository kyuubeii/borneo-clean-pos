import SwiftUI

// MARK: - Picker (CustomerPicker.tsx)

/// Search and choose a customer, or create one on the spot.
struct CustomerPicker: View {
    @Binding var customerId: String
    /// Called with the full customer record (addresses included) once chosen.
    var onSelected: (JSON?) -> Void = { _ in }
    var disabled = false

    @State private var selected: JSON?
    @State private var query = ""
    @State private var results: [JSON] = []
    @State private var loading = false
    @State private var error: String?
    @State private var creating = false

    var body: some View {
        Group {
            if let s = selected {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s["name"].str).font(.body.weight(.medium))
                        if let c = s["company"].nonEmpty { Text(c).font(.caption).foregroundStyle(.secondary) }
                    }
                    Spacer()
                    if !disabled { Button("Change") { customerId = ""; selected = nil; onSelected(nil) }.font(.subheadline) }
                }
            } else if !customerId.isEmpty {
                HStack { Text("Loading selected customer…").foregroundStyle(.secondary); Spacer(); ProgressView() }
            } else if !disabled {
                TextField("Search name, phone or company…", text: $query)
                    .autocorrectionDisabled()
                if let error { Text(humanError(error)).font(.caption).foregroundStyle(.red) }
                else if loading && results.isEmpty { Text("Loading customers…").font(.caption).foregroundStyle(.secondary) }
                else if results.isEmpty { Text("No matching customers.").font(.caption).foregroundStyle(.secondary) }
                ForEach(results.rows()) { c in
                    Button { customerId = c.id } label: {
                        HStack {
                            Text(c["name"].str).foregroundStyle(.primary)
                            Text(c["company"].nonEmpty ?? c["phone"].str).font(.caption).foregroundStyle(.secondary)
                            Spacer()
                        }
                    }
                }
                Button { creating = true } label: { Label("New customer", systemImage: "plus") }
            }
        }
        .task(id: query) {
            guard selected == nil, customerId.isEmpty else { return }
            try? await Task.sleep(nanoseconds: 200_000_000)
            await search()
        }
        .task(id: customerId) { await loadSelected() }
        .sheet(isPresented: $creating) {
            CustomerFormView(initial: nil) { c in
                if let c { customerId = c.id }
            }
        }
    }

    private func search() async {
        loading = true
        var input: JSON = ["limit": 20]
        input.set("query", JSON.orOmit(query))
        do { results = try await API.shared.call("customers.search", input).array; error = nil }
        catch { self.error = error.localizedDescription }
        loading = false
    }

    private func loadSelected() async {
        guard !customerId.isEmpty else { selected = nil; await search(); return }
        do {
            let c = try await API.shared.call("customers.get", ["customerId": .string(customerId)])
            selected = c
            onSelected(c)
        } catch { self.error = error.localizedDescription }
    }
}

// MARK: - Forms (CustomerForm.tsx)

/// Create when `initial` is nil, edit when it is there.
struct CustomerFormView: View {
    let initial: JSON?
    var onDone: (JSON?) -> Void = { _ in }
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var phone = ""
    @State private var email = ""
    @State private var company = ""
    @State private var line1 = ""
    @State private var city = "Kuching"
    @State private var notes = ""
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(t("common.name"), text: $name).textContentType(.name)
                    TextField(t("common.phone"), text: $phone).keyboardType(.phonePad).textContentType(.telephoneNumber)
                    TextField(t("common.email"), text: $email).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("Company (\(t("common.optional")))", text: $company)
                }
                if initial == nil {
                    Section(t("common.address")) {
                        TextField(t("common.address"), text: $line1).textContentType(.fullStreetAddress)
                        TextField("City", text: $city)
                    }
                }
                Section(t("common.notes")) {
                    TextField(t("common.notes"), text: $notes, axis: .vertical).lineLimit(2...5)
                }
                if initial != nil {
                    Section { Text("Emptying a box clears it. Service addresses are managed further down this customer’s page.").font(.footnote).foregroundStyle(.secondary) }
                }
            }
            .navigationTitle(initial.map { "Edit \($0["name"].str)" } ?? "\(t("common.new")) \(t("common.customer").lowercased())")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(busy ? t("common.saving") : initial != nil ? t("common.save") : t("common.create")) { Task { await save() } }
                        .disabled(busy)
                }
            }
            .onAppear {
                if let i = initial {
                    name = i["name"].str; phone = i["phone"].str; email = i["email"].str
                    company = i["company"].str; notes = i["notes"].str
                    line1 = i["addresses"][0]["line1"].str; city = i["addresses"][0]["city"].nonEmpty ?? "Kuching"
                }
            }
        }
    }

    private func save() async {
        if name.trimmingCharacters(in: .whitespaces).isEmpty { return toast("Name is required", error: true) }
        busy = true
        do {
            if let i = initial {
                // Blanks go as "" on purpose: the registry reads that as "clear this".
                let c = try await API.shared.call("customers.update", [
                    "customerId": .string(i.id), "name": .string(name.trimmingCharacters(in: .whitespaces)),
                    "phone": .string(phone), "email": .string(email), "company": .string(company), "notes": .string(notes),
                ])
                toast("Customer updated")
                onDone(c)
            } else {
                var input: JSON = ["name": .string(name.trimmingCharacters(in: .whitespaces))]
                input.set("phone", .orOmit(phone)); input.set("email", .orOmit(email))
                input.set("company", .orOmit(company)); input.set("notes", .orOmit(notes))
                if !line1.isEmpty { input.set("address", ["label": "Home", "line1": .string(line1), "city": .string(city)]) }
                let c = try await API.shared.call("customers.create", input)
                toast("Customer created")
                onDone(c)
            }
            dismiss()
        } catch { toast(humanError(error.localizedDescription), error: true) }
        busy = false
    }
}

/// Add an address when `initial` is nil, edit one when it is there.
struct AddressFormView: View {
    let customerId: String
    let initial: JSON?
    var onDone: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var label = "Site"
    @State private var line1 = ""
    @State private var line2 = ""
    @State private var city = "Kuching"
    @State private var state = "Sarawak"
    @State private var postcode = ""
    @State private var accessNotes = ""
    @State private var isPrimary = false
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledField(label: "Label", text: $label, placeholder: "Home, Office, Shop lot…")
                    TextField(t("common.address"), text: $line1).textContentType(.streetAddressLine1)
                    TextField("Address line 2 (\(t("common.optional")))", text: $line2).textContentType(.streetAddressLine2)
                    LabeledField(label: "City", text: $city)
                    LabeledField(label: "State", text: $state)
                    LabeledField(label: "Postcode", text: $postcode, keyboard: .numberPad)
                }
                Section {
                    TextField("Access notes", text: $accessNotes, axis: .vertical).lineLimit(2...4)
                } footer: { Text("Gate code, where the key is, which dog bites.") }
                Section {
                    if initial?["isPrimary"].truthy == true {
                        Text("This is the primary address. To move that, tick the box on the one that should have it.").font(.footnote).foregroundStyle(.secondary)
                    } else {
                        Toggle("Make this the primary address", isOn: $isPrimary)
                    }
                }
            }
            .navigationTitle(initial.map { "Edit \($0["label"].str)" } ?? "Add a service address")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(busy ? t("common.saving") : initial != nil ? t("common.save") : t("common.add")) { Task { await save() } }.disabled(busy)
                }
            }
            .onAppear {
                if let i = initial {
                    label = i["label"].nonEmpty ?? "Site"; line1 = i["line1"].str; line2 = i["line2"].str
                    city = i["city"].str; state = i["state"].str; postcode = i["postcode"].str
                    accessNotes = i["accessNotes"].str; isPrimary = i["isPrimary"].truthy
                }
            }
        }
    }

    private func save() async {
        if line1.trimmingCharacters(in: .whitespaces).isEmpty { return toast("The street address is required", error: true) }
        if label.trimmingCharacters(in: .whitespaces).isEmpty { return toast("Give the address a label, e.g. Home or Office", error: true) }
        busy = true
        do {
            if let i = initial {
                var input: JSON = ["addressId": .string(i.id), "label": .string(label.trimmingCharacters(in: .whitespaces)),
                                   "line1": .string(line1.trimmingCharacters(in: .whitespaces)), "line2": .string(line2),
                                   "city": .string(city), "state": .string(state), "postcode": .string(postcode), "accessNotes": .string(accessNotes)]
                if isPrimary && !i["isPrimary"].truthy { input.set("isPrimary", true) }
                try await API.shared.call("customers.updateAddress", input)
                toast("Address updated")
            } else {
                var input: JSON = ["customerId": .string(customerId), "label": .string(label.trimmingCharacters(in: .whitespaces)),
                                   "line1": .string(line1.trimmingCharacters(in: .whitespaces)), "isPrimary": .bool(isPrimary)]
                input.set("line2", .orOmit(line2)); input.set("city", .orOmit(city)); input.set("state", .orOmit(state))
                input.set("postcode", .orOmit(postcode)); input.set("accessNotes", .orOmit(accessNotes))
                try await API.shared.call("customers.addAddress", input)
                toast("Address added")
            }
            onDone(); dismiss()
        } catch { toast(humanError(error.localizedDescription), error: true) }
        busy = false
    }
}

// MARK: - List (customers/page.tsx)

struct CustomersView: View {
    @State private var app = AppState.shared
    @State private var q = ""
    @State private var data: [JSON]?
    @State private var error: String?
    @State private var creating = false
    @State private var editing: JSON?
    @State private var deleting: JSON?
    @State private var busyId: String?

    var body: some View {
        let canEdit = app.user?.can(ADMIN_UP) == true
        let canDelete = app.user?.can(OWNER_ONLY) == true
        List {
            LoadErrorView(error: error) { Task { await load() } }
            if data == nil && error == nil { LoadingRow() }
            else if data?.isEmpty == true { EmptyState(text: t("common.empty")) }
            ForEach((data ?? []).rows()) { c in
                NavigationLink(value: Route.customer(c.id)) {
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Text(c["name"].str).font(.body.weight(.medium))
                            if c["active"].bool == false { Tag(text: "INACTIVE") }
                        }
                        if let co = c["company"].nonEmpty { Text(co).font(.caption).foregroundStyle(.secondary) }
                        HStack(spacing: 10) {
                            if let p = c["phone"].nonEmpty { Label(p, systemImage: "phone").monospacedDigit() }
                            if let a = c["addresses"][0]["line1"].nonEmpty {
                                Label(a + (c["addresses"].array.count > 1 ? " +\(c["addresses"].array.count - 1)" : ""), systemImage: "mappin")
                            }
                        }
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                .swipeActions(edge: .trailing) {
                    if canDelete { Button(t("common.delete"), role: .destructive) { deleting = c.json }.tint(.red) }
                    if canEdit {
                        Button(c["active"].bool == false ? "Reactivate" : "Deactivate") { Task { await setActive(c.json, c["active"].bool == false) } }.tint(.orange)
                    }
                }
                .swipeActions(edge: .leading) {
                    if canEdit { Button(t("common.edit")) { editing = c.json }.tint(Brand.b600) }
                }
                .opacity(busyId == c.id ? 0.5 : 1)
            }
        }
        .searchable(text: $q, prompt: "\(t("common.search"))…")
        .navigationTitle(t("nav.customers"))
        .toolbar {
            ToolbarItem(placement: .primaryAction) { Button { creating = true } label: { Image(systemName: "plus") }.accessibilityLabel(t("common.new")) }
        }
        .task(id: q) { try? await Task.sleep(nanoseconds: 250_000_000); await load() }
        .refreshable { await load() }
        .sheet(isPresented: $creating) { CustomerFormView(initial: nil) { _ in Task { await load() } } }
        .sheet(item: Binding(get: { editing.map { Row($0) } }, set: { editing = $0?.json })) { r in
            CustomerFormView(initial: r.json) { _ in Task { await load() } }
        }
        .sheet(item: Binding(get: { deleting.map { Row($0) } }, set: { deleting = $0?.json })) { r in
            ConfirmDeleteSheet(title: "Delete customer permanently", action: "customers.delete", input: ["customerId": .string(r.id)],
                               confirmText: r["name"].str, confirmLabel: "the customer’s name",
                               message: "\(r["name"].str) and their saved addresses are removed for good. This cannot be undone.\n\nIt only works for a customer with no bookings, jobs or invoices. Once there is any history, the record has to stay so past work and takings still add up.",
                               alternative: "To stop them appearing on new bookings without losing anything, close this and use Deactivate.",
                               onDone: { Task { await load() } })
        }
    }

    private func load() async {
        var input: JSON = ["limit": 50, "includeInactive": true]
        input.set("query", .orOmit(q))
        do { data = try await API.shared.call("customers.search", input).array; error = nil }
        catch { self.error = error.localizedDescription }
    }

    private func setActive(_ c: JSON, _ active: Bool) async {
        busyId = c.id
        do {
            try await API.shared.call("customers.update", ["customerId": .string(c.id), "active": .bool(active)])
            toast(active ? "\(c["name"].str) reactivated" : "\(c["name"].str) deactivated — history kept")
            await load()
        } catch { toast(humanError(error.localizedDescription), error: true) }
        busyId = nil
    }
}

// MARK: - Detail (customers/[id]/page.tsx)

struct CustomerDetailView: View {
    let id: String
    @State private var app = AppState.shared
    @State private var c: JSON?
    @State private var error: String?
    @State private var editing = false
    @State private var addingAddress = false
    @State private var editingAddress: JSON?
    @State private var deletingAddress: JSON?
    @State private var busyId: String?
    @State private var newBooking = false

    var body: some View {
        let canEdit = app.user?.can(ADMIN_UP) == true
        List {
            if let error, c == nil { LoadErrorView(error: error) { Task { await load() } } }
            if c == nil && error == nil { LoadingRow() }
            if let c {
                if c["active"].bool == false {
                    Callout(text: "Deactivated. Everything here is kept, but this customer no longer appears when you start a new booking or quote.", tone: .normal)
                        .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                }
                Section("Contact") {
                    if let p = c["phone"].nonEmpty {
                        Button { call(p) } label: { KV(k: t("common.phone"), v: p, tone: Brand.b600) }
                    } else { KV(k: t("common.phone"), v: "—") }
                    KV(k: t("common.email"), v: c["email"].nonEmpty ?? "—")
                    KV(k: "Customer since", v: c["createdAt"].date.map(Fmt.date) ?? "—")
                    KV(k: "Lifetime paid", v: Fmt.moneyUI(totalPaid(c)))
                    KV(k: t("dash.outstanding"), v: Fmt.moneyUI(outstanding(c)), tone: outstanding(c) > 0 ? Brand.warn : nil)
                    if let n = c["notes"].nonEmpty { Text(n).font(.footnote).foregroundStyle(.secondary) }
                }

                Section {
                    let addresses = c["addresses"].array.sorted { ($0["isPrimary"].truthy ? 1 : 0) > ($1["isPrimary"].truthy ? 1 : 0) }
                    if addresses.isEmpty { Text("No address on file yet").foregroundStyle(.secondary) }
                    ForEach(addresses.rows()) { a in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 6) {
                                Text(a["label"].str).font(.subheadline.weight(.semibold))
                                if a["isPrimary"].truthy { Tag(text: "Primary", bg: Brand.b50, fg: Brand.b600) }
                            }
                            let line = [a["line1"], a["line2"], a["city"], a["postcode"], a["state"]].compactMap(\.nonEmpty).joined(separator: ", ")
                            Button { openMaps(line) } label: { Text(line).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.leading) }
                                .buttonStyle(.plain)
                            if let n = a["accessNotes"].nonEmpty { Label(n, systemImage: "key").font(.caption).foregroundStyle(.secondary) }
                        }
                        .swipeActions(edge: .trailing) {
                            if canEdit {
                                Button(t("common.delete"), role: .destructive) { deletingAddress = a.json }.tint(.red)
                                Button(t("common.edit")) { editingAddress = a.json }.tint(Brand.b600)
                            }
                        }
                        .contextMenu {
                            if canEdit {
                                if !a["isPrimary"].truthy { Button("Make primary") { Task { await makePrimary(a.json) } } }
                                Button(t("common.edit")) { editingAddress = a.json }
                                Button("Remove", role: .destructive) { deletingAddress = a.json }
                            }
                        }
                        .opacity(busyId == a.id ? 0.5 : 1)
                    }
                } header: {
                    HStack { Text("Service addresses"); Spacer(); if canEdit { Button(t("common.add")) { addingAddress = true }.font(.caption) } }
                } footer: { if canEdit && !c["addresses"].array.isEmpty { Text("Swipe or press and hold an address to edit it or make it primary.") } }

                Section("\(t("nav.jobs")) (\(c["jobs"].array.count))") {
                    if c["jobs"].array.isEmpty { Text(t("common.empty")).foregroundStyle(.secondary) }
                    ForEach(Array(c["jobs"].array.prefix(10)).rows()) { j in
                        NavigationLink(value: Route.job(j.id)) {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(j["ref"].str).font(.subheadline.weight(.medium))
                                    Text(j["scheduledAt"].date.map(Fmt.dateTime) ?? "").font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                VStack(alignment: .trailing, spacing: 3) {
                                    MoneyText(cents: j["revenueCents"].i).font(.caption).foregroundStyle(.secondary)
                                    StatusBadge(status: j["status"].str, label: t("job.status.\(j["status"].str)"))
                                }
                            }
                        }
                    }
                }

                Section("\(t("nav.invoices")) (\(c["invoices"].array.count))") {
                    if c["invoices"].array.isEmpty { Text(t("common.empty")).foregroundStyle(.secondary) }
                    ForEach(Array(c["invoices"].array.prefix(10)).rows()) { i in
                        NavigationLink(value: Route.invoice(i.id)) {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(i["ref"].str).font(.subheadline.weight(.medium))
                                    Text(i["issuedAt"].date.map(Fmt.date) ?? "").font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                VStack(alignment: .trailing, spacing: 3) {
                                    MoneyText(cents: invoiceSub(i.json)).font(.caption).foregroundStyle(.secondary)
                                    StatusBadge(status: i["status"].str, label: t("inv.status.\(i["status"].str)"))
                                }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle(c?["name"].str ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let c, canEdit {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button { editing = true } label: { Label(t("common.edit"), systemImage: "pencil") }
                        Button { newBooking = true } label: { Label("New booking", systemImage: "calendar.badge.plus") }
                        Button { Task { await setActive(c["active"].bool == false) } } label: {
                            Label(c["active"].bool == false ? "Reactivate" : "Deactivate", systemImage: c["active"].bool == false ? "arrow.uturn.backward" : "pause.circle")
                        }
                    } label: { Image(systemName: "ellipsis.circle") }
                }
            }
        }
        .loads(load)
        .sheet(isPresented: $editing) { if let c { CustomerFormView(initial: c) { _ in Task { await load() } } } }
        .sheet(isPresented: $addingAddress) { AddressFormView(customerId: id, initial: nil) { Task { await load() } } }
        .sheet(isPresented: $newBooking) { BookingFormView(presetCustomerId: id, onDone: { Task { await load() } }) }
        .sheet(item: Binding(get: { editingAddress.map { Row($0) } }, set: { editingAddress = $0?.json })) { r in
            AddressFormView(customerId: id, initial: r.json) { Task { await load() } }
        }
        .sheet(item: Binding(get: { deletingAddress.map { Row($0) } }, set: { deletingAddress = $0?.json })) { r in
            ConfirmDeleteSheet(title: "Remove this address", action: "customers.deleteAddress", input: ["addressId": .string(r.id)], verb: "Remove",
                               message: "\(r["label"].str) — \(r["line1"].str) — is removed from \(c?["name"].str ?? "")’s record.\n\nIt only works while nothing points at it. Once a booking or a job has happened there, the address has to stay so past work still says where it was done — edit it instead.",
                               onDone: { Task { await load() } })
        }
    }

    /// customers/[id] "Lifetime paid": payments less refunds.
    private func totalPaid(_ c: JSON) -> Int {
        c["payments"].array.reduce(0) { $0 + ($1["isRefund"].truthy ? -$1["amountCents"].i : $1["amountCents"].i) }
    }

    /// customers/[id] "Outstanding", exactly as the page adds it up: line items
    /// less discount (no tax), less what was paid, never below zero, VOID skipped.
    private func outstanding(_ c: JSON) -> Int {
        c["invoices"].array.reduce(0) { a, i in
            let sub = invoiceSub(i)
            let paid = i["payments"].array.reduce(0) { $0 + ($1["isRefund"].truthy ? -$1["amountCents"].i : $1["amountCents"].i) }
            return i["status"].str == "VOID" ? a : a + max(0, sub - paid)
        }
    }

    private func invoiceSub(_ i: JSON) -> Int {
        i["items"].array.reduce(0) { $0 + $1["qty"].i * $1["priceCents"].i } - i["discountCents"].i
    }

    private func load() async {
        do { c = try await API.shared.call("customers.get", ["customerId": .string(id)]); error = nil }
        catch { self.error = error.localizedDescription }
    }

    private func makePrimary(_ a: JSON) async {
        busyId = a.id
        do {
            try await API.shared.call("customers.updateAddress", ["addressId": .string(a.id), "isPrimary": true])
            toast("\(a["label"].str) is now the primary address")
            await load()
        } catch { toast(humanError(error.localizedDescription), error: true) }
        busyId = nil
    }

    private func setActive(_ active: Bool) async {
        guard let c else { return }
        do {
            try await API.shared.call("customers.update", ["customerId": .string(c.id), "active": .bool(active)])
            toast(active ? "\(c["name"].str) reactivated" : "\(c["name"].str) deactivated — history kept")
            await load()
        } catch { toast(humanError(error.localizedDescription), error: true) }
    }
}
