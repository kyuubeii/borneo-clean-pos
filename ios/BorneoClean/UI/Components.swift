import SwiftUI

/// tailwind.config.ts `brand` and `ink`.
enum Brand {
    static let b50 = Color(hex: 0xEEF6FF), b100 = Color(hex: 0xD9EBFF), b500 = Color(hex: 0x3385FB)
    static let b600 = Color(hex: 0x1F66F0), b700 = Color(hex: 0x1A51DC)
    static let ink50 = Color(hex: 0xF6F7F9), ink100 = Color(hex: 0xECEEF2), ink200 = Color(hex: 0xD5D9E2)
    static let ink300 = Color(hex: 0xB0B8C9), ink400 = Color(hex: 0x8490A9), ink500 = Color(hex: 0x65728E)
    static let ink700 = Color(hex: 0x424A5E), ink900 = Color(hex: 0x232834)
    static let good = Color(red: 0.02, green: 0.59, blue: 0.41)   // emerald-600
    static let warn = Color(red: 0.85, green: 0.47, blue: 0.02)   // amber-600
    static let bad = Color(red: 0.86, green: 0.15, blue: 0.15)    // red-600
}

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }
    /// "#3385fb" -> Color; staff calendar colours.
    init(css: String) {
        let s = css.trimmingCharacters(in: CharacterSet(charactersIn: "# "))
        self.init(hex: UInt32(s, radix: 16) ?? 0x3385FB)
    }
    var cssHex: String {
        let ui = UIColor(self)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        ui.getRed(&r, green: &g, blue: &b, alpha: &a)
        return String(format: "#%02x%02x%02x", Int(round(r * 255)), Int(round(g * 255)), Int(round(b * 255)))
    }
}

// MARK: - Status badge (ui.tsx TONES)

struct StatusBadge: View {
    let status: String
    var label: String? = nil

    var body: some View {
        let (bg, fg) = Self.tone(status)
        Text(label ?? status)
            .font(.caption2.weight(.semibold))
            .lineLimit(1)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(bg, in: .capsule)
            .foregroundStyle(fg)
    }

    static func tone(_ s: String) -> (Color, Color) {
        let amber = (Color(hex: 0xFEF3C7), Color(hex: 0xB45309))
        let blue = (Color(hex: 0xDBEAFE), Color(hex: 0x1D4ED8))
        let green = (Color(hex: 0xD1FAE5), Color(hex: 0x047857))
        let red = (Color(hex: 0xFEE2E2), Color(hex: 0xDC2626))
        let grey = (Brand.ink100, Brand.ink500)
        switch s {
        case "EN_ROUTE", "PENDING", "PARTIAL": return amber
        case "IN_PROGRESS", "CONFIRMED", "SENT": return blue
        case "COMPLETED", "PAID", "ACCEPTED": return green
        case "CANCELLED", "OVERDUE", "DECLINED": return red
        case "VOID", "EXPIRED": return (Brand.ink100, Brand.ink400)
        default: return grey
        }
    }
}

struct Tag: View {
    let text: String
    var bg: Color = Brand.ink100
    var fg: Color = Brand.ink500
    var body: some View {
        Text(text).font(.caption2.weight(.semibold)).lineLimit(1)
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(bg, in: .capsule).foregroundStyle(fg)
    }
}

// MARK: - Money

struct MoneyText: View {
    let cents: Int
    var sign = false
    var body: some View { Text(Fmt.moneyUI(cents, sign: sign)).monospacedDigit() }
}

// MARK: - Stat tile (ui.tsx Stat)

enum Tone { case normal, good, warn, bad
    var color: Color { switch self { case .normal: return .primary; case .good: return Brand.good; case .warn: return Brand.warn; case .bad: return Brand.bad } }
}

struct StatTile: View {
    let label: String
    let value: String
    var sub: String? = nil
    var tone: Tone = .normal
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).font(.caption.weight(.medium)).foregroundStyle(.secondary).lineLimit(1)
            Text(value).font(.title3.weight(.semibold)).monospacedDigit().foregroundStyle(tone.color)
                .lineLimit(1).minimumScaleFactor(0.6)
            if let sub, !sub.isEmpty {
                Text(sub).font(.caption2).foregroundStyle(.secondary).lineLimit(3).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 14))
    }
}

struct StatGrid<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) { content }
    }
}

// MARK: - Cards and rows

