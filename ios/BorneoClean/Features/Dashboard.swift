import SwiftUI

/// dashboard/page.tsx OwnerDashboard.
struct DashboardView: View {
    @State private var brief: JSON?
    @State private var summary: JSON?
    @State private var outstanding: JSON?
    @State private var upcoming: [JSON] = []
    @State private var activity: [JSON] = []
    @State private var trend: [JSON] = []
    @State private var summaryErr: String?
    @State private var outstandingErr: String?
    @State private var loaded = false
    @State private var newBooking = false
    /// The month the sales figures and the revenue chart cover. Today's jobs,
    /// what is owed, upcoming bookings and activity are always about now.
    @State private var month = Fmt.startOfMonth(Date())

    private var isThisMonth: Bool { Fmt.sameDay(month, Fmt.startOfMonth(Date())) }
    private func inMonth(_ thisMonthKey: String, _ key: String) -> String {
        isThisMonth ? t(thisMonthKey) : "\(t(key)) · \(Fmt.monthYear(month))"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack { Spacer(); MonthPicker(month: $month) }
                LoadErrorView(error: summaryErr ?? outstandingErr) { Task { await load() } }

                StatGrid {
                    let s = summary, o = outstanding
                    StatTile(label: inMonth("dash.salesMonth", "dash.sales"), value: figure(s, summaryErr) { Fmt.moneyUI($0["salesCents"].i) },
                             sub: s.map { "\(t("dash.collected")) \(Fmt.moneyUI($0["revenueCollectedCents"].i)) · \(t("dash.profit")) \(Fmt.moneyUI($0["profitCents"].i)) (\(pct($0["marginPct"]))%)" },
                             tone: s == nil ? .normal : (s!["profitCents"].i >= 0 ? .good : .bad))
                    StatTile(label: t("dash.outstanding"), value: figure(o, outstandingErr) { Fmt.moneyUI($0["totalOutstandingCents"].i) },
                             sub: o.map { "\($0["openInvoices"].i) open · \($0["overdueInvoices"].i) \(t("dash.overdueInvoices"))" },
                             tone: (o?["overdueCents"].i ?? 0) > 0 ? .warn : .normal)
                    StatTile(label: inMonth("dash.jobsThisMonth", "dash.jobs"), value: figure(s, summaryErr) { "\($0["jobsScheduled"].i)" },
                             sub: s.map { "\($0["jobsCompleted"].i) \(t("dash.completed").lowercased())\($0["jobsCancelled"].i > 0 ? " · \($0["jobsCancelled"].i) \(t("job.status.CANCELLED").lowercased())" : "")" })
                    StatTile(label: t("dash.avgJob"), value: figure(s, summaryErr) { Fmt.moneyUI($0["avgJobValueCents"].i) },
                             sub: s.map { "\($0["newCustomers"].i) \(t("dash.newCustomers").lowercased())" })
                }

                attention

                Card(title: t("dash.todayJobs"), trailing: AnyView(
                    Button(t("common.view")) { Router.shared.tab = .jobs }.font(.caption.weight(.medium)))) {
                    let jobs = brief?["jobs"].array ?? []
                    if !loaded { LoadingRow() }
                    else if jobs.isEmpty { EmptyState(text: t("dash.noJobsToday"), icon: "sun.max") }
                    else {
                        VStack(spacing: 0) {
                            ForEach(jobs.rows(key: "ref")) { j in
                                HStack(spacing: 10) {
                                    Text(j["time"].date.map(Fmt.time) ?? "").font(.caption.weight(.semibold)).monospacedDigit()
                                        .foregroundStyle(.secondary).frame(width: 58, alignment: .leading)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(j["customer"].str).font(.subheadline.weight(.medium)).lineLimit(1)
                                        let cl = j["cleaners"].array.map(\.str)
                                        Text("\(j["ref"].str) · \(cl.isEmpty ? t("cal.unassigned") : cl.joined(separator: ", "))")
                                            .font(.caption).foregroundStyle(cl.isEmpty ? Brand.warn : .secondary).lineLimit(1)
                                    }
                                    Spacer()
                                    StatusBadge(status: j["status"].str, label: t("job.status.\(j["status"].str)"))
                                }
                                .padding(.horizontal, 14).padding(.vertical, 9)
                                Divider().padding(.leading, 14)
                            }
                        }
                    }
                }

                Card(title: t("dash.upcoming")) {
                    if upcoming.isEmpty { EmptyState(text: t("common.empty")) }
                    else {
                        VStack(spacing: 0) {
                            ForEach(upcoming.rows()) { bk in
                                NavigationLink(value: Route.booking(bk.id)) {
                                    HStack {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(bk["customer"]["name"].str).font(.subheadline.weight(.medium)).foregroundStyle(.primary)
                                            Text(bk["startAt"].date.map { "\(Fmt.date($0)) · \(Fmt.time($0))" } ?? "").font(.caption).foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                                    }
                                    .padding(.horizontal, 14).padding(.vertical, 9)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.row)
                                Divider().padding(.leading, 14)
                            }
                        }
                    }
                }

