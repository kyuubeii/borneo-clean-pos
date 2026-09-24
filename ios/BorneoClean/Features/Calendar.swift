import SwiftUI

/**
 calendar/page.tsx for a phone.

 The web's week board is a wide grid of cleaners by days with drag-and-drop.
 On a phone the same data reads as a day grouped by cleaner, a week grouped by
 day, and a month grid; dragging becomes a Move sheet that sends the same
 `jobs.move` (date, time and the complete team in one operation).
 */
struct CalendarView: View {
    enum Mode: String { case day, week, month }
    @State private var app = AppState.shared
    @State private var view = Mode.day
    @State private var anchor = Date()
    @State private var jobs: [JSON] = []
    @State private var staff: [JSON] = []
    @State private var error: String?
    @State private var loading = true
    @State private var move: JSON?
    @State private var more: Date?
    @State private var newAt: Date?

    private var isStaff: Bool { app.user?.isStaff == true }

    private var range: (from: Date, to: Date) {
        switch view {
        case .day: return (anchor, anchor)
        case .week: let s = Fmt.startOfWeek(anchor); return (s, Fmt.addDays(s, 6))
        case .month: let s = Fmt.startOfWeek(Fmt.startOfMonth(anchor)); return (s, Fmt.addDays(s, 41))
        }
    }

    private var title: String {
        switch view {
        case .month: return Fmt.monthYear(anchor)
        case .week: return "\(Fmt.date(Fmt.startOfWeek(anchor))) — \(Fmt.date(Fmt.addDays(Fmt.startOfWeek(anchor), 6)))"
        case .day: return Fmt.date(anchor)
        }
    }

