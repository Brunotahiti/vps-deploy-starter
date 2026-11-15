import SwiftUI

/// Prise de commande : la carte d'un côté, le ticket de l'autre (sur iPhone, le ticket s'ouvre depuis la barre du bas).
struct OrderView: View {
    let orderId: String
    var onClosed: (() -> Void)? = nil

    @Environment(AppState.self) private var app
    @Environment(CatalogStore.self) private var catalog
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dismiss) private var dismiss

    @State private var order: Order?
    @State private var error: String?
    @State private var busy = false
    @State private var showTicket = false
    @State private var showPayment = false
    @State private var productSheet: Product?
    @State private var formulaSheet: Formula?
    @State private var addedTick = 0

    var body: some View {
        Group {
            if sizeClass == .regular {
                HStack(spacing: 0) {
                    CatalogPane(onProduct: tapProduct, onFormula: { formulaSheet = $0 })
                    Divider()
                    ticket.frame(width: 380)
                }
            } else {
                CatalogPane(onProduct: tapProduct, onFormula: { formulaSheet = $0 })
                    .safeAreaInset(edge: .bottom) { bottomBar }
            }
        }
        .overlay(alignment: .top) { ErrorBanner(message: $error).padding(.top, 4) }
        .navigationTitle(order?.title ?? "Commande")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let covers = order?.covers, order?.table != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    Label("\(covers)", systemImage: "person.2.fill").labelStyle(.titleAndIcon).font(.subheadline)
                }
            }
        }
        .task { await reload() }
        .task { await catalog.load() }
        .sensoryFeedback(.success, trigger: addedTick)
        .sheet(isPresented: $showTicket) {
            NavigationStack { ticket.navigationTitle(order?.title ?? "Commande").navigationBarTitleDisplayMode(.inline) }
                .presentationDetents([.medium, .large])
        }
        .sheet(item: $productSheet) { product in
            ProductSheet(product: product) { variantId, modifiers, quantity, notes in
                await add(AddItem(productId: product.id, variantId: variantId, quantity: quantity, notes: notes, modifiers: modifiers))
            }
        }
        .sheet(item: $formulaSheet) { formula in
            FormulaSheet(formula: formula) { selections in
                await add(AddItem(menuId: formula.id, menuSelections: selections))
            }
        }
        .sheet(isPresented: $showPayment) {
            if let order {
                PaymentSheet(order: order) { updated in
                    self.order = updated
                } onFinished: {
                    showPayment = false
                    onClosed?()
                    dismiss()
                }
            }
        }
    }

    // MARK: Ticket

    private var ticket: some View {
        TicketPane(order: order, busy: busy, onQuantity: setQuantity, onRemove: remove, onSend: send, onPay: { showPayment = true })
    }

    private var bottomBar: some View {
        Button { showTicket = true } label: {
            HStack {
                Image(systemName: "list.bullet.rectangle.portrait")
                Text(order.map { "\($0.lines.reduce(0) { $0 + $1.quantity }) article(s)" } ?? "Commande")
                if let pending = order?.pendingCount, pending > 0 {
                    Text("\(pending) à envoyer").font(.caption.bold()).padding(.horizontal, 8).padding(.vertical, 3).background(.orange, in: Capsule())
                }
                Spacer()
                Text(Money.format(order?.total ?? 0)).font(.headline.monospacedDigit())
            }
            .padding()
            .foregroundStyle(.white)
            .background(Color.lagon, in: RoundedRectangle(cornerRadius: 16))
            .padding(.horizontal)
            .padding(.bottom, 6)
        }
        .buttonStyle(.plain)
    }

    // MARK: Actions

    struct AddItem: Encodable {
        var productId: String? = nil
        var menuId: String? = nil
        var variantId: String? = nil
        var quantity: Int? = nil
        var notes: String? = nil
        var modifiers: [ModifierChoice]? = nil
        var menuSelections: [FormulaChoice]? = nil
    }

    private func tapProduct(_ product: Product) {
        guard product.orderable else { return }
        if product.needsOptions {
            productSheet = product
        } else {
            Task { _ = await add(AddItem(productId: product.id, quantity: 1)) }
        }
    }

    @discardableResult
    private func add(_ item: AddItem) async -> Bool {
        do {
            order = try await app.api.post("/api/orders/\(orderId)/items", item)
            addedTick += 1
            return true
        } catch {
            self.error = app.handle(error)
            return false
        }
    }

    private struct Quantity: Encodable { let quantity: Int }
    private struct Reason: Encodable { let reason: String? }
    private struct SendAll: Encodable { let all = true }

    private func setQuantity(_ item: OrderItem, _ quantity: Int) {
        mutate {
            if quantity <= 0 {
                try await app.api.delete("/api/orders/\(orderId)/items/\(item.id)", Reason(reason: nil))
            } else {
                let _: Ignored = try await app.api.patch("/api/orders/\(orderId)/items/\(item.id)", Quantity(quantity: quantity))
            }
        }
    }

    private func remove(_ item: OrderItem) {
        mutate { try await app.api.delete("/api/orders/\(orderId)/items/\(item.id)", Reason(reason: item.isPending ? nil : "Retiré depuis l'app")) }
    }

    private func send() {
        mutate { let _: Ignored = try await app.api.post("/api/orders/\(orderId)/send", SendAll()) }
    }

    private func mutate(_ work: @escaping () async throws -> Void) {
        busy = true
        Task {
            do { try await work() } catch { self.error = app.handle(error) }
            await reload()
            busy = false
        }
    }

    private func reload() async {
        do { order = try await app.api.get("/api/orders/\(orderId)") } catch { self.error = app.handle(error) }
    }
}

