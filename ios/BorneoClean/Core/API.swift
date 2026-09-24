import Foundation
import os

struct APIError: LocalizedError {
    let message: String
    var code: String? = nil
    var errorDescription: String? { message }
}

/**
 The one door to the server.

 Everything the app reads or changes goes through the same endpoints the web
 uses -- `/api/actions/<name>` for single calls and `/api/actions/batch` for
 reads issued together -- so validation, permissions, calculations and the
 audit log are the server's, exactly as for the browser. Nothing here computes
 a business figure.

 Signing in is the web's own cookie session: `/api/auth` sets the Supabase
 cookies, URLSession keeps them in the shared cookie store across launches,
 and the route handlers rotate them as tokens expire.
 */
@MainActor
final class API {
    static let shared = API()

    static let defaultServer = "https://borneoclean.vercel.app"
    private static let serverKey = "bc.server"

    var baseURL: URL {
        URL(string: UserDefaults.standard.string(forKey: Self.serverKey) ?? Self.defaultServer) ?? URL(string: Self.defaultServer)!
    }
    var serverString: String { baseURL.absoluteString }
    func setServer(_ s: String) {
        let clean = s.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if clean.isEmpty || clean == Self.defaultServer { UserDefaults.standard.removeObject(forKey: Self.serverKey) }
        else { UserDefaults.standard.set(clean, forKey: Self.serverKey) }
    }

    /// Called when the server says the session is gone, after one retry.
    var onUnauthorized: (() -> Void)?

