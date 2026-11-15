import SwiftUI

@main
struct ManaRestoApp: App {
    @State private var app = AppState()
    @State private var catalog = CatalogStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                .environment(catalog)
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
