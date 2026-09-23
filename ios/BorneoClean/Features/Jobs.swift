import SwiftUI
import PhotosUI

// MARK: - List (jobs/page.tsx)

struct JobsView: View {
    @State private var range = "week"
    @State private var status = ""
    @State private var data: [JSON]?
    @State private var error: String?

    private static let ranges: [(String, String)] = [("today", "common.today"), ("week", "cal.week"), ("past", "common.past30"), ("all", "common.all")]

    var body: some View {
        List {
            Section {
                ChipPicker(options: Self.ranges.map { ($0.0, t($0.1)) }, selection: $range)
                    .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
            }
            LoadErrorView(error: error) { Task { await load() } }
            if data == nil && error == nil { LoadingRow() }
            else if data?.isEmpty == true { EmptyState(text: t("common.empty")) }
            ForEach((data ?? []).rows()) { j in
                NavigationLink(value: Route.job(j.id)) { JobRow(j: j) }
            }
        }
        .navigationTitle(t("nav.jobs"))
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Menu {
                    Picker(t("common.status"), selection: $status) {
                        Text("\(t("common.all")) \(t("common.status").lowercased())").tag("")
                        ForEach(["SCHEDULED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED", "CANCELLED"], id: \.self) { Text(t("job.status.\($0)")).tag($0) }
                    }
                } label: { Image(systemName: status.isEmpty ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill") }
            }
            ShellToolbar()
        }
        .task(id: "\(range)|\(status)") { await load() }
        .refreshable { await load() }
        .onChange(of: AppState.shared.refreshTick) { Task { await load() } }
    }

    private func load() async {
        let now = Date()
        var input: JSON = ["limit": 100]
        switch range {
        case "today": input.set("from", .string(Fmt.isoDate(now))); input.set("to", .string(Fmt.isoDate(now)))
        case "week": input.set("from", .string(Fmt.isoDate(now))); input.set("to", .string(Fmt.isoDate(Fmt.addDays(now, 7))))
        case "past": input.set("from", .string(Fmt.isoDate(Fmt.addDays(now, -30)))); input.set("to", .string(Fmt.isoDate(now)))
        default: break
        }
        input.set("status", .orOmit(status))
        do { data = try await API.shared.call("jobs.list", input).array; error = nil }
        catch { self.error = error.localizedDescription }
    }
}

struct JobRow: View {
    let j: Row
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(j["customer"].str).font(.body.weight(.semibold)).lineLimit(1)
                    Text("\(j["scheduledAt"].date.map(Fmt.dateTime) ?? "") · \(Fmt.minsToLabel(j["durationMin"].i))").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                StatusBadge(status: j["status"].str, label: t("job.status.\(j["status"].str)"))
            }
            if let a = j["address"].nonEmpty { Label(a, systemImage: "mappin").font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            HStack {
                let cl = j["cleaners"].array.map(\.str)
                Text(cl.isEmpty ? t("cal.unassigned") : cl.joined(separator: ", ")).font(.caption).foregroundStyle(cl.isEmpty ? Brand.warn : .secondary).lineLimit(1)
                Spacer()
                Text(j["ref"].str).font(.caption2).foregroundStyle(.tertiary)
                MoneyText(cents: j["revenueCents"].i).font(.subheadline.weight(.medium))
            }
        }
        .padding(.vertical, 2)
    }
}

// MARK: - Detail (jobs/[id]/page.tsx)

private let NEXT: [String: String] = ["SCHEDULED": "EN_ROUTE", "EN_ROUTE": "IN_PROGRESS", "IN_PROGRESS": "COMPLETED"]

struct JobDetailView: View {
    let id: String
    @State private var app = AppState.shared
    @State private var j: JSON?
    @State private var costing: JSON?
    @State private var error: String?
    @State private var busy = false
    @State private var sheet: Sheet?
    @State private var newChecklist = ""
    @State private var photoToDelete: JSON?
    @State private var viewing: JSON?

    enum Sheet: String, Identifiable { case assign, resched, notes, price, move, costing; var id: String { rawValue } }

