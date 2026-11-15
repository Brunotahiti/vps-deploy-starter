import SwiftUI

/// Écran cuisine : les bons à préparer, avec leur temps d'attente ; un geste fait passer le bon à l'étape suivante.
struct KitchenView: View {
    @Environment(AppState.self) private var app
    @Environment(CatalogStore.self) private var catalog
    @State private var tickets: [KitchenTicket] = []
    @State private var stationId: String?
    @State private var error: String?
    @State private var loaded = false
    @State private var now = Date.now

    private var shown: [KitchenTicket] {
        tickets.filter { stationId == nil || $0.station?.id == stationId }
            .sorted { ($0.isUrgent == true ? 0 : 1, $0.createdAt) < ($1.isUrgent == true ? 0 : 1, $1.createdAt) }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                if loaded && shown.isEmpty {
                    ContentUnavailableView("Rien à préparer", systemImage: "checkmark.seal", description: Text("Les nouveaux bons arrivent ici tout seuls."))
                        .padding(.top, 60)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 280), spacing: 12)], spacing: 12) {
                    ForEach(shown) { ticket in
                        TicketCard(ticket: ticket, now: now, onAdvance: advance, onItem: toggleItem)
                    }
                }
                .padding()
            }
            .overlay(alignment: .top) { ErrorBanner(message: $error) }
            .overlay { if !loaded { ProgressView() } }
            .navigationTitle("Cuisine")
            .toolbar {
                if let stations = catalog.catalog?.stations, stations.count > 1 {
                    Picker("Poste", selection: $stationId) {
                        Text("Tous les postes").tag(String?.none)
                        ForEach(stations) { Text($0.name).tag(Optional($0.id)) }
                    }
                }
            }
            .refreshable { await load() }
            .task { await load() }
            .refreshing(every: 5) { await load(); now = .now }
        }
    }

    private func load() async {
        do { tickets = try await app.api.get("/api/kitchen/tickets") } catch { self.error = app.handle(error) }
        loaded = true
    }

    private struct Status: Encodable { let status: String }
    private struct Ready: Encodable { let ready: Bool }

    private func advance(_ ticket: KitchenTicket) {
        guard let step = ticket.nextStep else { return }
        Task {
            do {
                let _: Ignored = try await app.api.post("/api/kitchen/tickets/\(ticket.id)/status", Status(status: step.status))
            } catch { self.error = app.handle(error) }
            await load()
        }
    }

    private func toggleItem(_ ticket: KitchenTicket, _ item: KitchenItem) {
        Task {
            do {
                let _: Ignored = try await app.api.post("/api/kitchen/tickets/\(ticket.id)/items/\(item.id)", Ready(ready: !item.isReady))
            } catch { self.error = app.handle(error) }
            await load()
        }
    }
}

struct TicketCard: View {
    let ticket: KitchenTicket
    let now: Date
    let onAdvance: (KitchenTicket) -> Void
    let onItem: (KitchenTicket, KitchenItem) -> Void

    private var waited: TimeInterval { now.timeIntervalSince(ticket.createdAt) }
    private var tint: Color {
        if let alert = ticket.station?.alertAfterSec, waited >= Double(alert) { return .red }
        if let warn = ticket.station?.warnAfterSec, waited >= Double(warn) { return .orange }
        return .green
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(ticket.title).font(.title3.bold())
                    Text([ticket.course?.name, ticket.order.server?.name, ticket.order.covers.map { "\($0) couv." }].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(Elapsed.short(since: ticket.createdAt, now: now)).font(.headline.monospacedDigit()).foregroundStyle(tint)
                    if ticket.isUrgent == true { Text("URGENT").font(.caption2.weight(.heavy)).foregroundStyle(.red) }
                }
            }
            Divider()
            ForEach(ticket.items) { item in
                Button { onItem(ticket, item) } label: {
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: item.isReady ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(item.isReady ? Color.green : Color.secondary)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(item.quantity) × \(item.name)").font(.headline).strikethrough(item.isReady)
                            ForEach(Array((item.modifiers ?? []).enumerated()), id: \.offset) { _, m in
                                Text(m.name).font(.subheadline).foregroundStyle(.secondary)
                            }
                            if let n = item.notes, !n.isEmpty { Text("« \(n) »").font(.subheadline.italic()).foregroundStyle(.orange) }
                        }
                        Spacer()
                        if let seat = item.seatNumber { Text("P\(seat)").font(.caption.bold()).foregroundStyle(.secondary) }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            if let notes = ticket.order.notes, !notes.isEmpty {
                Text(notes).font(.footnote).padding(8).frame(maxWidth: .infinity, alignment: .leading).background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
            }
            if let step = ticket.nextStep {
                Button { onAdvance(ticket) } label: { Text(step.label).frame(maxWidth: .infinity) }
                    .buttonStyle(.borderedProminent)
                    .tint(step.status == "READY" ? Color.green : Color.lagon)
                    .controlSize(.large)
            }
        }
        .padding(14)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(tint, lineWidth: 3).opacity(ticket.status == "READY" ? 0 : 1))
    }
}
