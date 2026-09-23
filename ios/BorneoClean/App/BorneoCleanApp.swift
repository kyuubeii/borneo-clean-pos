import SwiftUI

@main
struct BorneoCleanApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var app = AppState.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .overlay { ToastOverlay() }
                .tint(Brand.b600)
                .task { await app.boot() }
                // borneoclean://jobs/<id> opens the same screens a notification does.
                .onOpenURL { url in
                    guard app.phase == .signedIn else { return }
                    Router.shared.open(link: "/\(url.host ?? "")\(url.path)")
                }
                .onChange(of: scenePhase) { _, phase in
                    // Shell.tsx re-reads the bell when the tab comes back into focus.
                    if phase == .active, app.phase == .signedIn {
                        Task { await app.loadNotifications() }
                    }
                }
        }
    }
}

struct RootView: View {
    @State private var app = AppState.shared
    var body: some View {
        switch app.phase {
        case .launching:
            ZStack {
                Color(.systemGroupedBackground).ignoresSafeArea()
                VStack(spacing: 14) {
                    BrandMark(size: 56)
                    ProgressView()
                }
            }
        case .signedOut:
            LoginView()
        case .signedIn:
            if let user = app.user { MainTabs(user: user) }
        }
    }
}

struct BrandMark: View {
    var size: CGFloat = 40
    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.28)
            .fill(LinearGradient(colors: [Brand.b500, Brand.b700], startPoint: .topLeading, endPoint: .bottomTrailing))
            .frame(width: size, height: size)
            .overlay {
                Image(systemName: "house")
                    .font(.system(size: size * 0.45, weight: .semibold))
                    .foregroundStyle(.white)
            }
    }
}