    var body: some View {
        let isStaff = app.user?.isStaff == true
        List {
            if let error, j == nil { LoadErrorView(error: error) { Task { await load() } } }
            if j == nil && error == nil { LoadingRow() }
            if let j {
                header(j, isStaff: isStaff)
                checklist(j)
                PhotosSection(job: j, canDelete: !isStaff, onDone: { await load() }, onView: { viewing = $0 }, onDelete: { photoToDelete = $0 })
                notesSection(j)
                cleaners(j, isStaff: isStaff)
                if let c = costing { costingSection(c, isStaff: isStaff) }
            }
        }
        .navigationTitle(j?["ref"].str ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { if let j { ToolbarItem(placement: .primaryAction) { actionsMenu(j, isStaff: isStaff) } } }
        .loads(load)
        .sheet(item: $sheet) { s in
            if let j {
                switch s {
                case .assign: AssignSheet(job: j) { await load() }
                case .resched: JobRescheduleSheet(job: j) { await load() }
                case .notes: JobNotesSheet(job: j) { await load() }
                case .price: PriceSheet(job: j) { await load() }
                case .move: MoveCustomerSheet(job: j) { await load() }
                case .costing: if let c = costing { CostingSheet(job: j, costing: c) { await load() } }
                }
            }
        }
        .confirmationDialog("Remove this photo?", isPresented: Binding(get: { photoToDelete != nil }, set: { if !$0 { photoToDelete = nil } }), titleVisibility: .visible) {
            Button("Remove", role: .destructive) { if let p = photoToDelete { Task { await removePhoto(p) } } }
        } message: {
            Text("Remove this \(photoToDelete?["kind"].str.lowercased() ?? "") photo from \(j?["ref"].str ?? "")?")
        }
        .fullScreenCover(item: Binding(get: { viewing.map { Row($0) } }, set: { viewing = $0?.json })) { p in PhotoViewer(photo: p.json) }
    }

    // MARK: Sections

    @ViewBuilder private func header(_ j: JSON, isStaff: Bool) -> some View {
        Section {
            HStack(spacing: 6) {
                StatusBadge(status: j["status"].str, label: t("job.status.\(j["status"].str)"))
                if j["invoice"].exists {
                    if isStaff { Tag(text: j["invoice"]["ref"].str, bg: Brand.b50, fg: Brand.b600) }
                    else { NavigationLink(value: Route.invoice(j["invoice"]["id"].str)) { Tag(text: j["invoice"]["ref"].str, bg: Brand.b50, fg: Brand.b600) } }
                }
            }
            Text(j["scheduledAt"].date.map(Fmt.dateTime) ?? "").font(.subheadline)
            if isStaff { KV(k: t("common.customer"), v: j["customer"]["name"].str) }
            else { NavigationLink(value: Route.customer(j["customerId"].str)) { KV(k: t("common.customer"), v: j["customer"]["name"].str, tone: Brand.b600) } }
            if let p = j["customer"]["phone"].nonEmpty { Button { call(p) } label: { KV(k: t("common.phone"), v: p, tone: Brand.b600) } }
            else { KV(k: t("common.phone"), v: "—") }
            let addr = j["address"].exists ? [j["address"]["line1"], j["address"]["line2"], j["address"]["city"], j["address"]["postcode"]].compactMap(\.nonEmpty).joined(separator: ", ") : ""
            if !addr.isEmpty { Button { openMaps(addr) } label: { KV(k: t("common.address"), v: addr, tone: Brand.b600) } }
            else { KV(k: t("common.address"), v: "—") }
            KV(k: t("common.duration"), v: Fmt.minsToLabel(j["durationMin"].i))
            if let n = j["address"]["accessNotes"].nonEmpty { Label(n, systemImage: "key").font(.footnote).foregroundStyle(.secondary) }
            if let ins = j["customerInstructions"].nonEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    Text(t("job.instructions")).font(.caption.weight(.semibold))
                    Text(ins).font(.footnote)
                }
                .foregroundStyle(Color(hex: 0x78350F))
                .listRowBackground(Color(hex: 0xFFFBEB))
            }
            primaryActions(j)
        }
    }

    @ViewBuilder private func primaryActions(_ j: JSON) -> some View {
        let s = j["status"].str
        if let next = NEXT[s] {
            Button {
                Task { await run("Marked \(t("job.status.\(next)"))") { try await API.shared.call("jobs.updateStatus", ["jobId": .string(id), "status": .string(next)]) } }
            } label: {
                Label(s == "IN_PROGRESS" ? t("job.complete") : "→ \(t("job.status.\(next)"))", systemImage: s == "IN_PROGRESS" ? "checkmark.seal" : "arrow.right.circle")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent).controlSize(.large).disabled(busy)
            .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
        }
        if s == "COMPLETED" && !j["invoiceId"].exists && app.user?.adminUp == true {
            Button {
                Task {
                    busy = true
                    do {
                        let r = try await API.shared.call("invoices.createFromJob", ["jobId": .string(id)])
                        toast("Invoice created")
                        await load()
                        Router.shared.push(.invoice(r["invoiceId"].str))
                    } catch { toast(error.localizedDescription, error: true) }
                    busy = false
                }
            } label: { Label("Create invoice", systemImage: "doc.badge.plus").frame(maxWidth: .infinity) }
            .buttonStyle(.borderedProminent).controlSize(.large).disabled(busy)
            .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
        }
    }

    @ViewBuilder private func checklist(_ j: JSON) -> some View {
        let items = j["checklist"].array
        let done = items.filter { $0["done"].truthy }.count
        Section {
            if items.isEmpty { Text(t("common.empty")).foregroundStyle(.secondary) }
            ForEach(items.rows()) { c in
                Button {
                    Task { await run("Updated") { try await API.shared.call("jobs.toggleChecklistItem", ["itemId": .string(c.id), "done": .bool(!c["done"].truthy)]) } }
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: c["done"].truthy ? "checkmark.square.fill" : "square").foregroundStyle(c["done"].truthy ? Brand.b600 : Brand.ink300).font(.title3)
                        Text(c["label"].str).strikethrough(c["done"].truthy).foregroundStyle(c["done"].truthy ? .secondary : .primary)
                    }
                }
                .buttonStyle(.plain).disabled(busy)
            }
            HStack {
                TextField("Add an item", text: $newChecklist).submitLabel(.done).onSubmit { Task { await addChecklist() } }
                if !newChecklist.trimmingCharacters(in: .whitespaces).isEmpty {
                    Button(t("common.add")) { Task { await addChecklist() } }.disabled(busy)
                }
            }
        } header: { HStack { Text(t("job.checklist")); Spacer(); Text("\(done)/\(items.count)") } }
    }

    @ViewBuilder private func notesSection(_ j: JSON) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 3) {
                Text(t("job.internalNotes")).font(.caption).foregroundStyle(.secondary)
                Text(j["internalNotes"].nonEmpty ?? "—")
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(t("job.staffNotes")).font(.caption).foregroundStyle(.secondary)
                Text(j["staffNotes"].nonEmpty ?? "—")
            }
        } header: {
            HStack { Text(t("common.notes")); Spacer(); Button(t("common.edit")) { sheet = .notes }.font(.caption) }
        }
    }

    @ViewBuilder private func cleaners(_ j: JSON, isStaff: Bool) -> some View {
        Section {
            let assignments = j["assignments"].array
            if assignments.isEmpty { Text(t("cal.unassigned")).foregroundStyle(Brand.warn) }
            ForEach(assignments.rows()) { a in
                let mine = j["timeEntries"].array.filter { $0["staffId"].str == a["staffId"].str }
                let mins = mine.reduce(0.0) { x, e in
                    guard let s = e["startAt"].date, let en = e["endAt"].date else { return x }
                    return x + en.timeIntervalSince(s) / 60
                }
                let isOpen = mine.contains { !$0["endAt"].exists }
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 10) {
                        Avatar(name: a["staff"]["name"].str, colour: a["staff"]["colour"].str)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(a["staff"]["name"].str).font(.subheadline.weight(.medium))
                            Text("\(a["isLead"].truthy ? "Lead · " : "")\(Fmt.minsToLabel(Int(Fmt.jsRound(mins)))) tracked").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if isOpen { Tag(text: "On site", bg: Color(hex: 0xDBEAFE), fg: Color(hex: 0x1D4ED8)) }
                    }
                    if j["status"].str != "COMPLETED" && j["status"].str != "CANCELLED" {
                        Button {
                            Task { await run(isOpen ? "Checked out" : "Checked in") {
                                try await API.shared.call(isOpen ? "staff.checkOut" : "staff.checkIn", ["jobId": .string(id), "staffId": a["staffId"]])
                            } }
                        } label: { Text(isOpen ? t("job.checkOut") : t("job.checkIn")).frame(maxWidth: .infinity) }
                        .buttonStyle(isOpen ? AnyPrimitiveButtonStyle(.bordered) : AnyPrimitiveButtonStyle(.borderedProminent))
                        .disabled(busy)
                    }
                }
                .padding(.vertical, 2)
            }
        } header: {
            HStack { Text(t("job.cleaners")); Spacer(); if !isStaff { Button(t("common.edit")) { sheet = .assign }.font(.caption) } }
        }
    }

    @ViewBuilder private func costingSection(_ c: JSON, isStaff: Bool) -> some View {
        Section {
            CostRow(k: t("job.revenue"), v: c["revenueCents"].i)
            CostRow(k: t("job.labour"), v: -c["labourCents"].i)
            // Labour is the one figure nobody can check by eye, so the hours and
            // rate behind it are spelled out underneath.
            ForEach(c["labourBreakdown"].array.rows(key: "staffId")) { b in
                let basis = b["fixed"].truthy ? "set amount"
                    : b["payType"].str == "HOURLY" ? "\(Fmt.minsToLabel(b["minutes"].i))\(b["estimated"].truthy ? " (scheduled)" : " tracked")"
                    : b["payType"].str == "PER_JOB" ? "per job" : "% of revenue"
                HStack { Text("\(b["staff"].str) · \(basis)"); Spacer(); MoneyText(cents: -b["costCents"].i) }
                    .font(.caption).foregroundStyle(.secondary).padding(.leading, 12)
            }
            CostRow(k: t("job.material"), v: -c["materialCents"].i)
            CostRow(k: t("job.otherExpenses"), v: -c["otherExpenseCents"].i)
            ForEach(c["expenses"].array.rows()) { e in
                let label = [e["category"].nonEmpty, e["vendor"].nonEmpty ?? e["note"].nonEmpty].compactMap { $0 }.joined(separator: " · ")
                HStack {
                    Text("\(label.isEmpty ? e["ref"].str : label)\(e["staff"].nonEmpty.map { " · paid by \($0)" } ?? "")").lineLimit(1)
                    Spacer(); MoneyText(cents: -e["amountCents"].i)
                }
                .font(.caption).foregroundStyle(.secondary).padding(.leading, 12)
            }
            HStack {
                Text("Profit").font(.body.weight(.semibold))
                Spacer()
                VStack(alignment: .trailing, spacing: 1) {
                    MoneyText(cents: c["profitCents"].i).font(.headline).foregroundStyle(c["profitCents"].i >= 0 ? Brand.good : Brand.bad)
                    Text("\(numberText(c["marginPct"]))% \(t("dash.margin"))").font(.caption2).foregroundStyle(.secondary)
                }
            }
            if c["labourEstimated"].truthy {
                Callout(text: "No usable check-in time was logged, so labour is estimated from the scheduled duration. Check cleaners in and out on the job to cost it on real hours.", tone: .normal)
            }
            let noRate = c["staffWithoutRate"].array.map(\.str)
            if !noRate.isEmpty {
                Callout(text: "\(noRate.joined(separator: ", ")) \(noRate.count > 1 ? "have" : "has") no pay rate set, so they add nothing to labour. Set it on the staff record.")
            }
        } header: {
            HStack { Text(t("job.costing")); Spacer(); if !isStaff { Button(t("common.edit")) { sheet = .costing }.font(.caption) } }
        }
    }

    @ViewBuilder private func actionsMenu(_ j: JSON, isStaff: Bool) -> some View {
        Menu {
            if !isStaff {
                // jobs.reschedule is owner/admin in the registry.
                Button { sheet = .resched } label: { Label(t("bk.reschedule"), systemImage: "calendar.badge.clock") }
                Button { sheet = .price } label: { Label("Edit amount", systemImage: "banknote") }
                Button { sheet = .costing } label: { Label("Edit job costing", systemImage: "list.bullet.rectangle") }
                Button { sheet = .move } label: { Label("Change customer", systemImage: "person.crop.circle.badge.arrow.forward") }
                Button { sheet = .assign } label: { Label(t("job.cleaners"), systemImage: "person.2") }
            }
            Button { sheet = .notes } label: { Label(t("common.notes"), systemImage: "note.text") }
            if let b = j["bookingId"].nonEmpty, !isStaff {
                Button { Router.shared.push(.booking(b)) } label: { Label("View booking", systemImage: "calendar") }
            }
        } label: { Image(systemName: "ellipsis.circle") }
    }

    // MARK: Actions

    func load() async {
        // Costing is a separate query and owner/admin only; a cleaner never asks for it.
        var calls: [(String, JSON)] = [("jobs.get", ["jobId": .string(id)])]
        if app.user?.isStaff == false { calls.append(("jobs.costing", ["jobId": .string(id)])) }
        let r = await API.shared.batch(calls)
        switch r[0] { case .success(let v): j = v; error = nil; case .failure(let e): error = e.localizedDescription }
        if r.count > 1, case .success(let v) = r[1] { costing = v }
    }

    /// An action that returns its own message knows something the caller does
    /// not -- a check-out that turned out to be a mis-tap, for instance.
    private func run(_ msg: String, _ fn: () async throws -> JSON) async {
        busy = true
        do { let r = try await fn(); toast(r["message"].string ?? msg); await load() }
        catch { toast(error.localizedDescription, error: true) }
        busy = false
    }

    private func addChecklist() async {
        let label = newChecklist.trimmingCharacters(in: .whitespaces)
        guard !label.isEmpty else { return }
        await run("Updated") { try await API.shared.call("jobs.addChecklistItem", ["jobId": .string(id), "label": .string(label)]) }
        newChecklist = ""
    }

    private func removePhoto(_ p: JSON) async {
        do { try await API.shared.call("jobs.deletePhoto", ["photoId": .string(p.id)]); toast("Photo removed"); await load() }
        catch { toast(error.localizedDescription, error: true) }
    }
}

