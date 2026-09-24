import SwiftUI

/**
 Assistant.tsx: the same `/api/ai/chat` loop, history and confirmation gate.

 The model, the tools and the confirm-before-execute rule all live on the
 server. This screen sends messages, shows replies and the actions they ran,
 and hands a gated action back for a yes or no -- exactly as the web panel does.
 */
struct AssistantView: View {
    struct Msg: Identifiable { let id = UUID(); let role: String; let content: String; var actions: [(name: String, ok: Bool)] = [] }

    @Environment(\.dismiss) private var dismiss
    @State private var app = AppState.shared
    @State private var msgs: [Msg] = []
    @State private var input = ""
    @State private var busy = false
    @State private var thread: String?
    @State private var confirm: JSON?
    @State private var threads: [JSON]?
    @State private var loadingThread = false
    @State private var showHistory = false
    @FocusState private var focused: Bool

    private var lastKey: String { "bc.ai.lastThread.\(app.user?.id ?? "")" }

    private static let suggestions = [
        "Summarize today's business activity", "Show me tomorrow's jobs", "Which customers haven't paid yet?",
        "How much did we make this month?", "Record RM120 petrol expense for today", "Which service generated the most revenue this month?",
    ]

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        if loadingThread { HStack { Spacer(); ProgressView(); Spacer() } }
                        if !loadingThread && msgs.isEmpty {
                            VStack(spacing: 16) {
                                Image(systemName: "sparkles").font(.largeTitle).foregroundStyle(Brand.b600).padding(.top, 30)
                                Text(t("ai.intro")).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                                VStack(spacing: 8) {
                                    ForEach(Self.suggestions, id: \.self) { s in
                                        Button { send(s) } label: {
                                            Text(s).font(.subheadline).frame(maxWidth: .infinity, alignment: .leading)
                                                .padding(12).background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 12))
                                        }
                                        .buttonStyle(.row)
                                    }
                                }
                            }
                            .frame(maxWidth: .infinity)
                        }
                        ForEach(msgs) { m in bubble(m).id(m.id) }
                        if let c = confirm { confirmCard(c).id("confirm") }
                        if busy {
                            HStack(spacing: 6) { ProgressView().controlSize(.small); Text(t("ai.thinking")).font(.caption).foregroundStyle(.secondary) }.id("busy")
                        }
                    }
                    .padding(16)
                }
                .background(Color(.systemGroupedBackground))
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: msgs.count) { withAnimation { proxy.scrollTo(msgs.last?.id, anchor: .bottom) } }
                .onChange(of: busy) { if busy { withAnimation { proxy.scrollTo("busy", anchor: .bottom) } } }
                .onChange(of: confirm) { if confirm != nil { withAnimation { proxy.scrollTo("confirm", anchor: .bottom) } } }
            }
            .safeAreaInset(edge: .bottom) { composer }
            .navigationTitle(thread.flatMap { id in threads?.first { $0.id == id }?["title"].string } ?? t("ai.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showHistory = true } label: { Image(systemName: "sidebar.left") }.accessibilityLabel(t("ai.history"))
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button { newChat() } label: { Image(systemName: "square.and.pencil") }.disabled(busy).accessibilityLabel(t("ai.newChat"))
                    Button { dismiss() } label: { Image(systemName: "xmark") }.accessibilityLabel(t("common.close"))
                }
            }
            .sheet(isPresented: $showHistory) {
                AssistantHistory(threads: $threads, current: thread, busy: busy,
                                 onOpen: { id in showHistory = false; Task { await openThread(id) } },
                                 onNew: { showHistory = false; newChat() },
                                 onDeleted: { id in if id == thread { newChat() } })
            }
            .task { await start() }
        }
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField(t("ai.placeholder"), text: $input, axis: .vertical)
                .lineLimit(1...5)
                .focused($focused)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 20))
            Button { send() } label: {
                Image(systemName: "arrow.up").font(.body.weight(.bold)).foregroundStyle(.white)
                    .frame(width: 38, height: 38).background(Brand.b600, in: .circle)
            }
            .disabled(busy || loadingThread || confirm != nil || input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .opacity((busy || confirm != nil || input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) ? 0.4 : 1)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(.bar)
    }

    @ViewBuilder private func bubble(_ m: Msg) -> some View {
        switch m.role {
        case "user":
            HStack { Spacer(minLength: 40); Text(m.content).font(.subheadline).foregroundStyle(.white)
                .padding(.horizontal, 14).padding(.vertical, 9).background(Brand.b600, in: .rect(cornerRadius: 18)) }
        case "system":
            Text(m.content).font(.caption).foregroundStyle(Color(hex: 0x92400E)).padding(10)
                .frame(maxWidth: .infinity, alignment: .leading).background(Color(hex: 0xFFFBEB), in: .rect(cornerRadius: 10))
        default:
            VStack(alignment: .leading, spacing: 6) {
                if !m.actions.isEmpty {
                    FlowTags(items: m.actions.map { ($0.name, $0.ok) })
                }
                if !m.content.isEmpty {
                    Text(Self.render(m.content)).font(.subheadline).textSelection(.enabled)
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 18))
                }
            }
            .padding(.trailing, 30)
        }
    }

    @ViewBuilder private func confirmCard(_ c: JSON) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(t("ai.confirmTitle"), systemImage: "exclamationmark.triangle.fill").font(.subheadline.weight(.semibold)).foregroundStyle(Color(hex: 0x78350F))
            Text(c["title"].str).font(.caption).foregroundStyle(Color(hex: 0x92400E))
            ActionReview(action: c["action"].str, input: c["input"])
            HStack {
                Button { Task { await post(["confirm": c]) } } label: { Text(t("ai.confirmRun")).frame(maxWidth: .infinity) }.buttonStyle(.borderedProminent)
                Button { Task { await post(["confirm": ["cancelled": true, "toolCallId": c["toolCallId"]]]) } } label: { Text(t("ai.confirmCancel")).frame(maxWidth: .infinity) }.buttonStyle(.bordered)
            }
            .disabled(busy)
        }
        .padding(14)
        .background(Color(hex: 0xFFFBEB), in: .rect(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(hex: 0xFCD34D), lineWidth: 2))
    }

    /// Minimal markdown: bold, inline code, bullets and line breaks.
    static func render(_ text: String) -> AttributedString {
        let bulleted = text.split(separator: "\n", omittingEmptySubsequences: false).map { line -> String in
            let l = String(line)
            if l.hasPrefix("- ") || l.hasPrefix("* ") { return "• " + l.dropFirst(2) }
            return l
        }.joined(separator: "\n")
        return (try? AttributedString(markdown: bulleted, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text)
    }

    // MARK: Flow

    private func start() async {
        await loadThreads()
        if let last = UserDefaults.standard.string(forKey: lastKey), threads?.contains(where: { $0.id == last }) == true {
            await openThread(last)
        }
    }

    private func loadThreads() async {
        if let list = try? await API.shared.aiThreads() { threads = list }
    }

    private func openThread(_ id: String) async {
        loadingThread = true; confirm = nil
        do {
            let j = try await API.shared.aiThread(id)
            thread = id
            msgs = j["messages"].array.map { m in
                Msg(role: m["role"].str, content: m["content"].str, actions: m["actions"].array.map { ($0["name"].str, $0["ok"].truthy) })
            }
            UserDefaults.standard.set(id, forKey: lastKey)
        } catch {
            thread = nil
            msgs = [Msg(role: "system", content: error.localizedDescription)]
            UserDefaults.standard.removeObject(forKey: lastKey)
        }
        loadingThread = false
    }

    private func send(_ text: String? = nil) {
        let msg = (text ?? input).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !msg.isEmpty, !busy, confirm == nil else { return }
        msgs.append(Msg(role: "user", content: msg))
        input = ""
        Task { await post(["message": .string(msg)]) }
    }

    private func newChat() {
        guard !busy else { return }
        msgs = []; thread = nil; confirm = nil
        UserDefaults.standard.removeObject(forKey: lastKey)
    }

    private func post(_ extra: JSON) async {
        busy = true; confirm = nil
        var body = extra
        body.set("threadId", thread.map { .string($0) } ?? .null)
        do {
            let j = try await API.shared.aiChat(body)
            // A new conversation exists as soon as its first message is stored,
            // even if the model then failed, so it goes into the history either way.
            if let tid = j["threadId"].nonEmpty {
                thread = tid
                UserDefaults.standard.set(tid, forKey: lastKey)
                let cur = threads?.first { $0.id == tid }
                let entry: JSON = ["id": .string(tid), "title": .string(j["title"].nonEmpty ?? cur?["title"].string ?? t("ai.newChat")), "updatedAt": .string(Fmt.iso(Date()))]
                threads = [entry] + (threads ?? []).filter { $0.id != tid }
            }
            if j["ok"].bool != true {
                msgs.append(Msg(role: "system", content: j["error"].str == "NO_API_KEY" ? t("ai.noKey") : (j["error"].string ?? "Assistant error")))
            } else {
                let actions = j["events"].array.filter { $0["type"].str == "action" }.map { ($0["name"].str, $0["ok"].truthy) }
                if !j["message"].str.isEmpty || !actions.isEmpty { msgs.append(Msg(role: "assistant", content: j["message"].str, actions: actions)) }
                if j["confirm"].exists { confirm = j["confirm"] }
                // A write may have changed what the screens behind are showing.
                if actions.contains(where: { $0.1 }) {
                    app.refreshAll()
                    Task { await app.loadNotifications() }
                }
            }
        } catch {
            msgs.append(Msg(role: "system", content: error.localizedDescription))
        }
        busy = false
    }
}

