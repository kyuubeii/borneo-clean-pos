import SwiftUI

// MARK: - New booking (BookingForm.tsx)

/// Customer → services → when → cleaners, exactly as the web form sends it.
struct BookingFormView: View {
    var presetCustomerId: String? = nil
    var presetStart: Date? = nil
    var onDone: () -> Void = {}
    @Environment(\.dismiss) private var dismiss

    @State private var services: [JSON] = []
    @State private var staff: [JSON] = []
    @State private var loadError: String?
    @State private var cust: JSON?
    @State private var avail: [JSON]?
    @State private var checking = false
    @State private var busy = false

    @State private var customerId = ""
    @State private var addressId = ""
    @State private var picked: [String] = []
    @State private var startAt = Fmt.nextHour()
    @State private var recurrence = "NONE"
    @State private var recurUntil = Fmt.addDays(Date(), 28)
    @State private var recurUntilSet = false
    @State private var staffIds: [String] = []
    @State private var notes = ""

    private var chosen: [JSON] { services.filter { picked.contains($0.id) } }
    private var duration: Int { chosen.reduce(0) { $0 + $1["durationMin"].i } }
    private var total: Int { chosen.reduce(0) { $0 + $1["priceCents"].i } }

    var body: some View {
        NavigationStack {
            Form {
                if let loadError { LoadErrorView(error: loadError) { Task { await loadLists() } } }
                Section(t("common.customer")) {
                    CustomerPicker(customerId: $customerId) { c in
                        if c?.id != cust?.id { addressId = "" }
                        cust = c
                    }
                    if cust != nil {
                        Picker(t("common.address"), selection: $addressId) {
                            Text("Primary address").tag("")
                            ForEach((cust?["addresses"].array ?? []).rows()) { a in
                                Text("\(a["label"].str) — \(a["line1"].str)").tag(a.id)
                            }
                        }
                    }
                }

                Section("Services") {
                    if services.isEmpty && loadError == nil { LoadingRow() }
                    ForEach(services.rows()) { s in
                        let on = picked.contains(s.id)
                        Button {
                            if on { picked.removeAll { $0 == s.id } } else { picked.append(s.id) }
                        } label: {
                            HStack {
                                Image(systemName: on ? "checkmark.circle.fill" : "circle").foregroundStyle(on ? Brand.b600 : Brand.ink300)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(s["name"].str).foregroundStyle(on ? Brand.b700 : .primary)
                                    Text("\(Fmt.minsToLabel(s["durationMin"].i))\(s["isAddon"].truthy ? " · add-on" : "")").font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                MoneyText(cents: s["priceCents"].i).font(.subheadline.weight(.medium)).foregroundStyle(on ? Brand.b700 : .secondary)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }

                Section {
                    DatePicker("\(t("common.date")) & \(t("common.time").lowercased())", selection: $startAt)
                    Picker("Repeat", selection: $recurrence) {
                        Text(t("bk.oneTime")).tag("NONE")
                        Text(t("bk.weekly")).tag("WEEKLY")
                        Text(t("bk.fortnightly")).tag("FORTNIGHTLY")
                        Text(t("bk.monthly")).tag("MONTHLY")
                    }
                    if recurrence != "NONE" {
                        Toggle("Repeat until a date", isOn: $recurUntilSet)
                        if recurUntilSet { DatePicker("Repeat until", selection: $recurUntil, displayedComponents: .date) }
                    }
                } footer: {
                    if recurrence != "NONE" && !recurUntilSet { Text("Without an end date, repeats are created up to 6 months ahead.") }
                }

                if duration > 0 {
                    Section {
                        ForEach(staff.rows()) { s in
                            let a = avail?.first { $0["staffId"].str == s.id }
                            let on = staffIds.contains(s.id)
                            Button {
                                if on { staffIds.removeAll { $0 == s.id } } else { staffIds.append(s.id) }
                            } label: {
                                HStack {
                                    Circle().fill(a.map { $0["available"].truthy ? Color.green : Color(.systemGray4) } ?? Color(css: s["colour"].str)).frame(width: 9, height: 9)
                                    Text(s["name"].str).foregroundStyle(on ? Brand.b700 : (a != nil && !(a!["available"].truthy) ? .secondary : .primary))
                                    Spacer()
                                    if let r = a?["reason"].string, !(a?["available"].truthy ?? false) { Text(r).font(.caption).foregroundStyle(.secondary) }
                                    if on { Image(systemName: "checkmark").foregroundStyle(Brand.b600) }
                                }
                            }
                            .buttonStyle(.plain)
                            .disabled(!on && (checking || !(a?["available"].truthy ?? false)))
                        }
                    } header: { Text("Assign cleaners") } footer: {
                        Text(checking ? "Checking availability…" : avail == nil ? "Availability could not be checked. Save without cleaners or change the time to retry." : "Unavailable cleaners cannot be assigned. You can leave this unassigned.")
                    }
                }

                Section("\(t("job.instructions")) (\(t("common.optional")))") {
                    TextField("Key with guardhouse, focus on kitchen…", text: $notes, axis: .vertical).lineLimit(2...5)
                }

                Section {
                    HStack {
                        Text("\(chosen.count) service\(chosen.count == 1 ? "" : "s") · \(Fmt.minsToLabel(duration))").foregroundStyle(.secondary)
                        Spacer()
                        MoneyText(cents: total).font(.headline)
                    }
                }
            }
            .navigationTitle("New booking")
            .navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled(busy)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(busy ? t("common.saving") : "Create") { Task { await submit() } }
                        .disabled(busy || loadError != nil || (checking && !staffIds.isEmpty))
                }
            }
            .task {
                if let p = presetCustomerId { customerId = p }
                startAt = Fmt.toMinute(presetStart ?? Fmt.nextHour())
                await loadLists()
            }
            .task(id: "\(startAt.timeIntervalSince1970)-\(duration)") { await checkAvailability() }
        }
    }

    private func loadLists() async {
        let r = await API.shared.batch([("services.list", [:]), ("staff.list", [:])])
        switch (r[0], r[1]) {
        case (.success(let a), .success(let b)): services = a.array; staff = b.array; loadError = nil
        case (.failure(let e), _), (_, .failure(let e)): loadError = e.localizedDescription
        }
    }

    /// Refresh who is free whenever the slot changes.
    private func checkAvailability() async {
        guard duration > 0 else { avail = nil; checking = false; return }
        checking = true; avail = nil
        do {
            let r = try await API.shared.call("staff.findAvailable", ["startAt": .string(Fmt.iso(Fmt.toMinute(startAt))), "durationMin": .number(Double(duration))])
            if !Task.isCancelled { avail = r.array }
        } catch { if !Task.isCancelled { avail = nil } }
        if !Task.isCancelled { checking = false }
    }

    private func submit() async {
        if customerId.isEmpty { return toast("Choose a customer", error: true) }
        if picked.isEmpty { return toast("Choose at least one service", error: true) }
        if staffIds.contains(where: { id in !(avail?.first { $0["staffId"].str == id }?["available"].truthy ?? false) }) {
            return toast("Choose available cleaners, or leave this booking unassigned", error: true)
        }
        busy = true
        var input: JSON = ["customerId": .string(customerId), "startAt": .string(Fmt.iso(Fmt.toMinute(startAt))),
                           "serviceIds": JSON(picked), "recurrence": .string(recurrence)]
        input.set("addressId", .orOmit(addressId))
        input.set("notes", .orOmit(notes))
        if recurrence != "NONE" && recurUntilSet {
            // `new Date(`${recurUntil}T23:59:59+08:00`).toISOString()`
            let ymd = Fmt.isoDate(recurUntil)
            if let d = ISO8601DateFormatter().date(from: "\(ymd)T23:59:59+08:00") { input.set("recurUntil", .string(Fmt.iso(d))) }
        }
        if !staffIds.isEmpty { input.set("staffIds", JSON(staffIds)) }
        do {
            let r = try await API.shared.call("bookings.create", input)
            let extra = r["recurringCreated"].i
            toast("Booking \(r["booking"]["ref"].str) created\(extra > 0 ? " + \(extra) repeats" : "")")
            onDone(); dismiss()
        } catch { toast(error.localizedDescription, error: true) }
        busy = false
    }
}

// MARK: - List (bookings/page.tsx)

/// A booking's value is the sum of its service lines; there is no stored total.
func bookingTotal(_ b: JSON) -> Int {
    b["totalCents"].int ?? b["items"].array.reduce(0) { $0 + $1["qty"].i * $1["priceCents"].i }
}

struct BookingsView: View {
    enum SortKey: String, CaseIterable { case ref, customer, date, total, status }
    @State private var app = AppState.shared
    @State private var creating = false
    @State private var page = 0
    @State private var query = ""
    @State private var from: Date?
    @State private var to: Date?
    @State private var status = ""
    @State private var scope = "all"
    @State private var sort = SortKey.date
    @State private var dir = 1
    @State private var data: [JSON]?
    @State private var error: String?
    @State private var loading = false
    @State private var deleting: JSON?
    @State private var showFilters = false

