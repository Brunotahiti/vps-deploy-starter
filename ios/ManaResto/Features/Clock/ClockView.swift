import SwiftUI

/// Pointeuse : l'employé tape son PIN, voit son état et choisit Arrivée, Pause, Reprise ou Départ.
struct ClockView: View {
    @Environment(AppState.self) private var app
    @State private var pin = ""
    @State private var status: ClockStatus?
    @State private var message: String?
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                if let status {
                    VStack(spacing: 8) {
                        Text("\(status.employee.firstName) · \(status.stateLabel)").font(.title.bold())
                        if status.workedMs > 0 { Text("Travaillé aujourd'hui : \(Elapsed.hours(fromMs: status.workedMs))").foregroundStyle(.secondary) }
                    }
                    VStack(spacing: 12) {
                        ForEach(status.allowed, id: \.self) { kind in
                            Button { clock(kind) } label: {
                                Label(ClockStatus.label(for: kind), systemImage: icon(kind)).frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(kind == "CLOCK_OUT" ? Color.orange : Color.lagon)
                            .controlSize(.large)
                            .disabled(busy)
                        }
                        Button("Annuler") { reset() }.buttonStyle(.bordered)
                    }
                    .frame(maxWidth: 360)
                } else {
                    Text("Tapez votre code PIN").font(.title2.bold())
                    PinPad(pin: $pin, onSubmit: identify).disabled(busy)
                }
                if let message {
                    Label(message, systemImage: "checkmark.circle.fill").font(.headline).foregroundStyle(.green)
                }
                if let error {
                    Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
                }
            }
            .padding(.top, 30)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle("Pointeuse")
    }

    private func icon(_ kind: String) -> String {
        switch kind {
        case "CLOCK_IN": "arrow.right.circle.fill"
        case "BREAK_START": "cup.and.saucer.fill"
        case "BREAK_END": "arrow.uturn.backward.circle.fill"
        default: "arrow.left.circle.fill"
        }
    }

    private struct PinOnly: Encodable { let pin: String }
    private struct ClockRequest: Encodable { let pin: String; let kind: String }

    private func identify() {
        busy = true
        error = nil
        message = nil
        Task {
            do { status = try await app.api.post("/api/staff/clock/identify", PinOnly(pin: pin)) }
            catch { self.error = app.handle(error); pin = "" }
            busy = false
        }
    }

    private func clock(_ kind: String) {
        busy = true
        Task {
            do {
                let after: ClockStatus = try await app.api.post("/api/staff/clock", ClockRequest(pin: pin, kind: kind))
                message = "\(ClockStatus.label(for: kind)) enregistré\(kind == "CLOCK_OUT" ? "" : "e") pour \(after.employee.firstName)"
                reset(keepMessage: true)
            } catch {
                self.error = app.handle(error)
            }
            busy = false
        }
    }

    private func reset(keepMessage: Bool = false) {
        pin = ""
        status = nil
        if !keepMessage { message = nil }
    }
}