struct FlowTags: View {
    let items: [(String, Bool)]
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, a in
                    Label(a.0, systemImage: a.1 ? "checkmark" : "xmark")
                        .font(.caption2.weight(.medium))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(a.1 ? Color(hex: 0xECFDF5) : Color(hex: 0xFEF2F2), in: .capsule)
                        .foregroundStyle(a.1 ? Color(hex: 0x047857) : .red)
                }
            }
        }
    }
}

/// ActionReview.tsx: the gated action in words, with the raw payload underneath.
struct ActionReview: View {
    let action: String
    let input: JSON
    @State private var names: [String: String] = [:]
    @State private var showTech = false

    private static let lookups: [String: (String, String)] = [
        "customerId": ("customers.get", "customerId"), "bookingId": ("bookings.get", "bookingId"),
        "jobId": ("jobs.get", "jobId"), "invoiceId": ("invoices.get", "invoiceId"), "quoteId": ("quotes.get", "quoteId"),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(action.split(separator: ".").map { $0.replacingOccurrences(of: "([A-Z])", with: " $1", options: .regularExpression) }.joined(separator: " · "))
                .font(.caption.weight(.semibold))
            VStack(alignment: .leading, spacing: 6) {
                ForEach(input.object.keys.sorted().filter { !input[$0].isNull }, id: \.self) { k in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(label(k)).font(.caption2).foregroundStyle(.secondary)
                        Text(value(k, input[k])).font(.caption.weight(.medium))
                    }
                }
            }
            .padding(10).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.white.opacity(0.8), in: .rect(cornerRadius: 8))
            DisclosureGroup("Technical details", isExpanded: $showTech) {
                Text(input.prettyString).font(.system(size: 10, design: .monospaced)).textSelection(.enabled)
            }
            .font(.caption)
        }
        .foregroundStyle(Brand.ink700)
        .task(id: input) { await resolve() }
    }

    private func label(_ key: String) -> String {
        let fixed = ["staffIds": "Cleaners", "startAt": "Visit time", "scheduledAt": "Visit time", "wholeSeries": "All future visits", "amountCents": "Amount"]
        if let f = fixed[key] { return f }
        var s = key.replacingOccurrences(of: "Cents$|Ids?$|At$", with: "", options: .regularExpression)
        s = s.replacingOccurrences(of: "([A-Z])", with: " $1", options: .regularExpression)
        return s.prefix(1).uppercased() + s.dropFirst()
    }

    private func value(_ key: String, _ v: JSON) -> String {
        if let n = names[key] { return n }
        if key.hasSuffix("Cents"), case .number(let d) = v { return Fmt.money(Int(d)) }
        if key.hasSuffix("At"), let s = v.string, let d = Fmt.parseISO(s) {
            let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: "Asia/Kuching")
            f.dateFormat = "d/M/yyyy, h:mm:ss a"
            return f.string(from: d).lowercased() + " (MYT)"
        }
        if case .bool(let b) = v { return b ? "Yes" : "No" }
        if key.range(of: "Ids?$", options: .regularExpression) != nil { return "Record details unavailable — check details below" }
        switch v {
        case .object, .array: return String(decoding: v.data(), as: UTF8.self)
        default: return v.string ?? ""
        }
    }

    private func resolve() async {
        names = [:]
        for (key, v) in input.object {
            guard let (act, param) = Self.lookups[key], let id = v.nonEmpty else { continue }
            if let r = try? await API.shared.call(act, [param: .string(id)]) {
                names[key] = [r["ref"].nonEmpty ?? r["name"].nonEmpty, r["customer"]["name"].nonEmpty].compactMap { $0 }.joined(separator: " · ")
            }
        }
        let many = input["staffIds"].array
        let one = input["staffId"].string
        if !many.isEmpty || one != nil, let rows = try? await API.shared.call("staff.list") {
            let ids = many.isEmpty ? [one!] : many.map(\.str)
            let text = ids.map { id in rows.array.first { $0.id == id }?["name"].string ?? "Unavailable cleaner" }.joined(separator: ", ")
            names[many.isEmpty ? "staffId" : "staffIds"] = text.isEmpty ? "Unassigned" : text
        }
    }
}

