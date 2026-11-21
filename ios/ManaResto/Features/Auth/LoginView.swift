import SwiftUI

/// Connexion du gérant (e-mail + mot de passe), puis proposition d'enregistrer l'appareil comme caisse.
struct LoginView: View {
    @Environment(AppState.self) private var app
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?
    @State private var showServer = false
    @State private var server = APIClient.shared.baseURL.absoluteString
    @FocusState private var focus: Field?

    private enum Field { case email, password }

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                VStack(spacing: 10) {
                    Image(systemName: "fork.knife.circle.fill")
                        .font(.system(size: 64))
                        .foregroundStyle(Color.lagon)
                    Text("ManaResto").font(.largeTitle.bold())
                    Text("Caisse, salle et cuisine de votre restaurant")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.top, 40)

                VStack(spacing: 12) {
                    TextField("E-mail", text: $email)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .email)
                        .submitLabel(.next)
                        .onSubmit { focus = .password }
                    SecureField("Mot de passe", text: $password)
                        .textContentType(.password)
                        .focused($focus, equals: .password)
                        .submitLabel(.go)
                        .onSubmit(signIn)
                }
                .textFieldStyle(.roundedBorder)
                .controlSize(.large)

                if !ServerPolicy.isOfficial(APIClient.shared.baseURL) {
                    // Autre serveur que ManaResto : on montre toujours lequel reçoit l'e-mail et le mot de passe
                    Label("Connexion au serveur \(APIClient.shared.baseURL.host ?? "inconnu") : vérifiez que c'est bien celui de votre restaurant.", systemImage: "server.rack")
                        .font(.footnote)
                        .foregroundStyle(.orange)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                if let error {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.subheadline)
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                VStack(spacing: 12) {
                    Button(action: signIn) {
                        Group { if busy { ProgressView() } else { Text("Se connecter") } }
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(busy || email.isEmpty || password.isEmpty)

                    Button("Découvrir le restaurant de démonstration", action: demo)
                        .buttonStyle(.bordered)
                        .controlSize(.large)
                        .disabled(busy)
                }

                Text("Connectez-vous avec le compte ManaResto de votre restaurant. Vos employés se connectent ensuite par code PIN.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                if let privacy = APIClient.shared.url("/confidentialite") {
                    Link("Politique de confidentialité", destination: privacy)
                        .font(.footnote)
                }

                DisclosureGroup("Avancé", isExpanded: $showServer) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Adresse du serveur, si votre restaurant a sa propre installation. En https, sauf pour un boîtier sur le réseau du restaurant.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        HStack {
                            TextField("https://app.manaresto.com", text: $server)
                                .keyboardType(.URL)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .textFieldStyle(.roundedBorder)
                            Button("Utiliser") { useServer() }
                                .disabled(URL(string: server.trimmingCharacters(in: .whitespaces)).map(ServerPolicy.isAllowed) != true)
                        }
                    }
                    .padding(.top, 8)
                }
                .font(.footnote)
            }
            .padding(24)
            .frame(maxWidth: 460)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func signIn() {
        guard !email.isEmpty, !password.isEmpty else { return }
        run { try await app.login(email: email, password: password) }
    }

    private func demo() {
        run { try await app.openDemo() }
    }

    private func useServer() {
        guard let url = URL(string: server.trimmingCharacters(in: .whitespaces)), ServerPolicy.isAllowed(url) else { return }
        app.setServer(url)
        Task { await app.bootstrap() }
    }

    private func run(_ work: @escaping () async throws -> Void) {
        busy = true
        error = nil
        Task {
            do { try await work() } catch { self.error = app.handle(error) }
            busy = false
        }
    }
}

/// Proposée après la connexion du gérant : l'appareil devient une caisse, l'équipe se connecte ensuite par PIN.
struct RegisterDeviceCard: View {
    @Environment(AppState.self) private var app
    @State private var name = UIDevice.current.model == "iPad" ? "iPad caisse" : "iPhone serveur"
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        Section {
            TextField("Nom de l'appareil", text: $name)
            Button {
                busy = true
                Task {
                    do { try await app.registerDevice(name: name) } catch { self.error = app.handle(error) }
                    busy = false
                }
            } label: {
                Label(busy ? "Enregistrement…" : "Enregistrer cet appareil comme caisse", systemImage: "ipad.and.iphone")
            }
            .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
            if let error { Text(error).foregroundStyle(.red).font(.footnote) }
        } header: {
            Text("Connexion rapide de l'équipe")
        } footer: {
            Text("Une fois l'appareil enregistré, chaque employé touche son prénom et tape son code PIN, sans e-mail ni mot de passe.")
        }
    }
}