func numberText(_ j: JSON) -> String {
    let v = j.double ?? 0
    return v.rounded() == v ? String(Int(v)) : String(v)
}

struct CostRow: View {
    let k: String
    let v: Int
    var body: some View {
        HStack { Text(k).foregroundStyle(.secondary); Spacer(); MoneyText(cents: v).foregroundStyle(v < 0 ? .secondary : .primary) }
            .font(.subheadline)
    }
}

// MARK: - Photos

struct PhotosSection: View {
    let job: JSON
    let canDelete: Bool
    let onDone: () async -> Void
    let onView: (JSON) -> Void
    let onDelete: (JSON) -> Void
    @State private var kind = "BEFORE"
    @State private var busy = false
    @State private var pickerItem: PhotosPickerItem?
    @State private var camera = false

    var body: some View {
        Section {
            Picker("Kind", selection: $kind) {
                Text("Before").tag("BEFORE"); Text("After").tag("AFTER"); Text("Attachment").tag("ATTACHMENT")
            }
            .pickerStyle(.segmented)
            HStack(spacing: 10) {
                Button { camera = true } label: { Label("Camera", systemImage: "camera").frame(maxWidth: .infinity) }
                    .disabled(!UIImagePickerController.isSourceTypeAvailable(.camera))
                PhotosPicker(selection: $pickerItem, matching: .images) { Label("Library", systemImage: "photo.on.rectangle").frame(maxWidth: .infinity) }
            }
            .buttonStyle(.bordered).disabled(busy)
            if busy { HStack { ProgressView(); Text("Uploading…").foregroundStyle(.secondary) } }
            let photos = job["photos"].array
            if photos.isEmpty { Text("No photos yet").font(.footnote).foregroundStyle(.secondary) }
            else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 6) {
                    ForEach(photos.rows()) { p in
                        PhotoTile(photo: p.json)
                            .onTapGesture { onView(p.json) }
                            .contextMenu {
                                if canDelete { Button("Remove this photo", role: .destructive) { onDelete(p.json) } }
                            }
                    }
                }
                .padding(.vertical, 4)
            }
        } header: { Text(t("job.photos")) }
        .onChange(of: pickerItem) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data) { await upload(img) }
                pickerItem = nil
            }
        }
        .fullScreenCover(isPresented: $camera) {
            CameraPicker { img in if let img { Task { await upload(img) } } }.ignoresSafeArea()
        }
    }

    private func upload(_ image: UIImage) async {
        busy = true
        do {
            let (data, mime, name) = try ImageUpload.jpeg(image)
            let url = try await API.shared.upload(data, filename: name, mime: mime)
            try await API.shared.call("jobs.addPhoto", ["jobId": .string(job.id), "url": .string(url), "kind": .string(kind)])
            toast("Photo added")
            await onDone()
        } catch { toast(error.localizedDescription, error: true) }
        busy = false
    }
}

