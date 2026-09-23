import SwiftUI
import Observation

/// A screen that can be pushed from anywhere -- the web's detail routes.
enum Route: Hashable {
    case job(String)
    case booking(String)
    case customer(String)
    case invoice(String)
    case staff(String)
    case bookings, customers, staffList, services, quotes, invoices, payments, expenses, payroll, reports
    case users, audit, settings, notificationPrefs, calendar, jobs
}

enum Tab: Hashable { case home, calendar, jobs, money, expenses, more }

@MainActor @Observable
final class Router {
    static let shared = Router()
    var tab: Tab = .home
    var paths: [Tab: NavigationPath] = [:]
    var showAssistant = false
    var showBell = false

    func path(_ tab: Tab) -> Binding<NavigationPath> {
        Binding(get: { self.paths[tab] ?? NavigationPath() }, set: { self.paths[tab] = $0 })
    }

    func push(_ r: Route) {
        var p = paths[tab] ?? NavigationPath()
        p.append(r)
        paths[tab] = p
    }

    func reset() {
        tab = .home
        paths = [:]
        showAssistant = false
        showBell = false
    }

    /**
     Follows a web path from a notification (`/jobs/<id>`, `/invoices/<id>` ...).
     Detail screens handle a record the person may not open -- a cleaner
     tapping an invoice notice -- by showing the server's refusal.
     */
    func open(link: String?) {
        guard let link, !link.isEmpty, link != "#" else { return }
        let parts = link.split(separator: "/").map(String.init)
        guard let first = parts.first else { return }
        let id = parts.count > 1 ? parts[1] : nil
        let route: Route? = {
            switch (first, id) {
            case ("jobs", let i?): return .job(i)
            case ("bookings", let i?): return .booking(i)
            case ("customers", let i?): return .customer(i)
            case ("invoices", let i?): return .invoice(i)
            case ("staff", let i?): return .staff(i)
            case ("jobs", nil): return .jobs
            case ("bookings", nil): return .bookings
            case ("invoices", nil): return .invoices
            case ("calendar", nil): return .calendar
            default: return nil
            }
        }()
        guard let route else { return }
        showBell = false
        showAssistant = false
        push(route)
    }
}