    private let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.httpCookieStorage = .shared
        c.httpShouldSetCookies = true
        c.httpCookieAcceptPolicy = .always
        // The assistant's route may run a model for up to 60 seconds.
        c.timeoutIntervalForRequest = 90
        c.timeoutIntervalForResource = 120
        c.waitsForConnectivity = false
        return URLSession(configuration: c)
    }()

    private let log = Logger(subsystem: "com.borneoclean.app", category: "api")

    // MARK: Transport

    private func request(_ path: String, method: String = "POST", body: Data? = nil, contentType: String = "application/json") -> URLRequest {
        var r = URLRequest(url: baseURL.appendingPathComponent(path))
        r.httpMethod = method
        if let body {
            r.httpBody = body
            r.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        return r
    }

    /// Sends a request and parses JSON, retrying once on a 401 before giving up
    /// the session -- two requests can race to rotate the same refresh token.
    private func send(_ req: URLRequest, retried: Bool = false) async throws -> (JSON, Int) {
        let data: Data, resp: URLResponse
        do { (data, resp) = try await session.data(for: req) }
        catch let e as URLError where e.code == .cancelled { throw CancellationError() }
        catch { throw APIError(message: "Could not reach the server. Check your connection and try again.") }
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        #if DEBUG
        if let h = resp as? HTTPURLResponse, let c = h.value(forHTTPHeaderField: "Set-Cookie") {
            log.debug("\(req.url?.path ?? "", privacy: .public) set-cookie \(c.prefix(60), privacy: .public)…")
        }
        #endif
        let json = (try? JSON.parse(data)) ?? .null
        if status == 401 {
            if !retried {
                try await Task.sleep(nanoseconds: 400_000_000)
                return try await send(req, retried: true)
            }
            onUnauthorized?()
            throw APIError(message: "Your session has ended. Please sign in again.", code: "UNAUTHENTICATED")
        }
        if json.isNull && status >= 400 {
            throw APIError(message: "The server returned an error (\(status)).")
        }
        return (json, status)
    }

    // MARK: Actions

    /// ui.tsx `callAction`: one action, its data or its error.
    @discardableResult
    func call(_ name: String, _ input: JSON = [:]) async throws -> JSON {
        let (j, _) = try await send(request("api/actions/\(name)", body: input.data()))
        guard j["ok"].bool == true else {
            throw APIError(message: humanError(j["error"].string ?? "Action failed"), code: j["code"].string)
        }
        if !Self.readOnly.contains(name) { didWrite() }
        return j["data"]
    }

    /// The actions marked `readOnly: true` in src/lib/actions. Anything else
    /// changed something, so the other tabs reload rather than show old figures.
    static let readOnly: Set<String> = [
        "audit.list", "bookings.get", "bookings.list", "customers.get", "customers.lapsed", "customers.search",
        "expenses.categories", "expenses.list", "invoices.get", "invoices.list", "jobs.costing", "jobs.get", "jobs.list",
        "lookup.byRef", "notifications.list", "payments.list", "payments.outstanding", "payroll.calculate", "payroll.list",
        "quotes.get", "quotes.list", "reports.dailyBriefing", "reports.expenseBreakdown", "reports.myDay",
        "reports.revenueByService", "reports.revenueTrend", "reports.staffPerformance", "reports.summary",
        "reports.topCustomers", "search.global", "services.list", "settings.get", "staff.advances", "staff.findAvailable",
        "staff.list", "staff.workHistory", "users.list",
    ]

    private var refreshTask: Task<Void, Never>?
    /// One refresh for a burst of writes (a costing save sends several).
    private func didWrite() {
        refreshTask?.cancel()
        refreshTask = Task {
            try? await Task.sleep(nanoseconds: 400_000_000)
            guard !Task.isCancelled else { return }
            AppState.shared.refreshAll()
        }
    }

    /**
     ui.tsx `queueAction` flushed as one request: several reads in one round trip.
     Each result stands on its own, as on the web -- one failing read does not
     take down the rest of the screen.
     */
    func batch(_ calls: [(String, JSON)]) async -> [Result<JSON, Error>] {
        if calls.count == 1 {
            do { return [.success(try await call(calls[0].0, calls[0].1))] } catch { return [.failure(error)] }
        }
        let body: JSON = ["calls": .array(calls.map { ["name": .string($0.0), "input": $0.1] })]
        do {
            let (j, _) = try await send(request("api/actions/batch", body: body.data()))
            guard j["ok"].bool == true else { throw APIError(message: j["error"].string ?? "Batch failed") }
            var out: [Result<JSON, Error>] = []
            for (n, c) in calls.enumerated() {
                let r = j["results"][n]
                if r["ok"].bool == true { out.append(.success(r["data"])) }
                else if r["code"].string == "NOT_BATCHABLE" {
                    do { out.append(.success(try await call(c.0, c.1))) } catch { out.append(.failure(error)) }
                } else {
                    out.append(.failure(APIError(message: humanError(r["error"].string ?? "Action failed"), code: r["code"].string)))
                }
            }
            return out
        } catch {
            if (error as? APIError)?.code == "UNAUTHENTICATED" { return calls.map { _ in .failure(error) } }
            // The batch route itself failed; try each read on its own.
            var out: [Result<JSON, Error>] = []
            for c in calls {
                do { out.append(.success(try await call(c.0, c.1))) } catch { out.append(.failure(error)) }
            }
            return out
        }
    }

    // MARK: Session

    func signIn(email: String, password: String) async throws {
        let body: JSON = ["email": .string(email), "password": .string(password)]
        var req = request("api/auth", body: body.data())
        req.timeoutInterval = 30
        let data: Data, resp: URLResponse
        do { (data, resp) = try await session.data(for: req) }
        catch { throw APIError(message: "Could not reach the server. Check your connection and try again.") }
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        let j = (try? JSON.parse(data)) ?? .null
        if status == 401 || j["ok"].bool != true {
            throw APIError(message: status == 503 ? (j["error"].string ?? "Sign-in is not configured on this server.") : t("auth.invalid"))
        }
    }

    func me() async throws -> CurrentUser {
        let (j, _) = try await send(request("api/me", method: "GET"))
        guard j["ok"].bool == true else { throw APIError(message: j["error"].string ?? "Could not load your account.") }
        let u = j["user"]
        return CurrentUser(id: u["id"].str, name: u["name"].str, email: u["email"].str,
                           role: Role(rawValue: u["role"].str) ?? .staff, staffId: u["staffId"].string)
    }

    func signOut() async {
        _ = try? await session.data(for: request("api/auth", method: "DELETE"))
        clearCookies()
    }

    func clearCookies() {
        let store = HTTPCookieStorage.shared
        for c in store.cookies(for: baseURL) ?? [] { store.deleteCookie(c) }
    }

    var hasSessionCookie: Bool {
        (HTTPCookieStorage.shared.cookies(for: baseURL) ?? []).contains { $0.name.hasPrefix("sb-") }
    }

    // MARK: Notifications (the bell)

    func notifications() async throws -> (items: [JSON], unread: Int) {
        let (j, _) = try await send(request("api/notifications", method: "GET"))
        return (j["items"].array, j["unread"].i)
    }

    /// `{ op: "read" | "dismiss", id? }` -- no id means all of them.
    func notificationsPost(op: String, id: String? = nil) async {
        var body: JSON = ["op": .string(op)]
        body.set("id", id.map { JSON.string($0) })
        _ = try? await send(request("api/notifications", body: body.data()))
    }

    // MARK: Uploads

    /// `/api/upload`: job photos, receipts, the logo. Returns the stored URL.
    func upload(_ data: Data, filename: String, mime: String) async throws -> String {
        let boundary = "BC-\(UUID().uuidString)"
        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(mime)\r\n\r\n".data(using: .utf8)!)
        body.append(data)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        let (j, _) = try await send(request("api/upload", body: body, contentType: "multipart/form-data; boundary=\(boundary)"))
        guard j["ok"].bool == true, let url = j["url"].string else { throw APIError(message: j["error"].string ?? "Upload failed") }
        return url
    }

    // MARK: Assistant

    func aiChat(_ body: JSON) async throws -> JSON {
        var req = request("api/ai/chat", body: body.data())
        req.timeoutInterval = 90
        return try await send(req).0
    }

    func aiThreads(query: String? = nil) async throws -> [JSON] {
        var comps = URLComponents(url: baseURL.appendingPathComponent("api/ai/threads"), resolvingAgainstBaseURL: false)!
        if let q = query, !q.isEmpty { comps.queryItems = [URLQueryItem(name: "q", value: q)] }
        var req = URLRequest(url: comps.url!)
        req.httpMethod = "GET"
        let (j, _) = try await send(req)
        guard j["ok"].bool == true else { throw APIError(message: j["error"].string ?? "Could not load conversations.") }
        return j["threads"].array
    }

    func aiThread(_ id: String) async throws -> JSON {
        let (j, _) = try await send(request("api/ai/threads/\(id)", method: "GET"))
        guard j["ok"].bool == true else { throw APIError(message: j["error"].string ?? "Could not open that conversation.") }
        return j
    }

    func aiRename(_ id: String, title: String) async -> Bool {
        let body: JSON = ["title": .string(title)]
        return ((try? await send(request("api/ai/threads/\(id)", method: "PATCH", body: body.data())))?.0["ok"].bool) == true
    }

    func aiDelete(_ id: String) async -> Bool {
        ((try? await send(request("api/ai/threads/\(id)", method: "DELETE")))?.0["ok"].bool) == true
    }

    // MARK: Push

    /// Registers this phone for push, with the person's choice of types.
    func registerDevice(token: String, environment: String, types: [String]?) async throws -> JSON {
        var body: JSON = ["token": .string(token), "environment": .string(environment), "platform": "ios"]
        if let types { body.set("types", JSON(types)) }
        let (j, _) = try await send(request("api/push/device", body: body.data()))
        guard j["ok"].bool == true else { throw APIError(message: j["error"].string ?? "Could not register for notifications.") }
        return j["device"]
    }

    /// /api/push/test: a push to this person's own phones, with Apple's answer for each.
    func pushTest() async throws -> JSON {
        let (j, _) = try await send(request("api/push/test"))
        guard j["ok"].bool == true else { throw APIError(message: j["error"].string ?? "Could not send a test notification.") }
        return j
    }

    func unregisterDevice(token: String) async {
        let body: JSON = ["token": .string(token)]
        _ = try? await send(request("api/push/device", method: "DELETE", body: body.data()))
    }
}

/**
 ui.tsx `humanError`: registry errors are written for the assistant and name
 actions and fields; these are the ones a person can hit from a button.
 */
func humanError(_ msg: String) -> String {
    if msg.isEmpty { return "Something went wrong." }
    var m = msg.replacingOccurrences(of: #"\buse \w+\.\w+\b"#, with: "use the relevant screen", options: [.regularExpression, .caseInsensitive])
    m = m.replacingOccurrences(of: #"Look the record up first and use the exact id returned; omit optional IDs you do not have\.?"#,
                               with: "Something it refers to no longer exists. Reload the page and try again.", options: [.regularExpression, .caseInsensitive])
    m = m.replacingOccurrences(of: #"That record does not exist\. Check the id, or search for it first\.?"#,
                               with: "That record no longer exists. It may already have been deleted.", options: [.regularExpression, .caseInsensitive])
    return m
}