struct PhotoTile: View {
    let photo: JSON
    var body: some View {
        let url = photo["url"].str
        let isPdf = url.range(of: #"\.pdf($|\?)"#, options: [.regularExpression, .caseInsensitive]) != nil
        ZStack(alignment: .topLeading) {
            Color(.tertiarySystemFill)
            if isPdf {
                VStack { Image(systemName: "doc.richtext").font(.title2); Text("PDF").font(.caption2) }.foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                AsyncImage(url: URL(string: url)) { phase in
                    switch phase {
                    case .success(let img): img.resizable().scaledToFill()
                    case .failure: VStack(spacing: 2) { Text("⚠️"); Text("Image will not load").font(.caption2).foregroundStyle(.secondary) }
                    default: ProgressView()
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
            }
            Text(photo["kind"].str).font(.system(size: 9, weight: .bold)).foregroundStyle(.white)
                .padding(.horizontal, 5).padding(.vertical, 2).background(.black.opacity(0.6), in: .capsule).padding(4)
        }
        .aspectRatio(1, contentMode: .fit)
        .clipShape(.rect(cornerRadius: 8))
    }
}

struct PhotoViewer: View {
    let photo: JSON
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                AsyncImage(url: URL(string: photo["url"].str)) { phase in
                    switch phase {
                    case .success(let img): img.resizable().scaledToFit()
                    case .failure: Text("Image will not load").foregroundStyle(.white)
                    default: ProgressView().tint(.white)
                    }
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.close")) { dismiss() } }
                if let url = URL(string: photo["url"].str) { ToolbarItem(placement: .primaryAction) { ShareLink(item: url) } }
            }
            .toolbarBackground(.visible, for: .navigationBar)
        }
    }
}

/// Photos go up as JPEG under the 8 MB limit: the upload route refuses HEIC,
/// which is what an iPhone camera produces by default.
enum ImageUpload {
    static func jpeg(_ image: UIImage) throws -> (Data, String, String) {
        var img = image
        let maxSide: CGFloat = 2400
        let side = max(img.size.width, img.size.height)
        if side > maxSide {
            let scale = maxSide / side
            let size = CGSize(width: img.size.width * scale, height: img.size.height * scale)
            img = UIGraphicsImageRenderer(size: size).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
        }
        var q: CGFloat = 0.82
        var data = img.jpegData(compressionQuality: q)
        while let d = data, d.count > 7_500_000, q > 0.3 { q -= 0.15; data = img.jpegData(compressionQuality: q) }
        guard let out = data else { throw APIError(message: "Could not read that image.") }
        return (out, "image/jpeg", "photo.jpg")
    }
}

struct CameraPicker: UIViewControllerRepresentable {
    let onPick: (UIImage?) -> Void
    @Environment(\.dismiss) private var dismiss
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let c = UIImagePickerController()
        c.sourceType = .camera
        c.delegate = context.coordinator
        return c
    }
    func updateUIViewController(_ vc: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ p: CameraPicker) { parent = p }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            parent.onPick(info[.originalImage] as? UIImage); parent.dismiss()
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.onPick(nil); parent.dismiss() }
    }
}