struct Card<Content: View>: View {
    var title: String? = nil
    var trailing: AnyView? = nil
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if title != nil || trailing != nil {
                HStack {
                    if let title { Text(title).font(.subheadline.weight(.semibold)) }
                    Spacer()
                    if let trailing { trailing }
                }
                .padding(.horizontal, 14).padding(.top, 12).padding(.bottom, 8)
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 14))
    }
}

struct KV: View {
    let k: String
    let v: String
    var tone: Color? = nil
    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(k).foregroundStyle(Color.secondary)
            Spacer(minLength: 12)
            Text(v).multilineTextAlignment(.trailing).foregroundStyle(tone ?? Color.primary)
        }
        .font(.subheadline)
    }
}

struct Avatar: View {
    let name: String
    let colour: String
    var size: CGFloat = 30
    var body: some View {
        Text(Fmt.initials(name))
            .font(.system(size: size * 0.36, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(Color(css: colour), in: .circle)
    }
}

struct Callout: View {
    let text: String
    var tone: Tone = .warn
    var icon: String? = nil
    var body: some View {
        let (bg, fg): (Color, Color) = {
            switch tone {
            case .warn: return (Color(hex: 0xFFFBEB), Color(hex: 0x92400E))
            case .bad: return (Color(hex: 0xFFF1F2), Color(hex: 0xBE123C))
            case .good: return (Color(hex: 0xECFDF5), Color(hex: 0x047857))
            case .normal: return (Color(.tertiarySystemGroupedBackground), .secondary)
            }
        }()
        HStack(alignment: .top, spacing: 8) {
            if let icon { Image(systemName: icon) }
            Text(text).fixedSize(horizontal: false, vertical: true)
        }
        .font(.caption)
        .foregroundStyle(fg)
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(bg, in: .rect(cornerRadius: 10))
    }
}

// MARK: - Empty / loading / error

struct EmptyState: View {
    let text: String
    var icon = "tray"
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon).font(.title2).foregroundStyle(Brand.ink300)
            Text(text).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 32)
    }
}

/// ui.tsx LoadError.
struct LoadErrorView: View {
    let error: String?
    let retry: () -> Void
    var body: some View {
        if let error {
            VStack(alignment: .leading, spacing: 8) {
                Text("Unable to load this information. \(humanError(error))").font(.subheadline)
                Button("Try again", action: retry).buttonStyle(.bordered).controlSize(.small)
            }
            .foregroundStyle(Color(hex: 0x9F1239))
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(hex: 0xFFF1F2), in: .rect(cornerRadius: 12))
        }
    }
}

struct LoadingRow: View {
    var body: some View {
        HStack { Spacer(); ProgressView(); Spacer() }.padding(.vertical, 24)
    }
}

// MARK: - Destructive confirm (ui.tsx ConfirmDelete)

/**
 The one way this app deletes things. As on the web, the server's
 `requiresConfirm` only guards the assistant, so for a button the confirmation
 is the app's job -- including typing the name back for deletions that take
 real records with them.
 */
struct ConfirmDeleteSheet: View {
    let title: String
    let action: String
    let input: JSON
    var confirmText: String? = nil
    var confirmLabel: String? = nil
    var verb = "Delete"
    let message: String
    var alternative: String? = nil
    var onDone: () -> Void = {}
    @Environment(\.dismiss) private var dismiss
    @State private var typed = ""
    @State private var busy = false

    private var armed: Bool {
        guard let c = confirmText else { return true }
        return typed.trimmingCharacters(in: .whitespaces).lowercased() == c.trimmingCharacters(in: .whitespaces).lowercased()
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(message).font(.subheadline).foregroundStyle(Color(hex: 0xBE123C))
                        .listRowBackground(Color(hex: 0xFFF1F2))
                }
                if let alternative {
                    Section { Text(alternative).font(.footnote).foregroundStyle(.secondary) }
                }
                if let confirmText {
                    Section {
                        TextField(confirmText, text: $typed).autocorrectionDisabled().textInputAutocapitalization(.never)
                    } header: { Text("Type \(confirmLabel ?? "the name") to confirm") } footer: { Text(confirmText) }
                }
                Section {
                    Button(role: .destructive) { Task { await go() } } label: {
                        HStack { Spacer(); Text(busy ? "\(verb.hasSuffix("e") ? String(verb.dropLast()) : verb)ing…" : verb).bold(); Spacer() }
                    }
                    .disabled(!armed || busy)
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }

