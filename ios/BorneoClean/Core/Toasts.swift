import SwiftUI
import Observation

/// ui.tsx `toast()`: a short message at the bottom, four seconds, red for errors.
@MainActor @Observable
final class Toasts {
    static let shared = Toasts()
    struct Item: Identifiable, Equatable { let id = UUID(); let text: String; let error: Bool }
    var items: [Item] = []

    func show(_ text: String, error: Bool = false) {
        let item = Item(text: text, error: error)
        withAnimation(.snappy) { items.append(item) }
        let gen = UINotificationFeedbackGenerator()
        gen.notificationOccurred(error ? .error : .success)
        Task {
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            withAnimation(.snappy) { items.removeAll { $0.id == item.id } }
        }
    }
}

@MainActor func toast(_ text: String, error: Bool = false) { Toasts.shared.show(text, error: error) }

struct ToastOverlay: View {
    @State private var toasts = Toasts.shared
    var body: some View {
        VStack(spacing: 8) {
            ForEach(toasts.items) { i in
                Text(i.text)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 16).padding(.vertical, 11)
                    .background(i.error ? Color.red : Brand.ink900, in: .capsule)
                    .shadow(color: .black.opacity(0.18), radius: 12, y: 4)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .onTapGesture { toasts.items.removeAll { $0.id == i.id } }
            }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 64)
        .frame(maxHeight: .infinity, alignment: .bottom)
        .allowsHitTesting(!toasts.items.isEmpty)
    }
}