    var body: some View {
        let manage = app.user?.can(ADMIN_UP) == true
        List {
            Section {
                ChipPicker(options: [("upcoming", "Upcoming"), ("all", "All")], selection: $scope)
                    .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
            }
            LoadErrorView(error: error) { Task { await load() } }
            if data == nil && error == nil { LoadingRow() }
            else if data?.isEmpty == true { EmptyState(text: t("common.empty")) }
            ForEach((rows ?? []).rows()) { b in
                NavigationLink(value: Route.booking(b.id)) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text(b["ref"].str).font(.subheadline.weight(.semibold))
                            if (b["recurrence"].nonEmpty.map { $0 != "NONE" } ?? false) || b["parentId"].exists { Tag(text: "↻", bg: Color.purple.opacity(0.1), fg: .purple) }
                            Spacer()
                            StatusBadge(status: b["status"].str, label: t("bk.status.\(b["status"].str)"))
                        }
                        Text(b["customer"]["name"].str).font(.body.weight(.medium))
                        HStack {
                            Text("\(b["startAt"].date.map(Fmt.dateTime) ?? "") · \(Fmt.minsToLabel(b["durationMin"].i))").font(.caption).foregroundStyle(.secondary)
                            Spacer()
                            MoneyText(cents: bookingTotal(b.json)).font(.subheadline.weight(.medium))
                        }
                        let svc = b["items"].array.map(\.str).isEmpty ? "" : b["items"].array.map { $0["name"].str }.joined(separator: ", ")
                        if !svc.isEmpty { Text(svc).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                    }
                }
                .swipeActions {
                    if manage { Button(t("common.delete"), role: .destructive) { deleting = b.json }.tint(.red) }
                }
            }
            if let data, !data.isEmpty || page > 0 {
                Section {
                    HStack {
                        Button("Previous") { page -= 1 }.disabled(page == 0 || loading)
                        Spacer()
                        Text("Page \(page + 1) · Sorting applies to this page").font(.caption2).foregroundStyle(.secondary)
                        Spacer()
                        Button("Next") { page += 1 }.disabled(loading || data.count < 50)
                    }
                    .buttonStyle(.borderless)
                }
            }
        }
        .searchable(text: $query, prompt: "Search reference or customer…")
        .navigationTitle(t("nav.bookings"))
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Menu {
                    Picker("Sort", selection: $sort) {
                        Text("Ref").tag(SortKey.ref); Text(t("common.customer")).tag(SortKey.customer)
                        Text(t("common.date")).tag(SortKey.date); Text(t("common.total")).tag(SortKey.total)
                        Text(t("common.status")).tag(SortKey.status)
                    }
                    Picker("Direction", selection: $dir) { Text("Ascending").tag(1); Text("Descending").tag(-1) }
                } label: { Image(systemName: "arrow.up.arrow.down") }
                Button { showFilters = true } label: {
                    Image(systemName: (status.isEmpty && from == nil && to == nil) ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
                }
                Button { creating = true } label: { Image(systemName: "plus") }.accessibilityLabel(t("common.new"))
            }
        }
        .task(id: key) { if !query.isEmpty { try? await Task.sleep(nanoseconds: 250_000_000) }; await load() }
        .refreshable { await load() }
        .onChange(of: query) { page = 0 }
        .onChange(of: scope) { page = 0 }
        .onChange(of: status) { page = 0 }
        .sheet(isPresented: $creating) { BookingFormView(onDone: { Task { await load() } }) }
        .sheet(isPresented: $showFilters) { filters }
        .sheet(item: Binding(get: { deleting.map { Row($0) } }, set: { deleting = $0?.json })) { r in
            ConfirmDeleteSheet(title: "Delete booking record permanently", action: "bookings.delete", input: ["bookingId": .string(r.id)],
                               confirmText: r["ref"].str, confirmLabel: "the booking reference",
                               message: "Booking \(r["ref"].str) for \(r["customer"]["name"].str), its services and its job are removed for good. This cannot be undone and the booking will no longer appear in any report.\n\nIt is refused once the job has been invoiced, has time logged against it, has started, or heads a recurring series — cancel it instead in those cases.",
                               alternative: "Cancelling keeps the record and the reason, which is usually what you want. Use this only for a booking taken in error.",
                               onDone: { Task { await load() } })
        }
    }

    private var filters: some View {
        NavigationStack {
            Form {
                Picker(t("common.status"), selection: $status) {
                    Text("\(t("common.all")) \(t("common.status").lowercased())").tag("")
                    ForEach(["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED"], id: \.self) { Text(t("bk.status.\($0)")).tag($0) }
                }
                Section("Dates") {
                    OptionalDatePicker(label: t("common.from"), date: $from)
                    OptionalDatePicker(label: t("common.to"), date: $to)
                }
                Button("Clear filters") { status = ""; from = nil; to = nil }
            }
            .navigationTitle(t("common.filter"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(t("common.apply")) { page = 0; showFilters = false } } }
        }
        .presentationDetents([.medium])
    }

    private var key: String { "\(status)|\(scope)|\(from.map(Fmt.isoDate) ?? "")|\(to.map(Fmt.isoDate) ?? "")|\(query)|\(page)" }

    /// Sorted on the phone, as on the web: one page of rows, re-ordered in place.
    private var rows: [JSON]? {
        guard let data else { return nil }
        func v(_ b: JSON) -> (String, Double) {
            switch sort {
            case .ref: return (b["ref"].str, 0)
            case .customer: return (b["customer"]["name"].str.lowercased(), 0)
            case .total: return ("", Double(bookingTotal(b)))
            case .status: return (b["status"].str, 0)
            case .date: return ("", b["startAt"].date?.timeIntervalSince1970 ?? 0)
            }
        }
        return data.enumerated().sorted { a, b in
            let x = v(a.element), y = v(b.element)
            if x == y { return a.offset < b.offset }
            return (x < y) == (dir == 1)
        }.map(\.element)
    }

    private func load() async {
        loading = true
        var input: JSON = ["offset": .number(Double(page * 50)), "direction": .string(scope == "all" ? "desc" : "asc"), "limit": 50]
        input.set("status", .orOmit(status))
        if scope == "upcoming" { input.set("from", .string(Fmt.isoDate(Date()))) }
        if let from { input.set("from", .string(Fmt.isoDate(from))) }
        if let to { input.set("to", .string(Fmt.isoDate(to))) }
        input.set("query", .orOmit(query))
        do { data = try await API.shared.call("bookings.list", input).array; error = nil }
        catch { self.error = error.localizedDescription }
        loading = false
    }
}

