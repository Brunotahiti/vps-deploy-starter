import SwiftUI

/// Onglets selon les droits de la personne connectée (un cuisinier ne voit que la cuisine, etc.).
struct MainTabView: View {
    @Environment(AppState.self) private var app
    @Environment(CatalogStore.self) private var catalog
    @Environment(PushManager.self) private var push

    var body: some View {
        TabView {
            if app.can("pos.use") {
                FloorView()
                    .tabItem { Label("Salle", systemImage: "square.grid.3x3.fill") }
                CounterView()
                    .tabItem { Label("Comptoir", systemImage: "takeoutbag.and.cup.and.straw.fill") }
            }
            if app.can("kds.use") {
                KitchenView()
                    .tabItem { Label("Cuisine", systemImage: "frying.pan.fill") }
            }
            if app.can("reports.view") {
                TodayView()
                    .tabItem { Label("Journée", systemImage: "chart.bar.fill") }
            }
            MoreView()
                .tabItem { Label("Plus", systemImage: "ellipsis.circle.fill") }
        }
        .task { await catalog.load() }
        // Notification « plat prêt » touchée : la commande s'ouvre par-dessus l'onglet en cours
        .sheet(item: Binding(get: { app.can("pos.use") ? push.openOrderId.map(OrderRef.init) : nil }, set: { push.openOrderId = $0?.id })) { ref in
            NavigationStack {
                OrderView(orderId: ref.id, onClosed: { push.openOrderId = nil })
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Fermer") { push.openOrderId = nil } } }
            }
        }
    }
}

/// Commande à ouvrir depuis une notification.
struct OrderRef: Identifiable, Equatable {
    let id: String
}
