import SwiftUI

/// Écran PIN d'un appareil enregistré : on touche son prénom, puis on tape son code.
struct PinLockView: View {
    @Environment(AppState.self) private var app
    @State private var team: [TeamMember] = []
    @State private var selected: TeamMember?
    @State private var pin = ""
    @State private var busy = false
    @State private var error: String?
    @State private var shake = 0

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 28) {
                    VStack(spacing: 6) {
                        Text(app.me?.terminal?.name ?? "Caisse").font(.headline).foregroundStyle(.secondary)
                        Text(selected.map { "Bonjour \($0.name)" } ?? "Qui êtes-vous ?").font(.largeTitle.bold())
                    }
                    .padding(.top, 24)

                    if !team.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 16) {
                                ForEach(team) { member in
                                    Button {
                                        selected = selected == member ? nil : member
                                        pin = ""
                                        error = nil
                                    } label: {
                                        VStack(spacing: 6) {
                                            InitialsBadge(text: member.initials ?? String(member.name.prefix(2)), color: Color(hex: member.color), size: 56)
                                                .overlay(Circle().stroke(Color.lagon, lineWidth: selected == member ? 4 : 0).padding(-4))
                                            Text(member.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                                            if let role = member.roleName { Text(role).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
                                        }
                                        .frame(width: 86)
                                        .opacity(selected == nil || selected == member ? 1 : 0.45)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.horizontal)
                        }
                    }

                    PinPad(pin: $pin, onSubmit: submit)
                        .modifier(Shake(animatableData: CGFloat(shake)))
                        .disabled(busy)

                    if let error {
                        Text(error).foregroundStyle(.red).font(.subheadline.weight(.medium))
                    }
                }
                .frame(maxWidth: .infinity)
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Connexion par e-mail", systemImage: "envelope") { Task { await app.signOutCompletely() } }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .task { await loadTeam() }
            .onChange(of: pin) { _, value in
                // Avec un prénom choisi, le PIN part tout seul dès 4 chiffres s'il n'existe pas de PIN plus long
                if value.count == 6 { submit() }
            }
        }
    }

    private func loadTeam() async {
        do { team = try await app.team() } catch { self.error = app.handle(error) }
    }

    private func submit() {
        guard (4...6).contains(pin.count), !busy else { return }
        busy = true
        let code = pin
        Task {
            do {
                try await app.pinLogin(userId: selected?.id, pin: code)
            } catch {
                self.error = app.handle(error)
                pin = ""
                withAnimation(.default) { shake += 1 }
            }
            busy = false
        }
    }
}

/// Petit tremblement quand le PIN est faux.
struct Shake: GeometryEffect {
    var animatableData: CGFloat
    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: 10 * sin(animatableData * .pi * 4), y: 0))
    }
}
