import Foundation

/**
 A JSON value, used for both what the server returns and what the app sends.

 The web client works with untyped objects, and several actions depend on the
 difference between a key that is left out and one that is sent as `null`
 (`labourCents: null` means "go back to the pay rate", `vendor: null` clears a
 field). Synthesised Codable drops nil optionals, so request bodies are built
 from this type instead, where `.null` is a real value and omission is simply
 not adding the key.
 */
enum JSON: Hashable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSON])
    case object([String: JSON])

    // MARK: Parsing

    static func parse(_ data: Data) throws -> JSON {
        let any = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        return JSON(any: any)
    }

    init(any: Any?) {
        switch any {
        case nil, is NSNull: self = .null
        case let n as NSNumber:
            // NSNumber also carries booleans; tell them apart by their CF type.
            if CFGetTypeID(n) == CFBooleanGetTypeID() { self = .bool(n.boolValue) }
            else { self = .number(n.doubleValue) }
        case let s as String: self = .string(s)
        case let a as [Any]: self = .array(a.map { JSON(any: $0) })
        case let d as [String: Any]: self = .object(d.mapValues { JSON(any: $0) })
        default: self = .null
        }
    }

    // MARK: Encoding

    var foundation: Any {
        switch self {
        case .null: return NSNull()
        case .bool(let b): return b
        case .number(let n):
            // Integers go out as integers: zod's .int() would accept 1500.0, but
            // there is no reason to send anything the web would not.
            if n.rounded() == n, abs(n) < 9_007_199_254_740_992 { return NSNumber(value: Int64(n)) }
            return NSNumber(value: n)
        case .string(let s): return s
        case .array(let a): return a.map { $0.foundation }
        case .object(let o): return o.mapValues { $0.foundation }
        }
    }

    func data() -> Data {
        (try? JSONSerialization.data(withJSONObject: foundation, options: [.fragmentsAllowed])) ?? Data("{}".utf8)
    }

    var prettyString: String {
        guard let d = try? JSONSerialization.data(withJSONObject: foundation, options: [.fragmentsAllowed, .prettyPrinted, .sortedKeys]) else { return "" }
        return String(decoding: d, as: UTF8.self)
    }

    // MARK: Reading

    subscript(key: String) -> JSON {
        if case .object(let o) = self { return o[key] ?? .null }
        return .null
    }

    subscript(index: Int) -> JSON {
        if case .array(let a) = self, a.indices.contains(index) { return a[index] }
        return .null
    }

    var isNull: Bool { if case .null = self { return true } else { return false } }

    /// Present and not null -- JavaScript's truthiness for objects.
    var exists: Bool { !isNull }

    var string: String? {
        switch self {
        case .string(let s): return s
        case .number(let n): return n.rounded() == n ? String(Int64(n)) : String(n)
        default: return nil
        }
    }

    /// The string, or "" -- for text shown on screen.
    var str: String { string ?? "" }

    /// A string that is present and not empty (JavaScript truthiness).
    var nonEmpty: String? { if let s = string, !s.isEmpty { return s } else { return nil } }

    var double: Double? {
        switch self {
        case .number(let n): return n
        case .string(let s): return Double(s)
        default: return nil
        }
    }

    var int: Int? { double.map { Int($0.rounded()) } }

    /// The integer, or 0.
    var i: Int { int ?? 0 }

    var bool: Bool? { if case .bool(let b) = self { return b } else { return nil } }

    /// JavaScript truthiness, for flags that may be missing.
    var truthy: Bool {
        switch self {
        case .null: return false
        case .bool(let b): return b
        case .number(let n): return n != 0 && !n.isNaN
        case .string(let s): return !s.isEmpty
        case .array, .object: return true
        }
    }

    var array: [JSON] { if case .array(let a) = self { return a } else { return [] } }

    var object: [String: JSON] { if case .object(let o) = self { return o } else { return [:] } }

    /// ISO timestamps as Prisma serialises them.
    var date: Date? { string.flatMap(Fmt.parseISO) }

    /// Stable identity for lists.
    var id: String { self["id"].str }
}

extension JSON: ExpressibleByNilLiteral, ExpressibleByBooleanLiteral, ExpressibleByIntegerLiteral,
    ExpressibleByFloatLiteral, ExpressibleByStringLiteral, ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral {
    init(nilLiteral: ()) { self = .null }
    init(booleanLiteral value: Bool) { self = .bool(value) }
    init(integerLiteral value: Int) { self = .number(Double(value)) }
    init(floatLiteral value: Double) { self = .number(value) }
    init(stringLiteral value: String) { self = .string(value) }
    init(arrayLiteral elements: JSON...) { self = .array(elements) }
    init(dictionaryLiteral elements: (String, JSON)...) {
        var o: [String: JSON] = [:]
        for (k, v) in elements { o[k] = v }
        self = .object(o)
    }
}

extension JSON {
    init(_ s: String) { self = .string(s) }
    init(_ n: Int) { self = .number(Double(n)) }
    init(_ b: Bool) { self = .bool(b) }
    init(_ a: [String]) { self = .array(a.map { .string($0) }) }

    /// Adds a key only when there is a value -- the web's `x || undefined`.
    mutating func set(_ key: String, _ value: JSON?) {
        guard case .object(var o) = self else { return }
        if let value { o[key] = value } else { o.removeValue(forKey: key) }
        self = .object(o)
    }

    /// `value || undefined` for text: blank strings are left out.
    static func orOmit(_ s: String) -> JSON? { s.isEmpty ? nil : .string(s) }

    /// `value || null` for text: blank strings become an explicit null.
    static func orNull(_ s: String) -> JSON { s.isEmpty ? .null : .string(s) }
}

/// A row from a list, identifiable by its `id` so SwiftUI can diff it.
struct Row: Identifiable, Hashable {
    let json: JSON
    let key: String
    var id: String { key }
    init(_ json: JSON, key: String? = nil) { self.json = json; self.key = key ?? json.id }
    subscript(k: String) -> JSON { json[k] }
}

extension Array where Element == JSON {
    /// Rows keyed on `id`, falling back to position for records that have none.
    func rows(key: String = "id") -> [Row] {
        enumerated().map { n, j in Row(j, key: j[key].nonEmpty ?? "\(n)") }
    }
}