struct OptionalDatePicker: View {
    let label: String
    @Binding var date: Date?
    var body: some View {
        if let d = date {
            HStack {
                DatePicker(label, selection: Binding(get: { d }, set: { date = $0 }), displayedComponents: .date)
                Button { date = nil } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }.buttonStyle(.plain)
            }
        } else {
            Button { date = Date() } label: { HStack { Text(label).foregroundStyle(.primary); Spacer(); Text("Any").foregroundStyle(.secondary) } }
        }
    }
}

// MARK: - Detail (bookings/[id]/page.tsx)

struct BookingDetailView: View {
    let id: String
    @State private var b: JSON?
    @State private var error: String?
    @State private var resched = false
    @State private var cancel = false
    @State private var edit = false

    var body: some View {
        List {
            if let error, b == nil { LoadErrorView(error: error) { Task { await load() } } }
            if b == nil && error == nil { LoadingRow() }
            if let b {
                let recurring = (b["recurrence"].nonEmpty.map { $0 != "NONE" } ?? false) || b["parentId"].exists
                Section {
                    HStack(spacing: 6) {
                        StatusBadge(status: b["status"].str, label: t("bk.status.\(b["status"].str)"))
                        if recurring { Tag(text: "↻ \(t("bk.recurring"))", bg: Color.purple.opacity(0.1), fg: .purple) }
                    }
                    KV(k: "\(t("common.date")) & \(t("common.time").lowercased())", v: b["startAt"].date.map(Fmt.dateTime) ?? "")
                    KV(k: t("common.duration"), v: Fmt.minsToLabel(b["durationMin"].i))
                    NavigationLink(value: Route.customer(b["customerId"].str)) { KV(k: t("common.customer"), v: b["customer"]["name"].str, tone: Brand.b600) }
                    let addr = b["address"].exists ? [b["address"]["line1"], b["address"]["city"]].compactMap(\.nonEmpty).joined(separator: ", ") : "—"
                    if addr != "—" { Button { openMaps(addr) } label: { KV(k: t("common.address"), v: addr) }.buttonStyle(.plain) }
                    else { KV(k: t("common.address"), v: "—") }
                }
                if let n = b["notes"].nonEmpty { Section(t("job.instructions")) { Text(n).font(.subheadline) } }
                if let r = b["cancelReason"].nonEmpty { Section { Text(r).font(.subheadline).foregroundStyle(.red) } }

                Section("Services") {
                    ForEach(b["items"].array.rows()) { i in
                        HStack {
                            Text("\(i["name"].str)\(i["qty"].i > 1 ? " ×\(i["qty"].i)" : "")").foregroundStyle(.secondary)
                            Spacer()
                            MoneyText(cents: i["qty"].i * i["priceCents"].i)
                        }
                    }
                    HStack { Text(t("common.total")).font(.body.weight(.medium)); Spacer(); MoneyText(cents: bookingTotal(b)).font(.headline) }
                }
                if b["job"].exists {
                    Section { NavigationLink(value: Route.job(b["job"]["id"].str)) { Label("View job \(b["job"]["ref"].str)", systemImage: "briefcase") } }
                }
            }
        }
        .navigationTitle(b?["ref"].str ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let b {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        // A past visit is exactly the one you need to correct, so editing
                        // is never hidden by the date.
                        Button { edit = true } label: { Label(t("common.edit"), systemImage: "pencil") }
                        Button { resched = true } label: { Label(t("bk.reschedule"), systemImage: "calendar.badge.clock") }
                        if b["status"].str != "CANCELLED" {
                            Button(role: .destructive) { cancel = true } label: { Label(t("bk.cancelBooking"), systemImage: "xmark.circle") }
                        }
                    } label: { Image(systemName: "ellipsis.circle") }
                }
            }
        }
        .loads(load)
        .sheet(isPresented: $edit) { if let b { BookingEditSheet(booking: b) { Task { await load() } } } }
        .sheet(isPresented: $resched) { if let b { BookingRescheduleSheet(booking: b) { Task { await load() } } } }
        .sheet(isPresented: $cancel) { if let b { BookingCancelSheet(booking: b) { Task { await load() } } } }
    }

    private func load() async {
        do { b = try await API.shared.call("bookings.get", ["bookingId": .string(id)]); error = nil }
        catch { self.error = error.localizedDescription }
    }
}

