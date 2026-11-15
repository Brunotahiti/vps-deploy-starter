import SwiftUI

/// Ventes au comptoir et à emporter : une nouvelle vente en un geste, et les ventes encore ouvertes.
struct CounterView: View {
    @Environment(AppState.self) private var app
    @State private var orders: [Order] = []
    @State private var path: [String] = []
    @State private var error: String?
    @State private var creating = false

    private var open: [Order] { orders.filter { $0.tableId == nil && !$0.isClosed } }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section {
                    Button(action: newSale) {
                        Label(creating ? "Ouverture…" : "Nouvelle vente", systemImage: "plus.circle.fill")
                            .font(.title3.weight(.semibold))
                            .padding(.vertical, 8)
                    }
                    .disabled(creating)
                }
                if !open.isEmpty {
                    Section("En cours") {
                        ForEach(open) { o in
                            NavigationLink(value: o.id) {
                                HStack {
                                    VStack(alignment: .leading) {
                                        Text(o.title).font(.headline)
                                        Text(Elapsed.short(since: o.openedAt)).font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Text(Money.format(o.total)).monospacedDigit()
                                }
                            }
                        }
                    }
                }
            }
            .overlay(alignment: .top) { ErrorBanner(message: $error) }
            .navigationTitle("Comptoir")
            .navigationDestination(for: String.self) { OrderView(orderId: $0) }
            .refreshable { await load() }
            .task { await load() }
            .onChange(of: path) { _, p in if p.isEmpty { Task { await load() } } }
        }
    }

    private struct NewSale: Encodable { let type = "COUNTER" }

    private func newSale() {
        creating = true
        Task {
            do {
                let order: Order = try await app.api.post("/api/orders", NewSale())
                path.append(order.id)
            } catch {
                self.error = app.handle(error)
            }
            creating = false
        }
    }

    private func load() async {
        do { orders = try await app.api.get("/api/orders", query: ["open": "1", "take": "50"]) } catch { self.error = app.handle(error) }
    }
}
