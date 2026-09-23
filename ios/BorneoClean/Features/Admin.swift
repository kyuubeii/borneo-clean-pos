import SwiftUI
import PhotosUI

private let ROLES: [(String, String, String)] = [
    ("OWNER", "Owner", "Full access including users and settings"),
    ("ADMIN", "Admin", "Operations, scheduling and finances"),
    ("STAFF", "Cleaner", "Own jobs, check-in/out, expenses"),
]

// MARK: - Users (users/page.tsx)

struct UsersView: View {
    @State private var app = AppState.shared
    @State private var data: [JSON]?
    @State private var error: String?
    @State private var creating = false
    @State private var doomed: JSON?
    @State private var pendingChange: (JSON, JSON, String)?

    var body: some View {
        let activeOwners = (data ?? []).filter { $0["role"].str == "OWNER" && $0["active"].truthy }.count
        List {
            Section("Roles") {
                ForEach(ROLES, id: \.0) { r in
                    VStack(alignment: .leading, spacing: 2) { Text(r.1).font(.subheadline.weight(.semibold)); Text(r.2).font(.caption).foregroundStyle(.secondary) }
                }
            }
            LoadErrorView(error: error) { Task { await load() } }
            Section {
                if data == nil && error == nil { LoadingRow() }
                ForEach((data ?? []).rows()) { u in
                    let me = u.id == app.user?.id
                    let lastOwner = u["role"].str == "OWNER" && u["active"].truthy && activeOwners <= 1
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 6) {
                            Text(u["name"].str).font(.body.weight(.medium))
                            if u["staffName"].exists { Tag(text: "cleaner") }
                            if me { Tag(text: "you", bg: Brand.b50, fg: Brand.b600) }
                            Spacer()
                            Text("since \(u["createdAt"].date.map(Fmt.date) ?? "")").font(.caption2).foregroundStyle(.secondary)
                        }
                        Text(u["email"].str).font(.caption).foregroundStyle(.secondary)
                        HStack {
                            Menu {
                                ForEach(ROLES, id: \.0) { r in
                                    Button(r.1) {
                                        if r.0 != u["role"].str { pendingChange = (u.json, ["role": .string(r.0)], "Change \(u["name"].str) to \(r.1)?") }
                                    }
                                }
                            } label: { Label(ROLES.first { $0.0 == u["role"].str }?.1 ?? u["role"].str, systemImage: "person.badge.key").font(.caption) }
                            Spacer()
                            Button(u["active"].truthy ? "Deactivate" : "Reactivate") {
                                pendingChange = (u.json, ["active": .bool(!u["active"].truthy)], "\(u["active"].truthy ? "Deactivate" : "Reactivate") \(u["name"].str)?")
                            }
                            .font(.caption).tint(u["active"].truthy ? .secondary : Brand.good)
                            Button(role: .destructive) { doomed = u.json } label: { Image(systemName: "trash") }
                                .disabled(me || lastOwner)
                        }
                        .buttonStyle(.borderless)
                    }
                    .opacity(u["active"].truthy ? 1 : 0.5)
                }
            }
        }
        .navigationTitle(t("nav.users"))
        .toolbar { ToolbarItem(placement: .primaryAction) { Button { creating = true } label: { Image(systemName: "plus") }.accessibilityLabel(t("common.new")) } }
        .loads(load)
        .sheet(isPresented: $creating) { NewUserView { await load() } }
        .sheet(item: rowBinding($doomed)) { r in DeleteUserView(user: r.json) { await load() } }
        .confirmationDialog(pendingChange?.2 ?? "", isPresented: Binding(get: { pendingChange != nil }, set: { if !$0 { pendingChange = nil } }), titleVisibility: .visible) {
            Button(t("common.confirm")) { if let c = pendingChange { Task { await change(c.0, c.1) } } }
        }
    }

    private func load() async {
        do { data = try await API.shared.call("users.list").array; error = nil }
        catch { self.error = error.localizedDescription }
    }

    private func change(_ u: JSON, _ patch: JSON) async {
        var input = patch
        input.set("userId", .string(u.id))
        do { try await API.shared.call("users.update", input); toast("User updated"); await load() }
        catch { toast(error.localizedDescription, error: true) }
    }
}

