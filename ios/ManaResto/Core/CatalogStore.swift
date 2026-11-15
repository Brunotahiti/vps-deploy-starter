import Foundation
import Observation

/// Carte de la caisse (catégories, produits, formules, moyens de paiement), chargée une fois puis rafraîchie.
@MainActor
@Observable
final class CatalogStore {
    private(set) var catalog: Catalog?
    private(set) var loadedAt: Date?
    var error: String?

    private let api: APIClient

    init(api: APIClient = .shared) {
        self.api = api
    }

    var categories: [MenuCategory] {
        (catalog?.categories ?? []).sorted { ($0.sortOrder ?? 0, $0.name) < ($1.sortOrder ?? 0, $1.name) }
    }

    var formulas: [Formula] { (catalog?.menus ?? []).filter { $0.isActive ?? true } }

    func products(in categoryId: String?) -> [Product] {
        (catalog?.products ?? []).filter { categoryId == nil || $0.categoryId == categoryId }
    }

    func search(_ text: String) -> [Product] {
        let q = text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
        return (catalog?.products ?? []).filter { $0.name.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current).contains(q) }
    }

    /// Moyens de paiement utilisables depuis l'app (les comptes clients et cartes cadeaux restent sur la caisse web).
    var paymentMethods: [PaymentMethodConfig] {
        (catalog?.paymentMethods ?? []).filter { $0.isEnabled && !["ACCOUNT", "GIFT_CARD"].contains($0.method) }
    }

    /// Recharge si la carte a plus de 5 minutes (ou sur demande).
    func load(force: Bool = false) async {
        if !force, let loadedAt, Date.now.timeIntervalSince(loadedAt) < 300, catalog != nil { return }
        do {
            catalog = try await api.get("/api/pos/catalog")
            loadedAt = .now
            error = nil
        } catch {
            self.error = (error as? APIError)?.message ?? error.localizedDescription
        }
    }

    func reset() {
        catalog = nil
        loadedAt = nil
    }
}