// MARK: - Carte

/// Catégories en haut, produits en grille (photo, nom, prix), recherche.
struct CatalogPane: View {
    let onProduct: (Product) -> Void
    let onFormula: (Formula) -> Void

    @Environment(CatalogStore.self) private var catalog
    @State private var categoryId: String?
    @State private var showFormulas = false
    @State private var query = ""

    private var products: [Product] {
        if !query.isEmpty { return catalog.search(query) }
        return catalog.products(in: categoryId ?? catalog.categories.first?.id)
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    if !catalog.formulas.isEmpty {
                        chip("Formules", color: .lagon, selected: showFormulas) { showFormulas = true; query = "" }
                    }
                    ForEach(catalog.categories) { c in
                        chip(c.name, color: Color(hex: c.color), selected: !showFormulas && (categoryId ?? catalog.categories.first?.id) == c.id) {
                            categoryId = c.id
                            showFormulas = false
                            query = ""
                        }
                    }
                }
                .padding(.horizontal)
                .padding(.vertical, 10)
            }
            ScrollView {
                if catalog.catalog == nil {
                    ProgressView().padding(.top, 60)
                } else if showFormulas && query.isEmpty {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                        ForEach(catalog.formulas) { f in
                            Button { onFormula(f) } label: {
                                ProductTile(name: f.name, price: f.priceTtc, imageUrl: f.imageUrl, color: f.color, subtitle: f.description, available: true)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal)
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                        ForEach(products) { p in
                            Button { onProduct(p) } label: {
                                ProductTile(name: p.name, price: p.priceTtc, imageUrl: p.imageUrl, color: p.color, subtitle: p.needsOptions ? "Options" : nil, available: p.orderable)
                            }
                            .buttonStyle(.plain)
                            .disabled(!p.orderable)
                        }
                    }
                    .padding(.horizontal)
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .automatic), prompt: "Rechercher un plat")
        }
    }

    private func chip(_ title: String, color: Color, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(selected ? color : color.opacity(0.14), in: Capsule())
                .foregroundStyle(selected ? Color.white : Color.primary)
        }
        .buttonStyle(.plain)
    }
}