struct NewUserView: View {
    let onDone: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var staff: [JSON] = []
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var role = "STAFF"
    @State private var staffId = ""
    @State private var busy = false
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(t("common.name"), text: $name)
                    TextField(t("common.email"), text: $email).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField(t("auth.password"), text: $password).textContentType(.newPassword)
                } footer: { Text("Password: at least 6 characters.") }
                Section {
                    Picker("Role", selection: $role) { ForEach(ROLES, id: \.0) { Text("\($0.1) — \($0.2)").tag($0.0) } }
                    if role == "STAFF" {
                        Picker("Link to cleaner profile (\(t("common.optional")))", selection: $staffId) {
                            Text("— none —").tag("")
                            ForEach(staff.filter { !$0["userId"].exists }.rows()) { s in Text(s["name"].str).tag(s.id) }
                        }
                    }
                }
            }
            .navigationTitle("New user")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(t("common.create")) { Task { await go() } }.disabled(busy) }
            }
            .task { staff = (try? await API.shared.call("staff.list"))?.array ?? [] }
        }
    }
    private func go() async {
        busy = true
        var input: JSON = ["name": .string(name), "email": .string(email), "password": .string(password), "role": .string(role)]
        input.set("staffId", .orOmit(staffId))
        do { try await API.shared.call("users.create", input); toast("User created"); await onDone(); dismiss() }
        catch { toast(error.localizedDescription, error: true) }
        busy = false
    }
}

/// Permanent account deletion. The email must be typed out to arm the button.
struct DeleteUserView: View {
    let user: JSON
    let onDone: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var typed = ""
    @State private var busy = false
    var body: some View {
        let armed = typed.trimmingCharacters(in: .whitespaces).lowercased() == user["email"].str.lowercased()
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(user["name"].str) · \(user["email"].str)").font(.subheadline.weight(.medium))
                        Text("This removes the account and its login for good. It cannot be undone.\(user["staffName"].nonEmpty.map { " The cleaner profile \"\($0)\" and its job history are kept — only the login is removed." } ?? "") Their audit trail stays under their name.")
                            .font(.caption)
                    }
                    .foregroundStyle(Color(hex: 0xBE123C))
                    .listRowBackground(Color(hex: 0xFFF1F2))
                }
                Section { Text("To block sign-in without losing the account, close this and use Deactivate instead.").font(.footnote).foregroundStyle(.secondary) }
                Section {
                    TextField(user["email"].str, text: $typed).textInputAutocapitalization(.never).autocorrectionDisabled()
                } header: { Text("Type the email address to confirm") }
                Section {
                    Button(role: .destructive) { Task { await go() } } label: { HStack { Spacer(); Text(busy ? "Deleting…" : "Delete permanently").bold(); Spacer() } }
                        .disabled(!armed || busy)
                }
            }
            .navigationTitle("Delete user permanently")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } } }
        }
    }
    private func go() async {
        busy = true
        do {
            let r = try await API.shared.call("users.delete", ["userId": .string(user.id)])
            toast(r["unlinkedStaff"].nonEmpty.map { "\(r["name"].str) deleted — cleaner profile \"\($0)\" kept" } ?? "\(r["name"].str) deleted")
            await onDone(); dismiss()
        } catch { toast(error.localizedDescription, error: true) }
        busy = false
    }
}

// MARK: - Activity log (audit/page.tsx)

struct AuditView: View {
    @State private var source = ""
    @State private var data: [JSON]?
    @State private var expanded: String?

    var body: some View {
        List {
            Section {
                ChipPicker(options: [("", t("common.all")), ("ui", "Manual"), ("assistant", "AI assistant"), ("system", "System")], selection: $source)
                    .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
            } footer: { Text("Every action taken in the system, including by the AI assistant") }
            if data == nil { LoadingRow() }
            else if data?.isEmpty == true { EmptyState(text: t("common.empty")) }
            ForEach((data ?? []).rows()) { a in
                VStack(alignment: .leading, spacing: 6) {
                    Button { withAnimation { expanded = expanded == a.id ? nil : a.id } } label: {
                        HStack(spacing: 8) {
                            Circle().fill(a["ok"].truthy ? Color.green : Color.red).frame(width: 6, height: 6)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(a["action"].str).font(.system(.caption, design: .monospaced).weight(.medium)).foregroundStyle(.primary)
                                Text("\(a["actorName"].str) · \(a["createdAt"].date.map(Fmt.shortStamp) ?? "")").font(.caption2).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Tag(text: a["source"].str, bg: a["source"].str == "assistant" ? Brand.b100 : a["source"].str == "system" ? Color.purple.opacity(0.15) : Brand.ink100,
                                fg: a["source"].str == "assistant" ? Brand.b700 : a["source"].str == "system" ? .purple : Brand.ink500)
                        }
                    }
                    .buttonStyle(.plain)
                    if expanded == a.id {
                        Text("INPUT").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                        Text(pretty(a["payload"].string)).font(.system(size: 10, design: .monospaced)).textSelection(.enabled)
                        Text("RESULT").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                        Text(pretty(a["result"].string)).font(.system(size: 10, design: .monospaced)).textSelection(.enabled)
                    }
                }
            }
        }
        .navigationTitle(t("nav.audit"))
        .task(id: source) { await load() }
        .refreshable { await load() }
    }

