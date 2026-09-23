import SwiftUI

/**
 Shell.tsx for a phone: the sidebar's groups become tabs and a More list, and
 each role sees only what its navigation shows on the web.
 */
struct MainTabs: View {
    let user: CurrentUser
    @State private var router = Router.shared
    @State private var app = AppState.shared

    var body: some View {
        TabView(selection: $router.tab) {
            stack(.home) { user.isStaff ? AnyView(StaffDashboardView()) : AnyView(DashboardView()) }
                .tabItem { Label(user.isStaff ? t("common.today") : t("nav.dashboard"), systemImage: "square.grid.2x2") }
                .tag(Tab.home)
            stack(.calendar) { CalendarView() }
                .tabItem { Label(t("nav.calendar"), systemImage: "calendar") }
                .tag(Tab.calendar)
            stack(.jobs) { JobsView() }
                .tabItem { Label(t("nav.jobs"), systemImage: "briefcase") }
                .tag(Tab.jobs)
            if user.isStaff {
                stack(.expenses) { ExpensesView() }
                    .tabItem { Label(t("nav.expenses"), systemImage: "dollarsign.circle") }
                    .tag(Tab.expenses)
            } else {
                stack(.money) { MoneyHub() }
                    .tabItem { Label(t("nav.group.money"), systemImage: "banknote") }
                    .tag(Tab.money)
            }
            stack(.more) { MoreView() }
                .tabItem { Label("More", systemImage: "ellipsis.circle") }
                .tag(Tab.more)
        }
        .sheet(isPresented: $router.showBell) { BellView() }
        .fullScreenCover(isPresented: $router.showAssistant) { AssistantView() }
        .task {
            // Shell.tsx: once, then on a slow poll.
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 60_000_000_000)
                await app.loadNotifications()
            }
        }
    }

    private func stack<V: View>(_ tab: Tab, @ViewBuilder root: () -> V) -> some View {
        NavigationStack(path: router.path(tab)) {
            root().navigationDestination(for: Route.self) { destination($0) }
        }
    }
}

@MainActor @ViewBuilder
func destination(_ r: Route) -> some View {
    switch r {
    case .job(let id): JobDetailView(id: id)
    case .booking(let id): BookingDetailView(id: id)
    case .customer(let id): CustomerDetailView(id: id)
    case .invoice(let id): InvoiceDetailView(id: id)
    case .staff(let id): StaffDetailView(id: id)
    case .bookings: BookingsView()
    case .customers: CustomersView()
    case .staffList: StaffView()
    case .services: ServicesView()
    case .quotes: QuotesView()
    case .invoices: InvoicesView()
    case .payments: PaymentsView()
    case .expenses: ExpensesView()
    case .payroll: PayrollView()
    case .reports: ReportsView()
    case .users: UsersView()
    case .audit: AuditView()
    case .settings: SettingsView()
    case .notificationPrefs: NotificationPrefsView()
    case .calendar: CalendarView()
    case .jobs: JobsView()
    }
}

/// The sidebar's Money group.
struct MoneyHub: View {
    var body: some View {
        List {
            Section {
                NavigationLink(value: Route.invoices) { Label(t("nav.invoices"), systemImage: "doc.text") }
                NavigationLink(value: Route.payments) { Label(t("nav.payments"), systemImage: "creditcard") }
                NavigationLink(value: Route.expenses) { Label(t("nav.expenses"), systemImage: "dollarsign.circle") }
                NavigationLink(value: Route.payroll) { Label(t("nav.payroll"), systemImage: "person.2.badge.gearshape") }
            }
            Section {
                NavigationLink(value: Route.quotes) { Label(t("nav.quotes"), systemImage: "doc.plaintext") }
                NavigationLink(value: Route.reports) { Label(t("nav.reports"), systemImage: "chart.xyaxis.line") }
            }
        }
        .navigationTitle(t("nav.group.money"))
        .toolbar { ShellToolbar() }
    }
}

