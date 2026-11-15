import SwiftUI

struct MoreView: View {
    @Environment(AppState.self) private var app
    @Environment(CatalogStore.self) private var catalog
    @Environment(PushManager.self) private var push
    @State private var confirmSignOut = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 14) {
                        InitialsBadge(text: String((app.user?.name ?? "?").prefix(2)).uppercased(), color: Color(hex: app.user?.color))
                        VStack(alignment: .leading) {
                            Text(app.user?.name ?? "").font(.headline)
                            Text(app.establishmentName).font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                    if let label = app.me?.subscription?.label {
                        Label(label, systemImage: "calendar.badge.clock").font(.subheadline)
                    }
                }

                if push.serverEnabled == true && app.can("pos.use") {
                    NotificationsSection()
                }

                Section("Équipe") {
                    if app.hasOption("team") {
                        NavigationLink { ClockView() } label: { Label("Pointeuse", systemImage: "clock.badge.checkmark") }
                    }
                    if app.isDeviceRegistered {
                        Button { Task { await app.lock() } } label: { Label("Changer d'utilisateur", systemImage: "person.2.circle") }
                    }
                }

                Section {
                    NavigationLink {
                        WebScreen(path: "/admin", title: "Gestion")
                    } label: {
                        Label("Gestion complète", systemImage: "slider.horizontal.3")
                    }
                    NavigationLink {
                        WebScreen(path: "/pos", title: "Caisse web")
                    } label: {
                        Label("Caisse complète (web)", systemImage: "rectangle.on.rectangle")
                    }
                } header: {
                    Text("Gestion")
                } footer: {
                    Text("Carte, stock, personnel, réservations, comptabilité et réglages : tout le site ManaResto, sans vous reconnecter.")
                }

                if !app.isDeviceRegistered && app.can("settings.manage") {
                    RegisterDeviceCard()
                }

                Section {
                    Button("Recharger la carte", systemImage: "arrow.clockwise") { Task { await catalog.load(force: true) } }
                    if let privacy = APIClient.shared.url("/confidentialite") {
                        Link(destination: privacy) { Label("Politique de confidentialité", systemImage: "hand.raised") }
                    }
                    Button("Se déconnecter", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) { confirmSignOut = true }
                } footer: {
                    Text("ManaResto \(Bundle.main.appVersion) · \(APIClient.shared.baseURL.host() ?? "")")
                }
            }
            .navigationTitle("Plus")
            .confirmationDialog("Se déconnecter de cet appareil ?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Se déconnecter", role: .destructive) { Task { await app.signOutCompletely() } }
            } message: {
                Text(app.isDeviceRegistered ? "L'appareil ne sera plus une caisse : il faudra se reconnecter avec un e-mail." : "Vous devrez saisir à nouveau votre e-mail et votre mot de passe.")
            }
        }
    }
}

/// « Plats prêts sur cet appareil » : état et activation des notifications.
struct NotificationsSection: View {
    @Environment(PushManager.self) private var push
    @Environment(\.openURL) private var openURL

    var body: some View {
        Section {
            switch push.status {
            case .authorized:
                Label(push.isRegistered ? "Activées sur cet appareil" : "Activation en cours…", systemImage: push.isRegistered ? "bell.badge.fill" : "bell")
                    .foregroundStyle(push.isRegistered ? Color.green : Color.secondary)
            case .denied:
                Label("Refusées dans les réglages de l'appareil", systemImage: "bell.slash")
                    .foregroundStyle(.orange)
                Button("Ouvrir les réglages", systemImage: "gear") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                }
            default:
                Button("Activer les notifications", systemImage: "bell.badge") { Task { await push.enable() } }
            }
            if let error = push.lastError { Text(error).font(.footnote).foregroundStyle(.red) }
        } header: {
            Text("Plats prêts")
        } footer: {
            Text("Quand la cuisine passe un plat à « Prêt », le serveur de la table est prévenu sur son téléphone, même l'écran éteint. Toucher la notification ouvre la commande.")
        }
    }
}