// MARK: - Sheets

/// AssignModal: the full team, with each cleaner's availability for the slot.
struct AssignSheet: View {
    let job: JSON
    let onDone: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var staff: [JSON] = []
    @State private var avail: [JSON] = []
    @State private var ids: [String] = []
    @State private var busy = false

    var body: some View {
        NavigationStack {
            List {
                if staff.isEmpty { LoadingRow() }
                ForEach(staff.rows()) { s in
                    let a = avail.first { $0["staffId"].str == s.id }
                    let on = ids.contains(s.id)
                    Button {
                        if on { ids.removeAll { $0 == s.id } } else { ids.append(s.id) }
                    } label: {
                        HStack(spacing: 10) {
                            Avatar(name: s["name"].str, colour: s["colour"].str)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(s["name"].str).foregroundStyle(.primary)
                                Text(a?["reason"].string ?? "—").font(.caption).foregroundStyle(a?["available"].truthy == true ? Brand.good : Brand.warn)
                            }
                            Spacer()
                            if on { Image(systemName: "checkmark").foregroundStyle(Brand.b600).bold() }
                        }
                    }
                    .disabled(!on && !(a?["available"].truthy ?? false))
                }
                Section { Text("The first cleaner chosen is the lead.").font(.footnote).foregroundStyle(.secondary) }
            }
            .navigationTitle(t("job.cleaners"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(t("common.save")) { Task { await go() } }.disabled(busy) }
            }
            .task {
                ids = job["assignments"].array.map { $0["staffId"].str }
                let r = await API.shared.batch([
                    ("staff.list", [:]),
                    ("staff.findAvailable", ["startAt": .string(Fmt.iso(job["scheduledAt"].date ?? Date())), "durationMin": job["durationMin"], "excludeJobId": .string(job.id)]),
                ])
                if case .success(let v) = r[0] { staff = v.array }
                if case .success(let v) = r[1] { avail = v.array }
            }
        }
    }
    private func go() async {
        busy = true
        do { try await API.shared.call("jobs.assignStaff", ["jobId": .string(job.id), "staffIds": JSON(ids)]); toast("Cleaners updated"); await onDone(); dismiss() }
        catch { toast(error.localizedDescription, error: true) }
        busy = false
    }
}

