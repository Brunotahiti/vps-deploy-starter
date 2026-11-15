import Foundation
import Observation
import UIKit
import UserNotifications

/// Notifications « plat prêt » : autorisation, jeton APNs envoyé au serveur au nom de la personne connectée,
/// commande à ouvrir quand on touche la notification.
@MainActor
@Observable
final class PushManager {
    static let shared = PushManager()

    enum Status: Equatable { case unknown, notDetermined, denied, authorized }

    private(set) var status: Status = .unknown
    /// Le serveur sait-il envoyer aux iPhone (clé APNs configurée) ? nil tant qu'on ne sait pas.
    private(set) var serverEnabled: Bool?
    private(set) var token: String?
    private(set) var registeredFor: String?
    var lastError: String?
    /// Commande à ouvrir (notification touchée).
    var openOrderId: String?

    private var currentUserId: String?
    private let api: APIClient

    init(api: APIClient = .shared) {
        self.api = api
    }

    /// Environnement APNs du jeton : Xcode (Debug) = sandbox, TestFlight et App Store (Release) = production.
    nonisolated static var environment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }

    /// Jeton binaire → texte hexadécimal attendu par le serveur.
    nonisolated static func hex(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }

    /// Commande indiquée dans la notification (champ `orderId` envoyé par le serveur).
    nonisolated static func orderId(from userInfo: [AnyHashable: Any]) -> String? {
        guard let id = userInfo["orderId"] as? String, !id.isEmpty else { return nil }
        return id
    }

    var isRegistered: Bool { registeredFor != nil && registeredFor == currentUserId }

    func refreshStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: status = .authorized
        case .denied: status = .denied
        case .notDetermined: status = .notDetermined
        @unknown default: status = .unknown
        }
    }

    private struct ServerInfo: Decodable { let enabled: Bool }

    func checkServer() async {
        if let info: ServerInfo = try? await api.get("/api/push/apns") { serverEnabled = info.enabled }
    }

    /// Bouton « Activer » : demande l'autorisation, puis enregistre l'appareil auprès d'Apple.
    func enable() async {
        lastError = nil
        do {
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
            await refreshStatus()
            if granted { UIApplication.shared.registerForRemoteNotifications() }
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// À chaque connexion (et au lancement) : le jeton peut changer, et l'appareil passe à la personne connectée.
    func sync(userId: String?) async {
        currentUserId = userId
        await refreshStatus()
        await checkServer()
        guard userId != nil, status == .authorized, serverEnabled == true else { return }
        if let token, registeredFor != userId { await upload(token) }
        UIApplication.shared.registerForRemoteNotifications()
    }

    func didRegister(deviceToken: Data) {
        let value = Self.hex(deviceToken)
        let changed = value != token
        token = value
        if changed || !isRegistered { Task { await upload(value) } }
    }

    func didFail(_ error: Error) {
        lastError = "Notifications indisponibles sur cet appareil : \(error.localizedDescription)"
    }

    private struct Register: Encodable { let token: String; let environment: String; let deviceName: String }
    private struct Unregister: Encodable { let token: String }

    private func upload(_ token: String) async {
        guard currentUserId != nil, serverEnabled == true else { return }
        do {
            let _: Ignored = try await api.post("/api/push/apns", Register(token: token, environment: Self.environment, deviceName: UIDevice.current.name))
            registeredFor = currentUserId
            lastError = nil
        } catch {
            registeredFor = nil
            lastError = (error as? APIError)?.message ?? error.localizedDescription
        }
    }

    /// Avant de changer d'utilisateur ou de se déconnecter : l'appareil ne reçoit plus les plats de cette personne.
    func unregisterFromServer() async {
        if let token, registeredFor != nil { try? await api.delete("/api/push/apns", Unregister(token: token)) }
        registeredFor = nil
        currentUserId = nil
    }
}