/// The assistant's history: grouped by date, searchable, renamable, deletable.
struct AssistantHistory: View {
    @Binding var threads: [JSON]?
    let current: String?
    let busy: Bool
    let onOpen: (String) -> Void
    let onNew: () -> Void
    let onDeleted: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var q = ""
    @State private var found: [JSON]?
    @State private var renaming: JSON?
    @State private var renameText = ""
    @State private var deleting: JSON?

    var body: some View {
        let shown = found ?? threads ?? []
        NavigationStack {
            List {
                Button { onNew() } label: { Label(t("ai.newChat"), systemImage: "square.and.pencil") }.disabled(busy)
                if threads == nil { LoadingRow() }
                else if shown.isEmpty { Text(q.isEmpty ? t("ai.noChats") : t("ai.noMatch")).foregroundStyle(.secondary) }
                ForEach(groups(shown), id: \.0) { g in
                    Section(g.0) {
                        ForEach(g.1.rows()) { th in
                            Button { if !busy && th.id != current { onOpen(th.id) } else { dismiss() } } label: {
                                Text(th["title"].str).lineLimit(1).foregroundStyle(th.id == current ? Brand.b600 : .primary)
                                    .fontWeight(th.id == current ? .semibold : .regular)
                            }
                            .swipeActions {
                                Button(t("ai.delete"), role: .destructive) { deleting = th.json }.tint(.red)
                                Button(t("ai.rename")) { renameText = th["title"].str; renaming = th.json }.tint(Brand.b600)
                            }
                        }
                    }
                }
            }
            .searchable(text: $q, prompt: t("ai.search"))
            .navigationTitle(t("ai.history"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(t("common.close")) { dismiss() } } }
            .task(id: q) {
                let term = q.trimmingCharacters(in: .whitespaces)
                if term.isEmpty { found = nil; return }
                try? await Task.sleep(nanoseconds: 250_000_000)
                if let r = try? await API.shared.aiThreads(query: term) { found = r }
            }
            .alert(t("ai.rename"), isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
                TextField(t("ai.rename"), text: $renameText)
                Button(t("common.save")) { if let r = renaming { Task { await rename(r, renameText) } } }
                Button(t("common.cancel"), role: .cancel) {}
            }
            .confirmationDialog(t("ai.deleteConfirm"), isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
                Button(t("ai.delete"), role: .destructive) { if let d = deleting { Task { await remove(d) } } }
            }
        }
    }

