import UIKit
import UserNotifications

/// Réception du jeton APNs et des notifications (affichées même app ouverte ; un toucher ouvre la commande).
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in PushManager.shared.didRegister(deviceToken: deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        let message = error.localizedDescription
        Task { @MainActor in PushManager.shared.didFail(NSError(domain: "APNs", code: 0, userInfo: [NSLocalizedDescriptionKey: message])) }
    }

    /// App au premier plan : la notification s'affiche quand même (bandeau et son).
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .list]
    }

    /// Notification touchée : la commande s'ouvre.
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let orderId = PushManager.orderId(from: response.notification.request.content.userInfo) else { return }
        await MainActor.run { PushManager.shared.openOrderId = orderId }
    }
}