    private func pretty(_ v: String?) -> String {
        guard let v, !v.isEmpty else { return "—" }
        if let d = v.data(using: .utf8), let j = try? JSON.parse(d) { let p = j.prettyString; return p.isEmpty ? v : p }
        return v
    }

    private func load() async {
        var input: JSON = ["limit": 200]
        input.set("source", .orOmit(source))
        data = (try? await API.shared.call("audit.list", input))?.array ?? data
    }
}

// MARK: - Settings (settings/page.tsx)

/// What a setting shows before anyone has set it -- so what is on screen is what gets saved.
private let DEFAULTS: [String: String] = ["invoice.taxRateBp": "0", "invoice.dueDays": "14"]
private let MODELS = ["anthropic/claude-sonnet-4.5", "anthropic/claude-opus-4.1", "anthropic/claude-haiku-4.5",
                      "openai/gpt-4.1", "google/gemini-2.5-pro", "meta-llama/llama-3.3-70b-instruct"]

struct SettingsView: View {
    @State private var data: [String: String]?
    @State private var f: [String: String] = DEFAULTS
    /// Fields edited since the last save; one Save writes all of them.
    @State private var dirty: Set<String> = []
    @State private var apiKey = ""
    @State private var busy = false
    @State private var error: String?
    @State private var pickerItem: PhotosPickerItem?

    private var pending: Int { dirty.count + (apiKey.trimmingCharacters(in: .whitespaces).isEmpty ? 0 : 1) }

    private func bind(_ k: String) -> Binding<String> {
        Binding(get: { f[k] ?? "" }, set: { f[k] = $0; dirty.insert(k) })
    }
    private func toggle(_ k: String) -> Binding<Bool> {
        Binding(get: { f[k] == "true" }, set: { f[k] = $0 ? "true" : "false"; dirty.insert(k) })
    }

    var body: some View {
        Form {
            LoadErrorView(error: error) { Task { await load() } }
            Section("Business profile") {
                TextField("Business name", text: bind("business.name"))
                TextField("Tagline", text: bind("business.tagline"), prompt: Text("Cleaning Services"))
                TextField(t("common.email"), text: bind("business.email")).keyboardType(.emailAddress).textInputAutocapitalization(.never)
                TextField(t("common.phone"), text: bind("business.phone")).keyboardType(.phonePad)
                TextField(t("common.address"), text: bind("business.address"), axis: .vertical).lineLimit(2...4)
                TextField("Registration number", text: bind("business.regNo"))
            }
            Section {
                HStack(spacing: 12) {
                    Group {
                        if let u = f["business.logoUrl"], !u.isEmpty, let url = URL(string: u) {
                            AsyncImage(url: url) { $0.resizable().scaledToFit() } placeholder: { ProgressView() }
                        } else { Text("No logo").font(.caption2).foregroundStyle(.secondary) }
                    }
                    .frame(width: 60, height: 60)
                    .background(Brand.ink50, in: .rect(cornerRadius: 10))
                    VStack(alignment: .leading, spacing: 8) {
                        PhotosPicker(selection: $pickerItem, matching: .images) { Text(f["business.logoUrl"]?.isEmpty == false ? "Replace image" : "Upload image") }
                        if f["business.logoUrl"]?.isEmpty == false { Button("Remove", role: .destructive) { bind("business.logoUrl").wrappedValue = "" } }
                    }
                    .buttonStyle(.borderless).disabled(busy)
                }
                TextField("…or paste an image URL", text: bind("business.logoUrl")).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
            } header: { Text("Logo") } footer: { Text("Shown at the top left of the printed document. Leave blank for initials.") }

            Section {
                TextField("Bank", text: bind("business.bank"), prompt: Text("AmBank"))
                TextField("Account name", text: bind("business.accountName"))
                TextField("Account number", text: bind("business.accountNumber")).keyboardType(.numberPad)
                TextField("Invoice payment terms", text: bind("invoice.paymentTerms"), prompt: Text("Due immediately upon receipt"))
                TextField("Quotation payment terms", text: bind("quote.paymentTerms"), prompt: Text("To be agreed upon acceptance"))
            } header: { Text("Payment details on invoices") } footer: { Text("Printed in the terms row and the payment panel.") }

            Section {
                LabeledField(label: "Tax rate (basis points)", text: bind("invoice.taxRateBp"), keyboard: .numberPad)
                LabeledField(label: "Payment terms (days)", text: bind("invoice.dueDays"), keyboard: .numberPad)
                TextField("Invoice footer", text: bind("invoice.footer"), axis: .vertical).lineLimit(2...4)
            } header: { Text("Invoice defaults") } footer: { Text("600 = 6% SST") }

            Section {
                Toggle("Booking confirmations", isOn: toggle("notify.bookingConfirmation"))
                Toggle("Job and schedule reminders", isOn: toggle("notify.reminders"))
                Toggle("Payment reminders", isOn: toggle("notify.paymentReminders"))
                NavigationLink(value: Route.notificationPrefs) { Text("Push notifications on this phone") }
            } header: { Text("Notifications") } footer: { Text("Notifications are delivered in-app. Push to this phone is chosen under Push notifications.") }

            Section {
                Text(data?["ai.hasKey"] == "true" ? "✓ An OpenRouter API key is configured." : t("ai.noKey"))
                    .font(.footnote).foregroundStyle(data?["ai.hasKey"] == "true" ? Brand.good : Color(hex: 0x92400E))
                HStack {
                    TextField("Model", text: bind("ai.model")).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Menu { ForEach(MODELS, id: \.self) { m in Button(m) { bind("ai.model").wrappedValue = m } } } label: { Image(systemName: "chevron.down.circle") }
                }
                SecureField("OpenRouter API key", text: $apiKey, prompt: Text("sk-or-v1-…"))
            } header: { Text("AI Assistant") } footer: { Text("Any OpenRouter model that supports tool calling. The key is stored server-side and never sent back. Leave blank to keep the current key.") }
        }
        .navigationTitle(t("nav.settings"))
        .safeAreaInset(edge: .bottom) {
            HStack {
                Text(pending == 0 ? "All changes saved" : "\(pending) unsaved change\(pending == 1 ? "" : "s")").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button(busy ? t("common.saving") : t("common.save")) { Task { await save() } }
                    .buttonStyle(.borderedProminent).disabled(busy || pending == 0)
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
            .background(.bar)
        }
        .task { await load() }
        .refreshable { await load() }
        .onChange(of: pickerItem) { _, item in
            guard let item else { return }
            Task {
                if let d = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: d) { await uploadLogo(img) }
                pickerItem = nil
            }
        }
    }