    var body: some View {
        List {
            Section {
                VStack(spacing: 10) {
                    Picker("", selection: $view) {
                        Text(t("cal.day")).tag(Mode.day); Text(t("cal.week")).tag(Mode.week); Text(t("cal.month")).tag(Mode.month)
                    }
                    .pickerStyle(.segmented)
                    HStack {
                        Button { shift(-1) } label: { Image(systemName: "chevron.left").frame(width: 36, height: 30) }
                        Spacer()
                        Button { anchor = Date() } label: { Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.primary) }
                        Spacer()
                        Button { shift(1) } label: { Image(systemName: "chevron.right").frame(width: 36, height: 30) }
                    }
                    .buttonStyle(.borderless)
                    if view == .day { WeekStrip(anchor: $anchor, jobs: jobs) }
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
            }

            LoadErrorView(error: error) { Task { await load() } }
            if loading && jobs.isEmpty { LoadingRow() }
            else {
                switch view {
                case .day: dayBoard
                case .week: weekList
                case .month: monthGrid
                }
            }
        }
        .navigationTitle(t("nav.calendar"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !isStaff {
                ToolbarItem(placement: .topBarLeading) {
                    Button { newAt = anchor } label: { Image(systemName: "plus") }.accessibilityLabel(t("common.new"))
                }
            }
            ShellToolbar()
        }
        .task(id: "\(view.rawValue)|\(Fmt.isoDate(range.from))|\(Fmt.isoDate(range.to))") { await load() }
        .refreshable { await load() }
        .onChange(of: app.refreshTick) { Task { await load() } }
        .sheet(item: Binding(get: { move.map { Row($0) } }, set: { move = $0?.json })) { r in
            MoveJobSheet(job: r.json, staff: staff) { await load() }
        }
        .sheet(item: Binding(get: { more.map { DayItem(date: $0) } }, set: { more = $0?.date })) { d in
            NavigationStack {
                List {
                    ForEach(jobs.filter { j in j["scheduledAt"].date.map { Fmt.sameDay($0, d.date) } ?? false }.rows()) { j in
                        Button {
                            more = nil
                            Router.shared.push(.job(j.id))
                        } label: {
                            Text("\(j["scheduledAt"].date.map(Fmt.time) ?? "") · \(j["customer"].str) · \(j["ref"].str)").foregroundStyle(.primary)
                        }
                    }
                    if !isStaff {
                        Button { let day = d.date; more = nil; newAt = day } label: { Label("New booking on this day", systemImage: "plus") }
                    }
                }
                .navigationTitle(Fmt.date(d.date))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button(t("common.close")) { more = nil } } }
            }
            .presentationDetents([.medium, .large])
        }
        .sheet(item: Binding(get: { newAt.map { DayItem(date: $0) } }, set: { newAt = $0?.date })) { d in
            BookingFormView(presetStart: d.date, onDone: { Task { await load() } })
        }
    }

    struct DayItem: Identifiable { let date: Date; var id: Double { date.timeIntervalSince1970 } }

    private func shift(_ n: Int) {
        anchor = view == .month ? Fmt.addMonths(anchor, n) : Fmt.addDays(anchor, view == .week ? 7 * n : n)
    }

    private func load() async {
        loading = true
        var input: JSON = ["from": .string(Fmt.isoDate(range.from)), "to": .string(Fmt.isoDate(range.to)), "limit": 100]
        if isStaff, let s = app.user?.staffId { input.set("staffId", .string(s)) }
        let r = await API.shared.batch([("jobs.list", input), ("staff.list", [:])])
        switch r[0] { case .success(let v): jobs = v.array; error = nil; case .failure(let e): error = e.localizedDescription }
        switch r[1] { case .success(let v): staff = v.array; case .failure(let e): error = error ?? e.localizedDescription }
        loading = false
    }

    private func jobsOn(_ d: Date) -> [JSON] { jobs.filter { j in j["scheduledAt"].date.map { Fmt.sameDay($0, d) } ?? false } }

    // MARK: Day: cleaners as groups

    @ViewBuilder private var dayBoard: some View {
        let rows: [JSON] = isStaff ? staff.filter { $0.id == app.user?.staffId } : staff + [["id": "none", "name": .string(t("cal.unassigned")), "colour": "#cbd5e1"]]
        let day = jobsOn(anchor)
        if day.isEmpty { EmptyState(text: t("dash.noJobsToday"), icon: "calendar") }
        ForEach(rows.rows()) { s in
            let mine = day.filter { j in s.id == "none" ? j["cleaners"].array.isEmpty : j["staffIds"].array.contains(.string(s.id)) }
            if !mine.isEmpty {
                Section {
                    ForEach(mine.rows()) { j in chip(j) }
                } header: {
                    HStack(spacing: 6) {
                        Circle().fill(Color(css: s["colour"].str)).frame(width: 9, height: 9)
                        Text(s["name"].str)
                        Spacer()
                        Text("\(mine.count)")
                    }
                }
            }
        }
    }

    // MARK: Week: days as groups

    @ViewBuilder private var weekList: some View {
        let days = (0..<7).map { Fmt.addDays(Fmt.startOfWeek(anchor), $0) }
        ForEach(days, id: \.self) { d in
            let list = jobsOn(d)
            Section {
                if list.isEmpty { Text("—").foregroundStyle(.tertiary) }
                ForEach(list.rows()) { j in chip(j) }
            } header: {
                HStack {
                    Text("\(Fmt.cal.shortWeekdaySymbols[Fmt.cal.component(.weekday, from: d) - 1]) \(Fmt.cal.component(.day, from: d))")
                        .foregroundStyle(Fmt.sameDay(d, Date()) ? Brand.b600 : .secondary)
                    Spacer()
                    if !isStaff { Button { newAt = d } label: { Image(systemName: "plus") }.buttonStyle(.borderless) }
                }
            }
        }
    }

    // MARK: Month grid

    @ViewBuilder private var monthGrid: some View {
        let days = (0..<42).map { Fmt.addDays(range.from, $0) }
        let month = Fmt.cal.component(.month, from: anchor)
        Section {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 0), count: 7), spacing: 0) {
                ForEach(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], id: \.self) {
                    Text($0).font(.caption2.weight(.semibold)).foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 6)
                }
                ForEach(days, id: \.self) { d in
                    let cell = jobsOn(d)
                    let revenue = cell.reduce(0) { $0 + $1["revenueCents"].i }
                    let inMonth = Fmt.cal.component(.month, from: d) == month
                    let today = Fmt.sameDay(d, Date())
                    Button { if !cell.isEmpty || !isStaff { more = d } } label: {
                        VStack(spacing: 3) {
                            Text("\(Fmt.cal.component(.day, from: d))")
                                .font(.caption.weight(today ? .bold : .medium))
                                .foregroundStyle(today ? .white : inMonth ? .primary : .secondary)
                                .frame(width: 24, height: 24)
                                .background(today ? Brand.b600 : .clear, in: .circle)
                            HStack(spacing: 2) {
                                ForEach(0..<min(cell.count, 3), id: \.self) { i in
                                    Circle().fill(cell[i]["status"].str == "COMPLETED" ? Brand.good : cell[i]["status"].str == "CANCELLED" ? Color.red : Brand.b500).frame(width: 5, height: 5)
                                }
                                if cell.count > 3 { Text("+\(cell.count - 3)").font(.system(size: 8)).foregroundStyle(.secondary) }
                            }
                            .frame(height: 6)
                            Text(revenue > 0 ? "\(Int(Fmt.jsRound(Double(revenue) / 100)))" : " ")
                                .font(.system(size: 9)).monospacedDigit().foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, minHeight: 58)
                        .background(inMonth ? Color.clear : Color(.tertiarySystemFill).opacity(0.5))
                    }
                    .buttonStyle(.row)
                }
            }
        } footer: { Text("Tap a day to see its jobs. The small figure is that day's job value in RM.") }
    }

    // MARK: Job chip

    @ViewBuilder private func chip(_ j: Row) -> some View {
        let s = j["status"].str
        let locked = s == "COMPLETED" || s == "CANCELLED"
        NavigationLink(value: Route.job(j.id)) {
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 2).fill(s == "COMPLETED" ? Brand.good : s == "CANCELLED" ? Color.red : s == "IN_PROGRESS" ? Color.blue : Brand.ink300)
                    .frame(width: 4)
                VStack(alignment: .leading, spacing: 2) {
                    Text(j["scheduledAt"].date.map(Fmt.time) ?? "").font(.caption.weight(.semibold)).monospacedDigit()
                    Text(j["customer"].str).font(.subheadline).strikethrough(s == "CANCELLED").lineLimit(1)
                    let cl = j["cleaners"].array.map(\.str)
                    if view == .week { Text(cl.isEmpty ? t("cal.unassigned") : cl.joined(separator: ", ")).font(.caption2).foregroundStyle(cl.isEmpty ? Brand.warn : .secondary).lineLimit(1) }
                }
                Spacer()
                StatusBadge(status: s, label: t("job.status.\(s)"))
            }
        }
        .swipeActions {
            if !isStaff && !locked { Button("Move") { move = j.json }.tint(Brand.b600) }
        }
        .contextMenu {
            if !isStaff && !locked { Button { move = j.json } label: { Label("Move / reassign…", systemImage: "arrow.left.arrow.right") } }
        }
    }
}

