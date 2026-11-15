import Foundation
import WebKit

/// Erreur renvoyée par le serveur ManaResto : `{ "error": { "code", "message" } }`.
struct APIError: LocalizedError, Decodable, Equatable {
    let code: String
    let message: String
    var status: Int = 0

    var errorDescription: String? { message }

    private enum CodingKeys: String, CodingKey { case code, message }

    init(code: String, message: String, status: Int = 0) {
        self.code = code
        self.message = message
        self.status = status
    }

    static let offline = APIError(code: "OFFLINE", message: "Pas de connexion au serveur. Vérifiez le Wi-Fi puis réessayez.")
}

private struct ErrorEnvelope: Decodable { let error: APIError }
private struct DataEnvelope<T: Decodable>: Decodable { let data: T }

/// Requête sans corps.
struct NoBody: Encodable {}

/// Réponse dont le contenu ne nous intéresse pas (accepte n'importe quel JSON).
struct Ignored: Decodable { init(from decoder: Decoder) throws {} }

/// Accès à l'API ManaResto. La session (cookies `mr_session`, `mr_terminal`) est gardée par
/// `HTTPCookieStorage.shared`, comme dans un navigateur : l'app parle exactement à la même API que le site.
final class APIClient: @unchecked Sendable {
    static let shared = APIClient()
    static let defaultServer = URL(string: "https://app.manaresto.com")!
    private static let serverKey = "serverURL"

    let session: URLSession
    let decoder: JSONDecoder = APIClient.makeDecoder()
    private let encoder = JSONEncoder()

    init(session: URLSession? = nil) {
        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.default
            config.httpCookieStorage = .shared
            config.httpCookieAcceptPolicy = .always
            config.httpShouldSetCookies = true
            config.timeoutIntervalForRequest = 20
            config.waitsForConnectivity = false
            self.session = URLSession(configuration: config)
        }
    }

    /// Serveur utilisé (modifiable dans « Avancé » à la connexion, pour une installation sur votre propre serveur).
    var baseURL: URL {
        get {
            if let s = UserDefaults.standard.string(forKey: Self.serverKey), let url = URL(string: s) { return url }
            return Self.defaultServer
        }
        set { UserDefaults.standard.set(newValue.absoluteString, forKey: Self.serverKey) }
    }

    /// Adresse complète d'un chemin du serveur (« /demo/photos/x.webp » → https://…/demo/photos/x.webp).
    func url(_ path: String) -> URL? {
        if path.hasPrefix("http://") || path.hasPrefix("https://") { return URL(string: path) }
        return URL(string: path, relativeTo: baseURL)?.absoluteURL
    }

    // MARK: Requêtes

    func get<T: Decodable>(_ path: String, query: [String: String] = [:]) async throws -> T {
        try await request("GET", path, query: query, body: nil as NoBody?)
    }

    func post<T: Decodable>(_ path: String, _ body: some Encodable) async throws -> T {
        try await request("POST", path, body: body)
    }

    func patch<T: Decodable>(_ path: String, _ body: some Encodable) async throws -> T {
        try await request("PATCH", path, body: body)
    }

    func delete(_ path: String, _ body: some Encodable) async throws {
        let _: Ignored = try await request("DELETE", path, body: body)
    }

    private func request<T: Decodable, B: Encodable>(_ method: String, _ path: String, query: [String: String] = [:], body: B?) async throws -> T {
        guard var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false) else {
            throw APIError(code: "BAD_URL", message: "Adresse du serveur invalide")
        }
        if !query.isEmpty { components.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) } }
        guard let url = components.url else { throw APIError(code: "BAD_URL", message: "Adresse du serveur invalide") }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("ManaResto-iOS/\(Bundle.main.appVersion)", forHTTPHeaderField: "X-Client")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try encoder.encode(body)
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        } catch {
            throw APIError.offline
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        return try decode(data, status: status)
    }

    /// Décode `{ data }` ou lève l'erreur `{ error }` du serveur.
    func decode<T: Decodable>(_ data: Data, status: Int) throws -> T {
        if (200..<300).contains(status) {
            do {
                return try decoder.decode(DataEnvelope<T>.self, from: data).data
            } catch {
                #if DEBUG
                print("[API] décodage impossible de \(T.self) : \(error)")
                #endif
                throw APIError(code: "DECODING", message: "Réponse inattendue du serveur. Mettez l'app à jour.", status: status)
            }
        }
        if var err = try? decoder.decode(ErrorEnvelope.self, from: data).error {
            err.status = status
            throw err
        }
        throw APIError(code: "HTTP_\(status)", message: status == 0 ? APIError.offline.message : "Erreur du serveur (\(status))", status: status)
    }

    // MARK: Cookies

    /// Copie les cookies de session dans le navigateur intégré (écrans de gestion), pour ne pas se reconnecter.
    @MainActor
    func shareCookies(with store: WKHTTPCookieStore) async {
        for cookie in HTTPCookieStorage.shared.cookies(for: baseURL) ?? [] {
            await store.setCookie(cookie)
        }
    }

    /// Supprime la session utilisateur ; garde (ou non) l'enregistrement de l'appareil comme caisse.
    func clearCookies(keepTerminal: Bool) {
        for cookie in HTTPCookieStorage.shared.cookies(for: baseURL) ?? [] where !(keepTerminal && cookie.name == "mr_terminal") {
            HTTPCookieStorage.shared.deleteCookie(cookie)
        }
    }

    // MARK: JSON

    static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { d in
            let c = try d.singleValueContainer()
            let s = try c.decode(String.self)
            if let date = ISO8601.withFraction.date(from: s) ?? ISO8601.plain.date(from: s) { return date }
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "Date invalide : \(s)")
        }
        return decoder
    }
}

enum ISO8601 {
    static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    static let plain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
}

extension Bundle {
    var appVersion: String { (infoDictionary?["CFBundleShortVersionString"] as? String) ?? "1.0" }
}