    /// Today / Yesterday / Previous 7 days / Previous 30 days / Month Year.
    private func groups(_ list: [JSON]) -> [(String, [JSON])] {
        var out: [(String, [JSON])] = []
        let today = Fmt.startOfDay(Date())
        for th in list {
            let d = th["updatedAt"].date ?? Date()
            let ago = Int((today.timeIntervalSince(Fmt.startOfDay(d)) / 86400).rounded())
            let label = ago <= 0 ? t("ai.today") : ago == 1 ? t("ai.yesterday") : ago <= 7 ? t("ai.prev7") : ago <= 30 ? t("ai.prev30") : Fmt.monthYear(d)
            if out.last?.0 == label { out[out.count - 1].1.append(th) } else { out.append((label, [th])) }
        }
        return out
    }

    private func rename(_ th: JSON, _ title: String) async {
        let clean = title.trimmingCharacters(in: .whitespaces)
        guard !clean.isEmpty, clean != th["title"].str else { return }
        let set: ([JSON]?) -> [JSON]? = { list in list?.map { x in
            guard x.id == th.id else { return x }
            var o = x.object; o["title"] = .string(clean); return .object(o)
        } }
        threads = set(threads); found = set(found)
        if !(await API.shared.aiRename(th.id, title: clean)) {
            let back: ([JSON]?) -> [JSON]? = { list in list?.map { x in
                guard x.id == th.id else { return x }
                var o = x.object; o["title"] = th["title"]; return .object(o)
            } }
            threads = back(threads); found = back(found)
        }
    }

    private func remove(_ th: JSON) async {
        guard !busy, await API.shared.aiDelete(th.id) else { return }
        threads = threads?.filter { $0.id != th.id }
        found = found?.filter { $0.id != th.id }
        onDeleted(th.id)
    }
}