struct BookingRescheduleSheet: View {
    let booking: JSON
    var onDone: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var when = Date()
    @State private var reason = ""
    @State private var busy = false
    var body: some View {
        NavigationStack {
            Form {
                DatePicker("New date & time", selection: $when)
                TextField("Reason (\(t("common.optional")))", text: $reason)
                Section { Text("Only this visit moves. A recurring series keeps its other dates.").font(.footnote).foregroundStyle(.secondary) }
            }
            .navigationTitle(t("bk.reschedule"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(t("bk.reschedule")) { Task { await go() } }.disabled(busy) }
            }
            .onAppear { when = Fmt.toMinute(booking["startAt"].date ?? Date()); reason = "" }
        }
        .presentationDetents([.medium])
    }
    private func go() async {
        busy = true
        var input: JSON = ["bookingId": .string(booking.id), "startAt": .string(Fmt.iso(Fmt.toMinute(when)))]
        input.set("reason", .orOmit(reason))
        do { try await API.shared.call("bookings.reschedule", input); toast("Booking rescheduled"); onDone(); dismiss() }
        catch { toast(error.localizedDescription, error: true) }
        busy = false
    }
}

struct BookingCancelSheet: View {
    let booking: JSON
    var onDone: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var reason = ""
    @State private var whole = false
    @State private var busy = false
    var body: some View {
        let recurring = (booking["recurrence"].nonEmpty.map { $0 != "NONE" } ?? false) || booking["parentId"].exists
        NavigationStack {
            Form {
                Text("Cancel booking \(booking["ref"].str) for \(booking["customer"]["name"].str)?")
                TextField("Reason (\(t("common.optional")))", text: $reason)
                if recurring { Toggle("Also cancel all remaining future visits in this series", isOn: $whole) }
                Section {
                    Button(role: .destructive) { Task { await go() } } label: { HStack { Spacer(); Text(t("bk.cancelBooking")).bold(); Spacer() } }
                        .disabled(busy)
                }
            }
            .navigationTitle(t("bk.cancelBooking"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(t("common.back")) { dismiss() } } }
        }
        .presentationDetents([.medium])
    }
    private func go() async {
        busy = true
        var input: JSON = ["bookingId": .string(booking.id), "wholeSeries": .bool(whole)]
        input.set("reason", .orOmit(reason))
        do { try await API.shared.call("bookings.cancel", input); toast("Booking cancelled"); onDone(); dismiss() }
        catch { toast(error.localizedDescription, error: true) }
        busy = false
    }
}