struct JobRescheduleSheet: View {
    let job: JSON
    let onDone: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var when = Date()
    @State private var busy = false
    var body: some View {
        NavigationStack {
            Form { DatePicker("New date & time", selection: $when) }
                .navigationTitle(t("bk.reschedule"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) { Button(t("common.save")) { Task { await go() } }.disabled(busy) }
                }
                .onAppear { when = Fmt.toMinute(job["scheduledAt"].date ?? Date()) }
        }
        .presentationDetents([.medium])
    }
    private func go() async {
        busy = true
        do { try await API.shared.call("jobs.reschedule", ["jobId": .string(job.id), "scheduledAt": .string(Fmt.iso(Fmt.toMinute(when)))]); toast("Job rescheduled"); await onDone(); dismiss() }
        catch { toast(error.localizedDescription, error: true) }
        busy = false
    }
}

struct JobNotesSheet: View {
    let job: JSON
    let onDone: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var internalNotes = ""
    @State private var staffNotes = ""
    @State private var busy = false
    var body: some View {
        NavigationStack {
            Form {
                Section(t("job.internalNotes")) { TextField(t("job.internalNotes"), text: $internalNotes, axis: .vertical).lineLimit(3...8) }
                Section(t("job.staffNotes")) { TextField(t("job.staffNotes"), text: $staffNotes, axis: .vertical).lineLimit(3...8) }
            }
            .navigationTitle(t("common.notes"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(t("common.save")) { Task { await go() } }.disabled(busy) }
            }
            .onAppear { internalNotes = job["internalNotes"].str; staffNotes = job["staffNotes"].str }
        }
    }
    private func go() async {
        busy = true
        do { try await API.shared.call("jobs.update", ["jobId": .string(job.id), "internalNotes": .string(internalNotes), "staffNotes": .string(staffNotes)]); toast("Notes saved"); await onDone(); dismiss() }
        catch { toast(error.localizedDescription, error: true) }
        busy = false
    }
}