    private func go() async {
        busy = true
        do {
            let r = try await API.shared.call(action, input)
            toast(r["deleted"].string.map { "\($0) deleted" } ?? "\(verb)d")
            onDone()
            dismiss()
        } catch {
            toast(humanError(error.localizedDescription), error: true)
            busy = false
        }
    }
}

// MARK: - Form helpers

/// A money field that keeps the web's raw text, converted with `toCents` on save.
struct MoneyField: View {
    let label: String
    @Binding var text: String
    var placeholder = "0.00"
    var body: some View {
        HStack {
            Text(label)
            Spacer()
            Text("RM").foregroundStyle(.secondary)
            TextField(placeholder, text: $text)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .frame(maxWidth: 140)
        }
    }
}

struct LabeledField: View {
    let label: String
    @Binding var text: String
    var placeholder = ""
    var keyboard: UIKeyboardType = .default
    var body: some View {
        HStack {
            Text(label)
            Spacer()
            TextField(placeholder, text: $text)
                .keyboardType(keyboard)
                .multilineTextAlignment(.trailing)
        }
    }
}

/// Segmented filter chips that scroll sideways on a narrow screen.
/// MonthPicker in ui.tsx: ‹ September 2026 ›, a month at a time, with
/// "This month" to come back once you have stepped away.
struct MonthPicker: View {
    @Binding var month: Date
    var body: some View {
        let first = Fmt.startOfMonth(month)
        let isCurrent = Fmt.sameDay(first, Fmt.startOfMonth(Date()))
        HStack(spacing: 10) {
            HStack(spacing: 0) {
                Button { month = Fmt.addMonths(first, -1) } label: { Image(systemName: "chevron.left").padding(.horizontal, 12).padding(.vertical, 8) }
                    .accessibilityLabel("Previous month")
                Text(Fmt.monthYear(first)).font(.footnote.weight(.semibold)).monospacedDigit().frame(minWidth: 120)
                Button { month = Fmt.addMonths(first, 1) } label: { Image(systemName: "chevron.right").padding(.horizontal, 12).padding(.vertical, 8) }
                    .accessibilityLabel("Next month")
            }
            .buttonStyle(.plain)
            .background(Color(.secondarySystemGroupedBackground), in: .capsule)
            if !isCurrent {
                Button(t("dash.thisMonth")) { month = Fmt.startOfMonth(Date()) }.font(.footnote.weight(.medium))
            }
        }
    }
}

struct ChipPicker<T: Hashable>: View {
    let options: [(T, String)]
    @Binding var selection: T
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(options, id: \.0) { value, label in
                    let on = value == selection
                    Button { selection = value } label: {
                        Text(label).font(.footnote.weight(.medium))
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(on ? Brand.b600 : Color(.secondarySystemGroupedBackground), in: .capsule)
                            .foregroundStyle(on ? .white : .primary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
        }
    }
}

extension View {
    /// Re-runs `load` on first appear, on pull-to-refresh and after writes elsewhere.
    func loads(_ load: @escaping () async -> Void) -> some View {
        modifier(LoadsModifier(load: load))
    }
}

private struct LoadsModifier: ViewModifier {
    let load: () async -> Void
    @State private var app = AppState.shared
    func body(content: Content) -> some View {
        content
            .task { await load() }
            .refreshable { await load() }
            .onChange(of: app.refreshTick) { Task { await load() } }
    }
}

/// The toolbar every top-level screen carries: the bell and the assistant.
struct ShellToolbar: ToolbarContent {
    @State private var app = AppState.shared
    @State private var router = Router.shared
    var body: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            Button { router.showBell = true } label: {
                Image(systemName: app.unread > 0 ? "bell.badge" : "bell")
                    .symbolRenderingMode(app.unread > 0 ? .multicolor : .monochrome)
            }
            .accessibilityLabel(app.unread > 0 ? "Notifications, \(app.unread) unread" : "Notifications")
            Button { router.showAssistant = true } label: { Image(systemName: "sparkles") }
                .accessibilityLabel(t("nav.assistant"))
        }
    }
}

/// A tappable row: the whole row answers, not just its text. `.plain` only
/// hit-tests the parts that draw something, so the gap between a label and
/// its price did nothing when tapped.
struct RowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .contentShape(Rectangle())
            .opacity(configuration.isPressed ? 0.55 : 1)
    }
}
extension ButtonStyle where Self == RowButtonStyle { static var row: RowButtonStyle { RowButtonStyle() } }
