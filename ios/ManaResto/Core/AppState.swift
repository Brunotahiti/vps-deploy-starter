import Foundation
import Observation

/// État global : qui est connecté, sur quel restaurant, et si l'appareil est enregistré comme caisse.
///
/// Trois situations, comme sur le site :
/// - personne de connecté et appareil inconnu → écran de connexion (e-mail + mot de passe) ;
/// - appareil enregistré comme caisse, personne de connecté → écran PIN avec les prénoms de l'équipe ;
/// - quelqu'un de connecté → la caisse.
@MainActor
@Observable
final class AppState {
    enum Phase: Equatable { case loading, unreachable, signedOut, pinLock, ready }

    private(set) var phase: Phase = .loading
    private(set) var me: Me?
    var banner: String?

    let api: APIClient

    init(api: APIClient = .shared) {
        self.api = api
    }

    var user: MeUser? { me?.user }
    var establishmentName: String { me?.establishment?.name ?? "ManaResto" }
    var isDeviceRegistered: Bool { me?.terminal != nil }

    func can(_ permission: String) -> Bool { me?.can(permission) ?? false }
    func hasOption(_ key: String) -> Bool { me?.hasOption(key) ?? false }

    // MARK: Démarrage

    func bootstrap() async {
        do {
            let me: Me = try await api.get("/api/auth/me")
            apply(me)
        } catch {
            phase = .unreachable
            banner = (error as? APIError)?.message ?? APIError.offline.message
        }
    }

    func refresh() async {
        if let me: Me = try? await api.get("/api/auth/me") { apply(me) }
    }

    private func apply(_ me: Me) {
        self.me = me
        if me.user != nil { phase = .ready }
        else if me.terminal != nil { phase = .pinLock }
        else { phase = .signedOut }
    }

    /// À appeler sur toute erreur d'API : une session expirée renvoie à l'écran PIN ou de connexion.
    func handle(_ error: Error) -> String? {
        if error is CancellationError { return nil }
        if let e = error as? APIError, e.status == 401 {
            Task { await refresh() }
            return "Session expirée : reconnectez-vous."
        }
        return (error as? APIError)?.message ?? error.localizedDescription
    }

    // MARK: Connexion

    private struct LoginBody: Encodable { let email: String; let password: String }
    private struct PinBody: Encodable { let pin: String; let userId: String? }
    private struct DeviceBody: Encodable { let name: String; let kind: String }

    func login(email: String, password: String) async throws {
        let _: LoggedUser = try await api.post("/api/auth/login", LoginBody(email: email.trimmingCharacters(in: .whitespaces), password: password))
        await refresh()
    }

    /// Restaurant de démonstration (aussi utile pour l'examen de l'app par Apple).
    func openDemo() async throws {
        let _: Ignored = try await api.post("/api/auth/demo-session", NoBody())
        await refresh()
    }

    /// Enregistre l'appareil comme caisse : ensuite, l'équipe se connecte par PIN, sans mot de passe.
    func registerDevice(name: String) async throws {
        let _: Ignored = try await api.post("/api/auth/terminal/register", DeviceBody(name: name, kind: "POS"))
        await refresh()
    }

    func team() async throws -> [TeamMember] {
        try await api.get("/api/auth/pin/team")
    }

    func pinLogin(userId: String?, pin: String) async throws {
        let _: LoggedUser = try await api.post("/api/auth/pin", PinBody(pin: pin, userId: userId))
        await refresh()
    }

    /// « Changer d'utilisateur » : ferme la session, l'appareil reste une caisse (retour à l'écran PIN).
    func lock() async {
        _ = try? await api.post("/api/auth/logout", NoBody()) as Ignored
        api.clearCookies(keepTerminal: true)
        await refresh()
        if phase == .ready { phase = isDeviceRegistered ? .pinLock : .signedOut }
    }

    /// Déconnexion complète : l'appareil n'est plus une caisse.
    func signOutCompletely() async {
        if isDeviceRegistered { _ = try? await api.post("/api/auth/terminal/unregister", NoBody()) as Ignored }
        _ = try? await api.post("/api/auth/logout", NoBody()) as Ignored
        api.clearCookies(keepTerminal: false)
        me = nil
        phase = .signedOut
    }

    func setServer(_ url: URL) {
        api.clearCookies(keepTerminal: false)
        api.baseURL = url
        me = nil
        phase = .loading
    }
}