                Card(title: inMonth("dash.revenueMonth", "dash.revenue")) {
                    BarChart(data: trend, height: 128, showPeak: false).padding(14)
                }

                Card(title: t("dash.activity")) {
                    VStack(spacing: 0) {
                        ForEach(activity.prefix(8).map { $0 }.rows()) { a in
                            HStack(alignment: .top, spacing: 8) {
                                Circle().fill(a["ok"].truthy ? Color.green : Color.red).frame(width: 6, height: 6).padding(.top, 6)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(a["action"].str).font(.caption.weight(.medium)).lineLimit(1)
                                    Text("\(a["actorName"].str) · \(a["source"].str) · \(a["createdAt"].date.map(Fmt.shortStamp) ?? "")")
                                        .font(.caption2).foregroundStyle(.secondary)
                                }
                                Spacer()
                            }
                            .padding(.horizontal, 14).padding(.vertical, 6)
                        }
                    }
                    .padding(.bottom, 8)
                }
            }
            .padding(16)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(t("dash.title"))
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button { newBooking = true } label: { Label(t("nav.bookings"), systemImage: "plus") }
            }
            ShellToolbar()
        }
        .sheet(isPresented: $newBooking) { BookingFormView(onDone: { Task { await load() } }) }
        .loads(load)
        .onChange(of: month) { Task { await load() } }
    }

    @ViewBuilder private var attention: some View {
        let a = brief?["needsAttention"]
        let unassigned = a?["unassignedJobs"].array.count ?? 0
        let overdue = a?["overdueInvoices"].i ?? 0
        if unassigned > 0 || overdue > 0 {
            VStack(alignment: .leading, spacing: 8) {
                Label(t("dash.needsAttention"), systemImage: "exclamationmark.triangle").font(.caption.weight(.semibold))
                    .foregroundStyle(Color(hex: 0x78350F))
                HStack(spacing: 8) {
                    if unassigned > 0 {
                        Button("\(unassigned) \(t("dash.unassigned_plural"))") { Router.shared.tab = .calendar }
                    }
                    if overdue > 0 {
                        Button("\(overdue) \(t("dash.overdueInvoices")) · \(Fmt.moneyUI(a?["overdueAmountCents"].i ?? 0))") { Router.shared.push(.invoices) }
                    }
                }
                .buttonStyle(.bordered).controlSize(.small).tint(Color(hex: 0xB45309))
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(hex: 0xFFFBEB), in: .rect(cornerRadius: 14))
        }
    }

    /// A figure that has not arrived is not a figure of zero.
    private func figure(_ d: JSON?, _ err: String?, _ render: (JSON) -> String) -> String {
        d.map(render) ?? (err != nil ? "unavailable" : "—")
    }

    private func pct(_ j: JSON) -> String {
        let v = j.double ?? 0
        return v.rounded() == v ? String(Int(v)) : String(v)
    }

    func load() async {
        let monthFrom = Fmt.isoDate(Fmt.startOfMonth(month)), monthTo = Fmt.isoDate(Fmt.endOfMonth(month))
        let r = await API.shared.batch([
            ("reports.dailyBriefing", [:]),
            ("reports.summary", ["from": .string(monthFrom), "to": .string(monthTo)]),
            ("payments.outstanding", [:]),
            ("bookings.list", ["from": .string(Fmt.isoDate(Date().addingTimeInterval(86400))), "limit": 6, "status": "CONFIRMED"]),
            ("audit.list", ["limit": 8]),
            ("reports.revenueTrend", ["from": .string(monthFrom), "to": .string(monthTo), "granularity": "day"]),
        ])
        if case .success(let v) = r[0] { brief = v }
        switch r[1] { case .success(let v): summary = v; summaryErr = nil; case .failure(let e): summaryErr = e.localizedDescription }
        switch r[2] { case .success(let v): outstanding = v; outstandingErr = nil; case .failure(let e): outstandingErr = e.localizedDescription }
        if case .success(let v) = r[3] { upcoming = v.array }
        if case .success(let v) = r[4] { activity = v.array }
        if case .success(let v) = r[5] { trend = v.array }
        loaded = true
    }
}