/// PriceModal: moves the booking line, the job and the invoice together.
struct PriceSheet: View {
    let job: JSON
    let onDone: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var amount = ""
    @State private var busy = false
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    MoneyField(label: "Amount charged", text: $amount)
                } footer: { Text("Updates the booking, the job and the invoice together.") }
                Section {
                    Text("Currently \(Fmt.moneyUI(job["revenueCents"].i)). Money already received stays received — the invoice simply goes back to part-paid if the new amount is higher.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Edit amount · \(job["ref"].str)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(busy ? t("common.saving") : t("common.save")) { Task { await go() } }.disabled(busy) }
            }
            .onAppear { amount = Fmt.fixed2(job["revenueCents"].i) }
        }
        .presentationDetents([.medium])
    }
    private func go() async {
        busy = true
        do {
            let r = try await API.shared.call("jobs.setPrice", ["jobId": .string(job.id), "amountCents": .number(Double(Fmt.toCents(amount)))])
            let inv = r["invoice"]
            toast(inv.exists && inv["outstandingCents"].i > 0 ? "Updated — \(Fmt.money(inv["outstandingCents"].i)) now outstanding on \(inv["ref"].str)" : "Amount updated")
            await onDone(); dismiss()
        } catch { toast(error.localizedDescription, error: true) }
        busy = false
    }
}