/// Everything but the date (Reschedule) and the amount (corrected on the job).
struct BookingEditSheet: View {
    let booking: JSON
    var onDone: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var addresses: [JSON] = []
    @State private var durationMin = ""
    @State private var addressId = ""
    @State private var notes = ""
    @State private var internalNotes = ""
    @State private var status = ""
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledField(label: "\(t("common.duration")) (minutes)", text: $durationMin, keyboard: .numberPad)
                    Picker(t("common.status"), selection: $status) {
                        ForEach(["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED"], id: \.self) { Text(t("bk.status.\($0)")).tag($0) }
                    }
                    Picker(t("common.address"), selection: $addressId) {
                        Text("— none —").tag("")
                        ForEach(addresses.rows()) { a in Text([a["label"], a["line1"]].compactMap(\.nonEmpty).joined(separator: " · ")).tag(a.id) }
                    }
                }
                Section(t("job.instructions")) { TextField(t("job.instructions"), text: $notes, axis: .vertical).lineLimit(2...5) }
                Section("Internal notes") { TextField("Internal notes", text: $internalNotes, axis: .vertical).lineLimit(2...5) }
                Section {
                    Text("Date and time are changed with Reschedule." + (booking["job"].exists ? " The amount is corrected on job \(booking["job"]["ref"].str), so the invoice moves with it." : ""))
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("\(t("common.edit")) \(booking["ref"].str)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(busy ? t("common.saving") : t("common.save")) { Task { await go() } }.disabled(busy) }
            }
            .task {
                durationMin = String(booking["durationMin"].i); addressId = booking["addressId"].str
                notes = booking["notes"].str; internalNotes = booking["internalNotes"].str; status = booking["status"].str
                addresses = (try? await API.shared.call("customers.get", ["customerId": .string(booking["customerId"].str)]))?["addresses"].array ?? []
            }
        }
    }

    private func go() async {
        busy = true
        let n = Fmt.jsNumber(durationMin)
        let duration = (n.isNaN || n == 0) ? booking["durationMin"].i : Int(n)
        var input: JSON = ["bookingId": .string(booking.id), "durationMin": .number(Double(duration)), "status": .string(status),
                           "notes": .string(notes), "internalNotes": .string(internalNotes)]
        input.set("addressId", .orOmit(addressId))
        do { try await API.shared.call("bookings.update", input); toast("Booking updated"); onDone(); dismiss() }
        catch { toast(error.localizedDescription, error: true) }
        busy = false
    }
}
