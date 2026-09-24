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
                    BrandMark(size: 88)
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

/// The Borneo Clean emblem (house, map, broom) on a white tile, as on the app icon.
struct BrandMark: View {
    var size: CGFloat = 40
    var body: some View {
        Image("BrandEmblem")
            .resizable()
            .interpolation(.high)
            .scaledToFit()
            .frame(width: size, height: size)
            .background(Color.white)
            .clipShape(.rect(cornerRadius: size * 0.22, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: size * 0.22, style: .continuous).strokeBorder(Color.black.opacity(0.06)))
            .accessibilityHidden(true)
    }
}
