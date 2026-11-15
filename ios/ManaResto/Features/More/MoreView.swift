import SwiftUI

struct MoreView: View {
    @Environment(AppState.self) private var app
    @Environment(CatalogStore.self) private var catalog
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