struct ProductTile: View {
    let name: String
    let price: Int
    let imageUrl: String?
    let color: String?
    let subtitle: String?
    let available: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            RemoteImage(path: imageUrl, placeholder: Color(hex: color, fallback: .secondary).opacity(0.18))
                .frame(height: 90)
                .frame(maxWidth: .infinity)
                .clipped()
            VStack(alignment: .leading, spacing: 4) {
                Text(name).font(.subheadline.weight(.semibold)).lineLimit(2).multilineTextAlignment(.leading)
                HStack {
                    Text(Money.format(price)).font(.footnote.monospacedDigit()).foregroundStyle(.secondary)
                    Spacer()
                    if !available {
                        Text("Épuisé").font(.caption2.bold()).foregroundStyle(.red)
                    } else if let subtitle {
                        Text(subtitle).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
            }
            .padding(10)
        }
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 14))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .opacity(available ? 1 : 0.45)
        .contentShape(RoundedRectangle(cornerRadius: 14))
    }
}

// MARK: - Ticket

struct TicketPane: View {
    let order: Order?
    let busy: Bool
    let onQuantity: (OrderItem, Int) -> Void
    let onRemove: (OrderItem) -> Void
    let onSend: () -> Void
    let onPay: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            if let order {
                if order.lines.isEmpty {
                    ContentUnavailableView("Commande vide", systemImage: "fork.knife", description: Text("Touchez un plat pour l'ajouter."))
                } else {
                    List {
                        ForEach(order.lines) { item in
                            TicketLine(item: item, children: order.children(of: item), onQuantity: onQuantity)
                                .swipeActions(edge: .trailing) {
                                    Button(role: .destructive) { onRemove(item) } label: { Label("Retirer", systemImage: "trash") }
                                }
                        }
                    }
                    .listStyle(.plain)
                }
                VStack(spacing: 10) {
                    if order.paidTotal > 0 {
                        row("Déjà réglé", Money.format(order.paidTotal), secondary: true)
                    }
                    if let discount = order.discountTotal, discount > 0 {
                        row("Remise", "−" + Money.format(discount), secondary: true)
                    }
                    row("Total", Money.format(order.total))
                        .font(.title3.bold())
                    HStack(spacing: 10) {
                        Button(action: onSend) {
                            Label(order.pendingCount > 0 ? "Envoyer (\(order.pendingCount))" : "Envoyé", systemImage: "paperplane.fill")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.large)
                        .disabled(busy || order.pendingCount == 0)

                        Button(action: onPay) {
                            Label("Encaisser", systemImage: "creditcard.fill").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .disabled(busy || order.due == 0 || order.lines.isEmpty)
                    }
                }
                .padding()
                .background(.bar)
            } else {
                ProgressView().frame(maxHeight: .infinity)
            }
        }
    }

    private func row(_ label: String, _ value: String, secondary: Bool = false) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text(value).monospacedDigit()
        }
        .foregroundStyle(secondary ? .secondary : .primary)
    }
}

struct TicketLine: View {
    let item: OrderItem
    let children: [OrderItem]
    let onQuantity: (OrderItem, Int) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text("\(item.quantity)×").font(.headline.monospacedDigit()).foregroundStyle(.secondary)
                Text(item.name).font(.headline)
                Spacer()
                Text(Money.format(item.lineTotal)).monospacedDigit()
            }
            ForEach(item.modifiers ?? []) { m in
                Text("+ \(m.name)\(m.priceDelta > 0 ? " (\(Money.format(m.priceDelta)))" : "")").font(.caption).foregroundStyle(.secondary)
            }
            ForEach(children) { child in
                Text("• \(child.name)").font(.caption).foregroundStyle(.secondary)
            }
            if let notes = item.notes, !notes.isEmpty {
                Text("« \(notes) »").font(.caption.italic()).foregroundStyle(.orange)
            }
            HStack {
                if let status = item.statusLabel {
                    Text(status).font(.caption2.bold()).padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Color.blue.opacity(0.15), in: Capsule())
                }
                Spacer()
                if item.isPending && item.menuId == nil {
                    Stepper("Quantité", value: Binding(get: { item.quantity }, set: { onQuantity(item, $0) }), in: 0...99)
                        .labelsHidden()
                }
            }
        }
        .padding(.vertical, 4)
    }
}
