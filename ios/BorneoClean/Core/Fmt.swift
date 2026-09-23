import Foundation

/**
 Money, number and date handling, ported line for line from src/lib/money.ts,
 src/lib/dates.ts and the inline conversions in the web forms.

 The point is parity, not tidiness: where JavaScript has a quirk (parseFloat
 reading a prefix, setMonth overflowing into the next month, a date-only string
 parsing as UTC midnight), the quirk is reproduced so the app sends exactly the
 values the web does and shows exactly the figures it shows.
 */
enum Fmt {
    // MARK: JavaScript number semantics

    /// `Math.round`: halves go up, towards +infinity.
    static func jsRound(_ x: Double) -> Double { (x + 0.5).rounded(.down) }

    /// `parseFloat`: the longest numeric prefix after leading whitespace, else NaN.
    static func jsParseFloat(_ raw: String) -> Double {
        let s = raw.drop(while: { $0.isWhitespace })
        let pattern = #"^[+-]?(Infinity|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)"#
        guard let r = String(s).range(of: pattern, options: .regularExpression) else { return .nan }
        let token = String(s[r])
        if token.hasSuffix("Infinity") { return token.hasPrefix("-") ? -.infinity : .infinity }
        return Double(token) ?? .nan
    }

    /// `Number(s)`: the whole trimmed string must be numeric; "" is 0.
    static func jsNumber(_ raw: String) -> Double {
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { return 0 }
        return Double(s) ?? .nan
    }

    /// money.ts `toCents` for a string: strip to [0-9.-], parseFloat, round.
    static func toCents(_ v: String) -> Int {
        let stripped = v.filter { "0123456789.-".contains($0) }
        let n = jsParseFloat(stripped)
        if !n.isFinite { return 0 }
        return Int(jsRound(n * 100))
    }

    /// `Math.round(parseFloat(s || "0") * 100)` -- percent and tax inputs.
    static func percentToBasisPoints(_ s: String) -> Int {
        let n = jsParseFloat(s.isEmpty ? "0" : s)
        if !n.isFinite { return 0 }
        return Int(jsRound(n * 100))
    }

    // MARK: Money

    private static let grouping: NumberFormatter = {
        let f = NumberFormatter()
        f.locale = Locale(identifier: "en_MY")
        f.numberStyle = .decimal
        f.minimumFractionDigits = 2
        f.maximumFractionDigits = 2
        f.usesGroupingSeparator = true
        return f
    }()

    static func plain(_ cents: Int) -> String {
        grouping.string(from: NSNumber(value: Double(abs(cents)) / 100)) ?? "0.00"
    }

    /// money.ts `fmt`: "RM 1,234.56", "-RM 12.00".
    static func money(_ cents: Int, symbol: Bool = true) -> String {
        "\(cents < 0 ? "-" : "")\(symbol ? "RM " : "")\(plain(cents))"
    }

    /// The `<Money>` component: a true minus sign, optional plus.
    static func moneyUI(_ cents: Int, sign: Bool = false) -> String {
        "\(cents < 0 ? "\u{2212}" : sign ? "+" : "")RM \(plain(cents))"
    }

    /// `(cents / 100).toFixed(2)` -- what the forms pre-fill.
    static func fixed2(_ cents: Int) -> String { String(format: "%.2f", Double(cents) / 100) }

    /// money.ts `totals`.
    static func totals(_ items: [(qty: Int, priceCents: Int)], discountCents: Int = 0, taxRateBp: Int = 0)
        -> (subtotal: Int, discount: Int, tax: Int, total: Int) {
        let subtotal = items.reduce(0) { $0 + $1.qty * $1.priceCents }
        let afterDiscount = max(0, subtotal - discountCents)
        let tax = Int(jsRound(Double(afterDiscount * taxRateBp) / 10000))
        return (subtotal, discountCents, tax, afterDiscount + tax)
    }

    // MARK: Dates