struct MoreView: View {
    @State private var app = AppState.shared
    @State private var confirmSignOut = false

    var body: some View {
        let u = app.user
        List {
            if let u {
                Section {
                    HStack(spacing: 12) {
                        Avatar(name: u.name, colour: "#1f66f0", size: 42)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(u.name).font(.headline)
                            Text("\(u.email) · \(u.role.rawValue)").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
            if u?.adminUp == true {
                Section(t("nav.group.operations")) {
                    NavigationLink(value: Route.bookings) { Label(t("nav.bookings"), systemImage: "calendar.badge.checkmark") }
                    NavigationLink(value: Route.customers) { Label(t("nav.customers"), systemImage: "person.2") }
                    NavigationLink(value: Route.staffList) { Label(t("nav.staff"), systemImage: "person.crop.circle") }
                    NavigationLink(value: Route.services) { Label(t("nav.services"), systemImage: "list.bullet") }
                }
                Section(t("nav.group.admin")) {
                    if u?.isOwner == true {
                        NavigationLink(value: Route.users) { Label(t("nav.users"), systemImage: "person.badge.key") }
                    }
                    NavigationLink(value: Route.audit) { Label(t("nav.audit"), systemImage: "clock.arrow.circlepath") }
                    NavigationLink(value: Route.settings) { Label(t("nav.settings"), systemImage: "gearshape") }
                }
            }
            Section {
                NavigationLink(value: Route.notificationPrefs) { Label("Push notifications", systemImage: "bell.badge") }
                HStack {
                    Label("Language", systemImage: "globe")
                    Spacer()
                    LanguagePicker().frame(maxWidth: 150)
                }
            }
            Section {
                Button(role: .destructive) { confirmSignOut = true } label: { Label(t("auth.signOut"), systemImage: "rectangle.portrait.and.arrow.right") }
            }
        }
        .navigationTitle("More")
        .toolbar { ShellToolbar() }
        .confirmationDialog(t("auth.signOut"), isPresented: $confirmSignOut) {
            Button(t("auth.signOut"), role: .destructive) { Task { await app.signOut() } }
        }
    }
}

/// Shell.tsx's bell menu.
struct BellView: View {
    @State private var app = AppState.shared
    @Environment(\.dismiss) private var dismiss
    /// Ids that were unread when the bell opened stay highlighted while it is open.
    @State private var fresh: Set<String> = []

    var body: some View {
        NavigationStack {
            List {
                if app.notes.isEmpty {
                    EmptyState(text: "You're all caught up", icon: "bell.slash").listRowBackground(Color.clear)
                }
                ForEach(app.notes, id: \.id) { n in
                    Button {
                        let link = n["link"].string
                        dismiss()
                        Router.shared.open(link: link)
                    } label: {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(n["title"].str).font(.subheadline.weight(.medium)).foregroundStyle(.primary)
                            if let b = n["body"].nonEmpty { Text(b).font(.caption).foregroundStyle(.secondary) }
                            if let d = n["createdAt"].date { Text(Fmt.stamp(d)).font(.caption2).foregroundStyle(.tertiary) }
                        }
                        .padding(.vertical, 2)
                    }
                    .listRowBackground(fresh.contains(n.id) ? Brand.b50 : Color(.secondarySystemGroupedBackground))
                    .swipeActions { Button("Dismiss", role: .destructive) { app.dismiss(n.id) } }
                }
            }
            .navigationTitle("Notifications")
            .navigationBarTitleDisplayMode(.inline)
            .refreshable { await app.loadNotifications() }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.close")) { dismiss() } }
                if !app.notes.isEmpty {
                    ToolbarItem(placement: .confirmationAction) { Button("Clear all") { app.clearAll() } }
                }
            }
            .onAppear {
                fresh = Set(app.notes.filter { !$0["read"].truthy }.map(\.id))
                app.markAllRead()
            }
        }
        .presentationDetents([.medium, .large])
    }
}
