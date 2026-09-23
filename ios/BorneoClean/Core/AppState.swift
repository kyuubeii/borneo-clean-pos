import SwiftUI
import Observation

enum Role: String {
    case owner = "OWNER", admin = "ADMIN", staff = "STAFF"
}

struct CurrentUser: Equatable {
    let id: String
    let name: String
    let email: String
    let role: Role
    let staffId: String?

    /// UserProvider `useCan`: the same role lists the registry declares.
    func can(_ roles: [Role]) -> Bool { roles.contains(role) }
    var isStaff: Bool { role == .staff }
    var adminUp: Bool { role == .owner || role == .admin }
    var isOwner: Bool { role == .owner }
}

/// UserProvider's role lists, so a button and its action cannot drift apart.
let ADMIN_UP: [Role] = [.owner, .admin]
let OWNER_ONLY: [Role] = [.owner]

enum Locale2: String { case en, zh }

/// The signed-in person, the language, and the bell -- what the web keeps in
/// its layout and providers.
@MainActor @Observable
final class AppState {
    static let shared = AppState()

    enum Phase: Equatable { case launching, signedOut, signedIn }
    var phase: Phase = .launching
    var user: CurrentUser?

    var locale: Locale2 = Locale2(rawValue: UserDefaults.standard.string(forKey: "bc_locale") ?? "en") ?? .en {
        didSet { UserDefaults.standard.set(locale.rawValue, forKey: "bc_locale") }
    }

    // The bell.
    var notes: [JSON] = []
    var unread = 0

    /// Bumped after a write elsewhere (the assistant, a push) so open screens re-read.
    var refreshTick = 0
    func refreshAll() { refreshTick += 1 }

    private init() {
        API.shared.onUnauthorized = { [weak self] in
            Task { @MainActor in self?.sessionEnded() }
        }
    }

    func boot() async {
        guard API.shared.hasSessionCookie else { phase = .signedOut; return }
        do {
            user = try await API.shared.me()
            phase = .signedIn
            await loadNotifications()
            Push.shared.signedIn()
        } catch {
            if (error as? APIError)?.code == "UNAUTHENTICATED" { phase = .signedOut; return }
            // Offline at launch: stay on the sign-in screen with the reason.
            phase = .signedOut
            bootError = error.localizedDescription
        }
    }
    var bootError: String?

    func signIn(email: String, password: String) async throws {
        try await API.shared.signIn(email: email, password: password)
        user = try await API.shared.me()
        phase = .signedIn
        bootError = nil
        await loadNotifications()
        Push.shared.signedIn()
    }

    func signOut() async {
        // The device goes first, while the session can still say whose it is.
        await Push.shared.signingOut()
        await API.shared.signOut()
        reset()
    }

    private func sessionEnded() {
        guard phase == .signedIn else { return }
        API.shared.clearCookies()
        reset()
        Toasts.shared.show("Your session has ended. Please sign in again.", error: true)
    }

    private func reset() {
        user = nil
        notes = []
        unread = 0
        phase = .signedOut
        Router.shared.reset()
        UIApplication.shared.applicationIconBadgeNumber = 0
    }

    // MARK: Bell -- Shell.tsx

    func loadNotifications() async {
        guard phase == .signedIn, let r = try? await API.shared.notifications() else { return }
        notes = r.items
        unread = r.unread
        UIApplication.shared.applicationIconBadgeNumber = r.unread
    }

    /// Opening the bell clears the badge and marks everything read.
    func markAllRead() {
        guard unread > 0 else { return }
        unread = 0
        notes = notes.map { n in
            var o = n.object; o["read"] = true; return .object(o)
        }
        UIApplication.shared.applicationIconBadgeNumber = 0
        Task { await API.shared.notificationsPost(op: "read") }
    }

    func dismiss(_ id: String) {
        notes.removeAll { $0.id == id }
        Task { await API.shared.notificationsPost(op: "dismiss", id: id) }
    }

    func clearAll() {
        notes = []; unread = 0
        UIApplication.shared.applicationIconBadgeNumber = 0
        Task { await API.shared.notificationsPost(op: "dismiss") }
    }
}

/// I18nProvider `t()`: the current language, falling back to English, then the key.
@MainActor
func t(_ key: String) -> String {
    let dict = AppState.shared.locale == .zh ? I18nDict.zh : I18nDict.en
    return dict[key] ?? I18nDict.en[key] ?? key
}
