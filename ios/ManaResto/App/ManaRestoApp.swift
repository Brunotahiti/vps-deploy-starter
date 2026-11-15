import SwiftUI

@main
struct ManaRestoApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var app = AppState()
    @State private var catalog = CatalogStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                .environment(catalog)
                .environment(PushManager.shared)
                .tint(.lagon)
        }
    }
}

/// Aiguillage : chargement, connexion, écran PIN ou caisse.
struct RootView: View {
    @Environment(AppState.self) private var app
    @Environment(CatalogStore.self) private var catalog

    var body: some View {
        Group {
            switch app.phase {
            case .loading:
                ProgressView("Connexion à ManaResto…")
            case .unreachable:
                UnreachableView()
            case .signedOut:
                LoginView()
            case .pinLock:
                PinLockView()
            case .ready:
                MainTabView()
            }
        }
        .animation(.default, value: app.phase)
        .task { await app.bootstrap() }
        .onChange(of: app.user?.id) { _, _ in catalog.reset() }
        // À chaque connexion : l'appareil reçoit les plats prêts de la personne connectée
        .task(id: app.user?.id) { await PushManager.shared.sync(userId: app.user?.id) }
    }
}

struct UnreachableView: View {
    @Environment(AppState.self) private var app

    var body: some View {
        ContentUnavailableView {
            Label("Serveur injoignable", systemImage: "wifi.exclamationmark")
        } description: {
            Text(app.banner ?? APIError.offline.message)
        } actions: {
            Button("Réessayer") { Task { await app.bootstrap() } }
                .buttonStyle(.borderedProminent)
        }
    }
}