/// A week of days with job counts, for picking a day on the day view.
struct WeekStrip: View {
    @Binding var anchor: Date
    let jobs: [JSON]
    var body: some View {
        let start = Fmt.startOfWeek(anchor)
        HStack(spacing: 4) {
            ForEach(0..<7, id: \.self) { i in
                let d = Fmt.addDays(start, i)
                let on = Fmt.sameDay(d, anchor)
                Button { anchor = d } label: {
                    VStack(spacing: 2) {
                        Text(Fmt.cal.veryShortWeekdaySymbols[i]).font(.caption2).foregroundStyle(on ? .white.opacity(0.85) : .secondary)
                        Text("\(Fmt.cal.component(.day, from: d))").font(.subheadline.weight(.semibold))
                            .foregroundStyle(on ? .white : Fmt.sameDay(d, Date()) ? Brand.b600 : .primary)
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 6)
                    .background(on ? Brand.b600 : Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 10))
                }
                .buttonStyle(.row)
            }
        }
    }
}

/// The web's "Review schedule change": a new date and time and the complete team.
struct MoveJobSheet: View {
    let job: JSON
    let staff: [JSON]
    let onDone: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var when = Date()
    @State private var staffIds: [String] = []
    @State private var moving = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("\(job["ref"].str) · \(job["customer"].str)").font(.headline)
                    DatePicker("New date & time", selection: $when)
                    Text("\(job["scheduledAt"].date.map(Fmt.date) ?? "") → \(Fmt.date(when)) · \(Fmt.time(when))").font(.footnote).foregroundStyle(.secondary)
                }
                Section {
                    ForEach(staff.rows()) { s in
                        Toggle(isOn: Binding(get: { staffIds.contains(s.id) }, set: { on in
                            if on { staffIds.append(s.id) } else { staffIds.removeAll { $0 == s.id } }
                        })) {
                            HStack { Circle().fill(Color(css: s["colour"].str)).frame(width: 9, height: 9); Text(s["name"].str) }
                        }
                    }
                } header: { Text("Team") } footer: { Text("Choose the complete team. Existing team members are kept for multi-cleaner jobs.") }
            }
            .navigationTitle("Review schedule change")
            .navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled(moving)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() }.disabled(moving) }
                ToolbarItem(placement: .confirmationAction) { Button(moving ? "Saving…" : "Apply") { Task { await save() } }.disabled(moving) }
            }
            .onAppear {
                when = Fmt.toMinute(job["scheduledAt"].date ?? Date())
                staffIds = job["staffIds"].array.map(\.str)
            }
        }
    }

    private func save() async {
        moving = true
        do {
            try await API.shared.call("jobs.move", ["jobId": .string(job.id), "scheduledAt": .string(Fmt.iso(Fmt.toMinute(when))), "staffIds": JSON(staffIds)])
            toast("Schedule updated"); await onDone(); dismiss()
        } catch { toast(error.localizedDescription, error: true) }
        moving = false
    }
}
