import SwiftUI

/// Plan de salle : chaque table avec son état (libre, commande en cours, en cuisine, addition…).
struct FloorView: View {
    @Environment(AppState.self) private var app
    @Environment(PushManager.self) private var push
    @AppStorage("pushPromptDismissed") private var pushPromptDismissed = false
    @State private var rooms: [Room] = []
    @State private var roomId: String?
    @State private var path: [String] = []
    @State private var opening: FloorTable?
    @State private var covers = 2
    @State private var error: String?
    @State private var loaded = false

    private var room: Room? { rooms.first { $0.id == roomId } ?? rooms.first }

    var body: some View {
        NavigationStack(path: $path) {
            VStack(spacing: 0) {
                ErrorBanner(message: $error)
                if push.status == .notDetermined && push.serverEnabled == true && !pushPromptDismissed {
                    PushPrompt(onEnable: { Task { await push.enable() } }, onDismiss: { pushPromptDismissed = true })
                }
                if rooms.count > 1 {
                    Picker("Salle", selection: Binding(get: { room?.id ?? "" }, set: { roomId = $0 })) {
                        ForEach(rooms) { Text($0.name).tag($0.id) }
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal)
                    .padding(.vertical, 8)
                }
                ScrollView {
                    if let room {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                            ForEach(room.tables) { table in
                                Button { tap(table) } label: { TableCard(table: table) }
                                    .buttonStyle(.plain)
                            }
                        }
                        .padding()
                    } else if loaded {
                        ContentUnavailableView("Aucune table", systemImage: "square.grid.3x3", description: Text("Créez vos salles et vos tables dans Gestion → Salle & tables."))
                    }
                }
                .refreshable { await load() }
            }
            .navigationTitle(app.establishmentName)
            .navigationDestination(for: String.self) { orderId in
                OrderView(orderId: orderId)
            }
            .overlay { if !loaded { ProgressView() } }
            .task { await load() }
            .refreshing(every: 10) { if path.isEmpty { await load() } }
            .onChange(of: path) { _, p in if p.isEmpty { Task { await load() } } }
            .sheet(item: $opening) { table in
                CoversSheet(table: table, covers: $covers) { await open(table) }
                    .presentationDetents([.height(320)])
            }
        }
    }

    private func load() async {
        do {
            let floor: Floor = try await app.api.get("/api/floor")
            rooms = floor.rooms
            if roomId == nil { roomId = rooms.first?.id }
        } catch {
            self.error = app.handle(error)
        }
        loaded = true
    }

    private func tap(_ table: FloorTable) {
        if let order = table.order {
            path.append(order.id)
        } else {
            covers = min(max(table.seats ?? 2, 1), 12)
            opening = table
        }
    }

    private struct NewOrder: Encodable { let type = "DINE_IN"; let tableId: String; let covers: Int }

    private func open(_ table: FloorTable) async {
        do {
            let order: Order = try await app.api.post("/api/orders", NewOrder(tableId: table.id, covers: covers))
            opening = nil
            path.append(order.id)
        } catch {
            opening = nil
            self.error = app.handle(error)
            await load()
        }
    }
}

struct TableCard: View {
    let table: FloorTable

    private var tint: Color {
        switch table.status {
        case "FREE": .green
        case "OCCUPIED", "ORDERING": .orange
        case "SENT": .blue
        case "BILL": .purple
        case "RESERVED": .indigo
        case "TO_CLEAN": .gray
        default: .secondary
        }
    }

    private var label: String {
        switch table.status {
        case "FREE": "Libre"
        case "OCCUPIED": "Installée"
        case "ORDERING": "Commande en cours"
        case "SENT": "En cuisine"
        case "BILL": "Addition"
        case "RESERVED": "Réservée"
        case "TO_CLEAN": "À débarrasser"
        default: table.status
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(table.name).font(.title2.bold())
                Spacer()
                if let initials = table.serverInitials {
                    InitialsBadge(text: initials, color: Color(hex: table.serverColor, fallback: .gray), size: 28)
                }
            }
            Label(label, systemImage: "circle.fill")
                .labelStyle(StatusLabelStyle(color: tint))
                .font(.subheadline.weight(.semibold))
            if let order = table.order {
                HStack {
                    Text(Money.format(order.total)).font(.headline.monospacedDigit())
                    Spacer()
                    Text(Elapsed.short(since: order.openedAt)).font(.caption).foregroundStyle(.secondary)
                }
                HStack(spacing: 6) {
                    if let c = order.covers { Label("\(c)", systemImage: "person.fill").font(.caption) }
                    if let ready = order.readyCount, ready > 0 {
                        Label("\(ready) prêt\(ready > 1 ? "s" : "")", systemImage: "bell.fill").font(.caption.bold()).foregroundStyle(.green)
                    }
                }
            } else if let r = table.reservation {
                Text([r.name, r.partySize.map { "\($0) pers." }, r.startsAt.map { $0.formatted(date: .omitted, time: .shortened) }].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            } else if let seats = table.seats {
                Label("\(seats) places", systemImage: "chair.fill").font(.caption).foregroundStyle(.secondary)
            }
            if let service = table.service, let text = service.label {
                Text(text)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(service.late == true ? .red : .secondary)
                    .lineLimit(2)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 130, alignment: .topLeading)
        .background(tint.opacity(0.10), in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(tint.opacity(0.45), lineWidth: 1.5))
        .contentShape(RoundedRectangle(cornerRadius: 18))
        .accessibilityElement(children: .combine)
    }
}

struct StatusLabelStyle: LabelStyle {
    let color: Color
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) {
            configuration.icon.font(.system(size: 8)).foregroundStyle(color)
            configuration.title
        }
    }
}

/// Nombre de couverts à l'ouverture d'une table.
struct CoversSheet: View {
    let table: FloorTable
    @Binding var covers: Int
    let open: () async -> Void
    @State private var busy = false

    var body: some View {
        VStack(spacing: 20) {
            Text("Table \(table.name)").font(.title2.bold())
            Text("Combien de couverts ?").foregroundStyle(.secondary)
            HStack(spacing: 24) {
                Button { covers = max(1, covers - 1) } label: { Image(systemName: "minus.circle.fill").font(.system(size: 44)) }
                Text("\(covers)").font(.system(size: 48, weight: .bold).monospacedDigit()).frame(minWidth: 70)
                Button { covers = min(50, covers + 1) } label: { Image(systemName: "plus.circle.fill").font(.system(size: 44)) }
            }
            .sensoryFeedback(.selection, trigger: covers)
            Button {
                busy = true
                Task { await open(); busy = false }
            } label: {
                Text(busy ? "Ouverture…" : "Ouvrir la table").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(busy)
        }
        .padding(24)
    }
}

/// Invitation discrète à activer « plat prêt » sur l'appareil.
struct PushPrompt: View {
    let onEnable: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "bell.badge.fill").font(.title2).foregroundStyle(Color.lagon)
            VStack(alignment: .leading, spacing: 2) {
                Text("Plats prêts sur ce téléphone").font(.subheadline.weight(.semibold))
                Text("Soyez prévenu dès que la cuisine a fini un plat de vos tables.").font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 4)
            Button("Activer", action: onEnable).buttonStyle(.borderedProminent).controlSize(.small)
            Button(action: onDismiss) { Image(systemName: "xmark") }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .accessibilityLabel("Plus tard")
        }
        .padding(12)
        .background(Color.lagon.opacity(0.10), in: RoundedRectangle(cornerRadius: 14))
        .padding(.horizontal)
        .padding(.top, 8)
    }
}