    private func load() async {
        do {
            let r = try await API.shared.call("settings.get")
            var m: [String: String] = [:]
            for (k, v) in r.object { m[k] = v.str }
            data = m
            // A re-read must not overwrite something half-typed.
            var next = DEFAULTS.merging(m) { _, b in b }
            for k in dirty { next[k] = f[k] }
            f = next
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    private func save() async {
        guard pending > 0 else { return }
        busy = true
        var values: [String: JSON] = [:]
        for k in dirty { values[k] = .string(f[k] ?? "") }
        let key = apiKey.trimmingCharacters(in: .whitespaces)
        if !key.isEmpty { values["ai.apiKey"] = .string(key) }
        do {
            try await API.shared.call("settings.update", ["values": .object(values)])
            dirty = []; apiKey = ""
            toast("Settings saved")
            await load()
        } catch { toast(error.localizedDescription, error: true) }
        busy = false
    }

    private func uploadLogo(_ img: UIImage) async {
        busy = true
        do {
            let (d, m, n) = try ImageUpload.jpeg(img)
            let url = try await API.shared.upload(d, filename: n, mime: m)
            bind("business.logoUrl").wrappedValue = url
            toast("Logo uploaded — press Save to keep it")
        } catch { toast(error.localizedDescription, error: true) }
        busy = false
    }
}

// MARK: - Push notifications (new: per-phone choice of what to be alerted about)

struct NotificationPrefsView: View {
    @State private var push = Push.shared
    var body: some View {
        Form {
            Section {
                switch push.status {
                case .denied:
                    Text("Notifications are turned off for Borneo Clean in iPhone Settings.").foregroundStyle(.secondary)
                    Button("Open Settings") { push.requestAgain() }
                case .notDetermined:
                    Button("Turn on notifications") { push.requestAgain() }
                default:
                    Label(push.registered ? "This phone receives push notifications" : "Connecting to the server…",
                          systemImage: push.registered ? "checkmark.circle.fill" : "hourglass")
                        .foregroundStyle(push.registered ? Brand.good : .secondary)
                }
                if let e = push.lastError { Text(e).font(.caption).foregroundStyle(.red) }
            } footer: { Text("The bell in the app always shows everything, exactly as on the web. These switches only choose what also pops up on this phone.") }

            Section("Alert me about") {
                ForEach(PUSH_TYPES) { ty in
                    Toggle(isOn: Binding(get: { push.types.contains(ty.id) }, set: { push.setType(ty.id, on: $0) })) {
                        VStack(alignment: .leading, spacing: 2) { Text(ty.label); Text(ty.detail).font(.caption).foregroundStyle(.secondary) }
                    }
                    .disabled(!push.registered)
                }
            }
        }
        .navigationTitle("Push notifications")
        .task { await push.refreshStatus(); if push.status == .authorized && !push.registered { push.signedIn() } }
    }
}
