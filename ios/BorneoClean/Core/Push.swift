import SwiftUI
import UserNotifications
import Observation

/// Every notification type the server raises, from the notify() call sites,
/// plus Other for anything `notifications.send` is given.
struct PushType: Identifiable {
    let id: String
    let label: String
    let detail: String
}

let PUSH_TYPES: [PushType] = [
    PushType(id: "BOOKING_CONFIRMED", label: "New bookings", detail: "A booking is created, or an online booking request arrives."),
    PushType(id: "SCHEDULE_CHANGE", label: "Schedule changes", detail: "A booking or job is moved or cancelled."),
    PushType(id: "STAFF", label: "Cleaner assignments", detail: "A cleaner is added to a job."),
    PushType(id: "JOB_COMPLETED", label: "Jobs completed", detail: "A job is marked complete."),
    PushType(id: "INVOICE", label: "Invoices", detail: "An invoice is created or raised."),
    PushType(id: "REMINDER", label: "Reminders", detail: "Reminders sent to the team."),
    PushType(id: "OTHER", label: "Other", detail: "Any other notice from the office."),
]

/**
 Push notifications for this phone.

 The bell is untouched: it still shows every notification exactly as the web
 does. Push is an extra copy of the same notice, sent only for the types this
 person has left switched on, and the choice is kept per phone on the server.
 */
@MainActor @Observable
final class Push: NSObject {
    static let shared = Push()

    var status: UNAuthorizationStatus = .notDetermined
    var types: Set<String> = []
    var registered = false
    var lastError: String?

    private(set) var token: String? = UserDefaults.standard.string(forKey: "bc.push.token")

    static var environment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }

    func refreshStatus() async {
        status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    /// After sign-in: ask once, then register with APNs.
    func signedIn() {
        Task {
            let center = UNUserNotificationCenter.current()
            await refreshStatus()
            if status == .notDetermined {
                _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
                await refreshStatus()
            }
            if status == .authorized || status == .provisional || status == .ephemeral {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    func requestAgain() {
        Task {
            await refreshStatus()
            if status == .denied, let url = URL(string: UIApplication.openSettingsURLString) {
                await UIApplication.shared.open(url)
            } else { signedIn() }
        }
    }

    func didRegister(tokenData: Data) {
        let hex = tokenData.map { String(format: "%02x", $0) }.joined()
        token = hex
        UserDefaults.standard.set(hex, forKey: "bc.push.token")
        Task { await sync(types: nil) }
    }

    func didFail(_ error: Error) {
        lastError = error.localizedDescription
    }

    /// Sends the token (and, when changing them, the chosen types) to the server.
    func sync(types newTypes: Set<String>?) async {
        guard let token, AppState.shared.phase == .signedIn else { return }
        do {
            let d = try await API.shared.registerDevice(token: token, environment: Self.environment,
                                                        types: newTypes.map { Array($0).sorted() })
            types = Set(d["types"].array.compactMap(\.string))
            registered = true
            lastError = nil
        } catch {
            lastError = error.localizedDescription
            if newTypes != nil { toast(error.localizedDescription, error: true) }
        }
    }

    func setType(_ id: String, on: Bool) {
        var next = types
        if on { next.insert(id) } else { next.remove(id) }
        types = next
        Task { await sync(types: next) }
    }

    func signingOut() async {
        if let token { await API.shared.unregisterDevice(token: token) }
        registered = false
        types = []
    }
}

extension Push: UNUserNotificationCenterDelegate {
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        await MainActor.run {
            Task { await AppState.shared.loadNotifications() }
            AppState.shared.refreshAll()
        }
        return [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let link = response.notification.request.content.userInfo["link"] as? String
        await MainActor.run {
            Router.shared.open(link: link)
            Task { await AppState.shared.loadNotifications() }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = Push.shared
        return true
    }
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in Push.shared.didRegister(tokenData: deviceToken) }
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Task { @MainActor in Push.shared.didFail(error) }
    }
}