/// The dashboard's Sparkline and the reports' Bars: revenue per period.
struct BarChart: View {
    let data: [JSON]
    var height: CGFloat = 140
    var showPeak = true
    var body: some View {
        if data.isEmpty {
            Text("—").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 30)
        } else {
            let values = data.map { $0["revenueCents"].i }
            let peak = max(values.max() ?? 1, 1)
            VStack(spacing: 6) {
                HStack(alignment: .bottom, spacing: data.count > 40 ? 1 : 2) {
                    ForEach(Array(values.enumerated()), id: \.offset) { _, v in
                        RoundedRectangle(cornerRadius: 2)
                            .fill(Brand.b500.opacity(0.85))
                            .frame(height: max(2, CGFloat(v) / CGFloat(peak) * height))
                            .frame(maxWidth: .infinity)
                    }
                }
                .frame(height: height, alignment: .bottom)
                HStack {
                    Text(label(data.first)).font(.caption2).foregroundStyle(.secondary)
                    Spacer()
                    if showPeak { Text("Peak RM \(peak / 100)").font(.caption2).foregroundStyle(.secondary); Spacer() }
                    Text(label(data.last)).font(.caption2).foregroundStyle(.secondary)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Revenue trend, peak \(Fmt.money(peak))")
        }
    }
    private func label(_ j: JSON?) -> String {
        let p = j?["period"].str ?? ""
        return showPeak ? p : String(p.dropFirst(5))
    }
}

/// StaffDashboard.tsx: a cleaner's own day, not the business's books.
struct StaffDashboardView: View {
    @State private var app = AppState.shared
    @State private var data: JSON?
    @State private var error: String?
    @State private var busy: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                LoadErrorView(error: error) { Task { await load() } }
                if data == nil && error == nil { LoadingRow() }
                StatGrid {
                    StatTile(label: t("dash.todayJobs"), value: "\(data?["jobsToday"].i ?? 0)",
                             sub: "\(data?["completedToday"].i ?? 0) \(t("dash.completed").lowercased())")
                    StatTile(label: t("staff.hoursWeek"), value: hours(data?["hoursThisWeek"]))
                    StatTile(label: t("staff.earnedWeek"), value: Fmt.moneyUI(data?["earnedThisWeekCents"].i ?? 0), tone: .good)
                    StatTile(label: t("staff.upcomingJobs"), value: "\(data?["upcomingJobs"].i ?? 0)")
                }
                Text(t("dash.todayJobs")).font(.headline).padding(.top, 4)
                let jobs = data?["jobs"].array ?? []
                if data != nil && jobs.isEmpty { EmptyState(text: t("dash.noJobsToday"), icon: "sun.max") }
                ForEach(jobs.rows()) { j in
                    let checkedIn = data?["checkedInToJobId"].string == j.id
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(j["customer"].str).font(.headline)
                                Text("\(j["time"].date.map(Fmt.time) ?? "") · \(Fmt.minsToLabel(j["durationMin"].i)) · \(j["ref"].str)")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            StatusBadge(status: j["status"].str, label: t("job.status.\(j["status"].str)"))
                        }
                        if let a = j["address"].nonEmpty {
                            Button { openMaps(a) } label: { Label(a, systemImage: "mappin.and.ellipse").font(.subheadline) }
                                .buttonStyle(.row).foregroundStyle(.secondary)
                        }
                        if j["checklistTotal"].i > 0 {
                            ProgressView(value: Double(j["checklistDone"].i), total: Double(j["checklistTotal"].i)) {
                                Text("\(t("job.checklist")): \(j["checklistDone"].i)/\(j["checklistTotal"].i)").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        HStack(spacing: 8) {
                            NavigationLink(value: Route.job(j.id)) { Text(t("common.view")).frame(maxWidth: .infinity) }
                                .buttonStyle(.bordered)
                            if j["status"].str != "COMPLETED" && j["status"].str != "CANCELLED" {
                                Button { Task { await toggle(j.id, checkedIn) } } label: {
                                    Text(checkedIn ? t("job.checkOut") : t("job.checkIn")).frame(maxWidth: .infinity)
                                }
                                .buttonStyle(checkedIn ? AnyPrimitiveButtonStyle(.bordered) : AnyPrimitiveButtonStyle(.borderedProminent))
                                .disabled(busy != nil)
                            }
                        }
                        .controlSize(.large)
                    }
                    .padding(14)
                    .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 14))
                }
            }
            .padding(16)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("\(t("common.today")) · \(data?["staffName"].nonEmpty ?? app.user?.name ?? "")")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ShellToolbar() }
        .loads(load)
    }

    private func hours(_ j: JSON?) -> String {
        let v = j?.double ?? 0
        return v.rounded() == v ? String(Int(v)) : String(v)
    }

    func load() async {
        do { data = try await API.shared.call("reports.myDay"); error = nil }
        catch { self.error = error.localizedDescription }
    }

    private func toggle(_ jobId: String, _ checkedIn: Bool) async {
        guard let staffId = app.user?.staffId else { return toast("No cleaner profile linked to your account", error: true) }
        busy = jobId
        do {
            let r = try await API.shared.call(checkedIn ? "staff.checkOut" : "staff.checkIn", ["jobId": .string(jobId), "staffId": .string(staffId)])
            toast(r["message"].string ?? (checkedIn ? "Checked out" : "Checked in"))
            await load()
        } catch { toast(error.localizedDescription, error: true) }
        busy = nil
    }
}

func openMaps(_ address: String) {
    let q = address.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
    if let url = URL(string: "http://maps.apple.com/?q=\(q)") { UIApplication.shared.open(url) }
}

func call(_ phone: String) {
    let digits = phone.filter { "+0123456789".contains($0) }
    if let url = URL(string: "tel:\(digits)") { UIApplication.shared.open(url) }
}

/// Lets a button switch between bordered and prominent without two copies.
struct AnyPrimitiveButtonStyle: PrimitiveButtonStyle {
    private let make: (Configuration) -> AnyView
    init<S: PrimitiveButtonStyle>(_ s: S) { make = { AnyView(s.makeBody(configuration: $0)) } }
    func makeBody(configuration: Configuration) -> some View { make(configuration) }
}
