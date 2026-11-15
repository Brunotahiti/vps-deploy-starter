import SwiftUI

/// Pavé numérique du PIN et du pointage : grosses touches, retour haptique.
struct PinPad: View {
    @Binding var pin: String
    var length: ClosedRange<Int> = 4...6
    var onSubmit: () -> Void

    private let keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"]

    var body: some View {
        VStack(spacing: 20) {
            HStack(spacing: 14) {
                ForEach(0..<length.upperBound, id: \.self) { i in
                    Circle()
                        .fill(i < pin.count ? Color.lagon : Color.secondary.opacity(i < length.lowerBound ? 0.3 : 0.12))
                        .frame(width: 14, height: 14)
                }
            }
            .accessibilityLabel("\(pin.count) chiffres saisis")
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(84), spacing: 16), count: 3), spacing: 16) {
                ForEach(keys, id: \.self) { key in
                    Button {
                        tap(key)
                    } label: {
                        Group {
                            if key == "⌫" { Image(systemName: "delete.left") }
                            else { Text(key) }
                        }
                        .font(.title.weight(.semibold))
                        .frame(width: 84, height: 84)
                        .background(key == "OK" ? Color.lagon : Color.secondary.opacity(0.12), in: Circle())
                        .foregroundStyle(key == "OK" ? Color.white : Color.primary)
                    }
                    .buttonStyle(.plain)
                    .disabled(key == "OK" && !length.contains(pin.count))
                    .opacity(key == "OK" && !length.contains(pin.count) ? 0.4 : 1)
                    .accessibilityLabel(key == "⌫" ? "Effacer" : key == "OK" ? "Valider" : key)
                }
            }
        }
        .sensoryFeedback(.selection, trigger: pin)
    }

    private func tap(_ key: String) {
        switch key {
        case "⌫": if !pin.isEmpty { pin.removeLast() }
        case "OK": onSubmit()
        default:
            guard pin.count < length.upperBound else { return }
            pin.append(key)
        }
    }
}

/// Pastille ronde avec les initiales (équipe, serveur d'une table).
struct InitialsBadge: View {
    let text: String
    let color: Color
    var size: CGFloat = 44

    var body: some View {
        Text(text)
            .font(.system(size: size * 0.38, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(color, in: Circle())
    }
}

/// Photo d'un produit servie par le serveur ManaResto.
struct RemoteImage: View {
    let path: String?
    var placeholder: Color = .secondary.opacity(0.12)

    var body: some View {
        if let path, let url = APIClient.shared.url(path) {
            AsyncImage(url: url, transaction: Transaction(animation: .easeOut(duration: 0.2))) { phase in
                if let image = phase.image {
                    image.resizable().scaledToFill()
                } else {
                    placeholder
                }
            }
        } else {
            placeholder
        }
    }
}

/// Message d'erreur affiché en haut d'un écran, qui se ferme d'un geste.
struct ErrorBanner: View {
    @Binding var message: String?

    var body: some View {
        if let message {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "exclamationmark.triangle.fill")
                Text(message).frame(maxWidth: .infinity, alignment: .leading)
                Button { self.message = nil } label: { Image(systemName: "xmark") }
                    .accessibilityLabel("Fermer")
            }
            .font(.subheadline.weight(.medium))
            .foregroundStyle(.white)
            .padding(12)
            .background(Color.red.gradient, in: RoundedRectangle(cornerRadius: 14))
            .padding(.horizontal)
            .transition(.move(edge: .top).combined(with: .opacity))
        }
    }
}

extension View {
    /// Rafraîchit le contenu à intervalle régulier tant que l'écran est affiché.
    func refreshing(every seconds: Double, _ action: @escaping () async -> Void) -> some View {
        task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(seconds))
                if Task.isCancelled { break }
                await action()
            }
        }
    }
}