    static var cal: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = .current
        c.firstWeekday = 1 // Sunday, as getDay() counts.
        return c
    }

    private static let isoFrac: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoPlain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    static func parseISO(_ s: String) -> Date? {
        if let d = isoFrac.date(from: s) ?? isoPlain.date(from: s) { return d }
        // A bare YYYY-MM-DD parses as UTC midnight in JavaScript.
        if s.count == 10, let d = isoPlain.date(from: s + "T00:00:00Z") { return d }
        return nil
    }

    /// `date.toISOString()`.
    static func iso(_ d: Date) -> String { isoFrac.string(from: d) }

    /// dates.ts `isoDate`: the local calendar day.
    static func isoDate(_ d: Date) -> String {
        let c = cal.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    /// `new Date("YYYY-MM-DD").toISOString()` -- JavaScript reads a date-only
    /// string as UTC midnight, and the web sends exactly that.
    static func utcMidnightISO(_ ymd: String) -> String { "\(ymd)T00:00:00.000Z" }

    /// A local calendar day back from its YYYY-MM-DD string.
    static func localDate(_ ymd: String) -> Date? {
        let p = ymd.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return nil }
        return cal.date(from: DateComponents(year: p[0], month: p[1], day: p[2]))
    }

    static func startOfDay(_ d: Date) -> Date { cal.startOfDay(for: d) }
    static func endOfDay(_ d: Date) -> Date { cal.date(byAdding: DateComponents(day: 1, second: -1), to: startOfDay(d))!.addingTimeInterval(0.999) }
    static func addDays(_ d: Date, _ n: Int) -> Date { cal.date(byAdding: .day, value: n, to: d)! }

    /// `setMonth(getMonth() + n)`: the day overflows into the next month
    /// (31 March minus a month is 3 March), exactly as the browser does it.
    static func addMonths(_ d: Date, _ n: Int) -> Date {
        var c = cal.dateComponents([.year, .month, .day, .hour, .minute, .second, .nanosecond], from: d)
        c.month = (c.month ?? 1) + n
        return cal.date(from: c) ?? d
    }
    static func startOfWeek(_ d: Date) -> Date {
        let s = startOfDay(d)
        let wd = cal.component(.weekday, from: s) - 1
        return addDays(s, -wd)
    }
    static func startOfMonth(_ d: Date) -> Date {
        let c = cal.dateComponents([.year, .month], from: d)
        return cal.date(from: DateComponents(year: c.year, month: c.month, day: 1))!
    }
    static func endOfMonth(_ d: Date) -> Date { endOfDay(addDays(addMonths(startOfMonth(d), 1), -1)) }
    static func sameDay(_ a: Date, _ b: Date) -> Bool { cal.isDate(a, inSameDayAs: b) }

    private static func formatter(_ format: String, locale: String = "en_GB") -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: locale)
        f.timeZone = .current
        f.dateFormat = format
        return f
    }
    private static let timeF: DateFormatter = {
        let f = formatter("h:mm a", locale: "en_US_POSIX")
        f.amSymbol = "am"; f.pmSymbol = "pm"
        return f
    }()
    private static let dateF = formatter("d MMM yyyy")
    private static let longDateF = formatter("d MMMM yyyy")
    private static let monthYearF = formatter("MMMM yyyy")
    private static let shortStampF = formatter("d MMM, HH:mm")
    private static let stampF = formatter("d/M/yyyy, h:mm:ss a", locale: "en_US_POSIX")

    static func time(_ d: Date) -> String { timeF.string(from: d) }
    static func date(_ d: Date) -> String { dateF.string(from: d) }
    static func dateTime(_ d: Date) -> String { "\(date(d)) · \(time(d))" }
    static func monthYear(_ d: Date) -> String { monthYearF.string(from: d) }
    /// The activity log's `{ day, month: "short", hour, minute }`.
    static func shortStamp(_ d: Date) -> String { shortStampF.string(from: d) }
    /// `toLocaleString("en-MY")`.
    static func stamp(_ d: Date) -> String { stampF.string(from: d).lowercased() }
    /// InvoiceDocument `documentDate`: "21 September 2026".
    static func documentDate(_ d: Date?) -> String { d.map { longDateF.string(from: $0) } ?? "—" }

    /// dates.ts `minsToLabel`: 90 -> "1h 30m".
    static func minsToLabel(_ m: Int) -> String {
        m >= 60 ? "\(m / 60)h\(m % 60 != 0 ? " \(m % 60)m" : "")" : "\(m)m"
    }

    /// The web's `toInput(new Date(...))` then `new Date(value).toISOString()`
    /// drops seconds; a picked date is truncated to the minute the same way.
    static func toMinute(_ d: Date) -> Date {
        let c = cal.dateComponents([.year, .month, .day, .hour, .minute], from: d)
        return cal.date(from: c) ?? d
    }

    /// BookingForm's `nextHour()`.
    static func nextHour() -> Date {
        let now = Date()
        let c = cal.dateComponents([.year, .month, .day, .hour], from: now)
        return cal.date(from: c)!.addingTimeInterval(3600)
    }

    /// Initials for an avatar: "Siti Aisyah" -> "SA".
    static func initials(_ name: String) -> String {
        name.split(separator: " ").compactMap { $0.first }.prefix(2).map(String.init).joined()
    }
}