/// MoveCustomerModal: filed under the wrong name.
struct MoveCustomerSheet: View {
    let job: JSON
    let onDone: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var q = ""
    @State private var data: [JSON] = []
    @State private var busy = false
    @State private var target: JSON?
    var body: some View {
        NavigationStack {
            List {
                Section { Text("Currently filed under \(job["customer"]["name"].str). The amount does not change — only whose record it sits on.").font(.footnote).foregroundStyle(.secondary) }
                let rows = data.filter { $0.id != job["customerId"].str }
                if rows.isEmpty { Text("No match").foregroundStyle(.secondary) }
                ForEach(rows.rows()) { c in
                    Button { target = c.json } label: {
                        HStack {
                            Text(c["name"].str).foregroundStyle(.primary)
                            Spacer()
                            Text(c["phone"].nonEmpty ?? c["addresses"][0]["line1"].str).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .disabled(busy)
                }
            }
            .searchable(text: $q, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search name, phone or company")
            .navigationTitle("Change customer · \(job["ref"].str)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } } }
            .task(id: q) {
                var input: JSON = ["limit": 20]
                input.set("query", .orOmit(q))
                data = (try? await API.shared.call("customers.search", input))?.array ?? []
            }
            .confirmationDialog("Move job?", isPresented: Binding(get: { target != nil }, set: { if !$0 { target = nil } }), titleVisibility: .visible) {
                Button("Move") { if let tg = target { Task { await go(tg) } } }
            } message: {
                Text("Move \(job["ref"].str) from \(job["customer"]["name"].str) to \(target?["name"].str ?? "")? The booking, invoice and any payments move too.")
            }
        }
    }
    private func go(_ c: JSON) async {
        busy = true
        do { let r = try await API.shared.call("jobs.reassignCustomer", ["jobId": .string(job.id), "customerId": .string(c.id)]); toast("Moved to \(r["to"].str)"); await onDone(); dismiss() }
        catch { toast(error.localizedDescription, error: true) }
        busy = false
    }
}
