import Foundation

// Modèles décodés depuis l'API ManaResto. Les champs secondaires sont optionnels : une évolution du serveur
// (nouveau champ, champ retiré) ne doit jamais empêcher la caisse de fonctionner.

// MARK: Session

struct Me: Decodable {
    let user: MeUser?
    let terminal: Terminal?
    let establishment: Establishment?
    let establishments: [EstablishmentRef]?
    let permissions: [String]?
    let options: [String]?
    let roleKey: String?
    let isDemo: Bool?
    let subscription: Subscription?

    func can(_ permission: String) -> Bool {
        let p = permissions ?? []
        return p.contains("*") || p.contains(permission)
    }

    func hasOption(_ key: String) -> Bool { (options ?? []).contains(key) }
}

struct MeUser: Decodable, Identifiable, Equatable {
    let id: String
    let firstName: String
    let lastName: String?
    let displayName: String?
    let color: String?
    let isOwner: Bool?
    let pinOnly: Bool?

    var name: String { displayName ?? firstName }
}

struct Terminal: Decodable, Equatable {
    let id: String
    let name: String
    let kind: String?
}

struct Establishment: Decodable, Equatable {
    let id: String
    let name: String
    let currency: String?
    let timezone: String?
}

struct EstablishmentRef: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
}

struct Subscription: Decodable, Equatable {
    let label: String?
    let expired: Bool?
}

/// Membre de l'équipe affiché sur l'écran PIN de l'appareil.
struct TeamMember: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
    let initials: String?
    let color: String?
    let roleName: String?
}

struct LoggedUser: Decodable {
    let id: String
    let firstName: String
}

// MARK: Salle

struct Floor: Decodable {
    let rooms: [Room]
}

struct Room: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
    let tables: [FloorTable]
}

struct FloorTable: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
    let seats: Int?
    let shape: String?
    let status: String
    let order: FloorOrder?
    let serverInitials: String?
    let serverColor: String?
    let service: TableService?
    let reservation: TableReservation?
}

struct FloorOrder: Decodable, Equatable {
    let id: String
    let status: String
    let covers: Int?
    let total: Int
    let paidTotal: Int
    let openedAt: Date
    let readyCount: Int?
}

struct TableService: Decodable, Equatable {
    let label: String?
    let late: Bool?
}

struct TableReservation: Decodable, Equatable {
    let name: String?
    let partySize: Int?
    let startsAt: Date?
}

// MARK: Catalogue

struct Catalog: Decodable {
    let categories: [Category]
    let products: [Product]
    let menus: [Formula]
    let paymentMethods: [PaymentMethodConfig]
    let stations: [Station]?

    func product(_ id: String) -> Product? { products.first { $0.id == id } }
}

struct Category: Decodable, Identifiable, Equatable, Hashable {
    let id: String
    let name: String
    let color: String?
    let sortOrder: Int?
}

struct Product: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
    let description: String?
    let categoryId: String?
    let priceTtc: Int
    let imageUrl: String?
    let color: String?
    let isAvailable: Bool
    let autoUnavailable: Bool?
    let variants: [Variant]
    let modifierGroups: [ModifierGroup]

    /// Vendable maintenant (pas épuisé, pas hors horaires).
    var orderable: Bool { isAvailable && !(autoUnavailable ?? false) }
    var activeVariants: [Variant] { variants.filter { $0.isActive ?? true } }
    var activeGroups: [ModifierGroup] { modifierGroups.filter { ($0.isActive ?? true) && !$0.availableModifiers.isEmpty } }
    /// Faut-il ouvrir la fenêtre de choix (variante, cuisson, suppléments) avant d'ajouter ?
    var needsOptions: Bool { !activeVariants.isEmpty || !activeGroups.isEmpty }
}

struct Variant: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
    let priceTtc: Int
    let isActive: Bool?
}

struct ModifierGroup: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
    let minSelect: Int
    let maxSelect: Int?
    let isActive: Bool?
    let modifiers: [Modifier]

    var availableModifiers: [Modifier] { modifiers.filter { $0.isAvailable ?? true } }
    var isSingleChoice: Bool { maxSelect == 1 }
}

struct Modifier: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
    let priceDelta: Int
    let isDefault: Bool?
    let isAvailable: Bool?
}

/// Formule (entrée + plat…), « menu » côté serveur.
struct Formula: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
    let description: String?
    let priceTtc: Int
    let color: String?
    let imageUrl: String?
    let isActive: Bool?
    let sections: [FormulaSection]
}

struct FormulaSection: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
    let minSelect: Int
    let maxSelect: Int?
    let items: [FormulaItem]
}

struct FormulaItem: Decodable, Identifiable, Equatable {
    let id: String
    let productId: String
    let supplement: Int
    let product: FormulaProduct?
}

struct FormulaProduct: Decodable, Equatable {
    let id: String
    let name: String
    let isAvailable: Bool?
    let isActive: Bool?
}

struct PaymentMethodConfig: Decodable, Identifiable, Equatable {
    let id: String
    let method: String
    let label: String?
    let isEnabled: Bool

    var title: String { label ?? PaymentMethodConfig.label(for: method) }

    static func label(for method: String) -> String {
        switch method {
        case "CASH": "Espèces"
        case "CARD": "Carte bancaire"
        case "CHECK": "Chèque"
        case "TRANSFER": "Virement"
        case "MEAL_VOUCHER": "Titre-restaurant"
        case "COMPLIMENTARY": "Offert"
        case "ACCOUNT": "Sur compte"
        case "GIFT_CARD": "Carte cadeau"
        default: "Autre"
        }
    }
}

struct Station: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
    let color: String?
}

// MARK: Commandes

struct Order: Decodable, Identifiable, Equatable {
    let id: String
    let number: String
    let type: String
    let status: String
    let tableId: String?
    let covers: Int?
    let subtotal: Int?
    let discountTotal: Int?
    let taxTotal: Int?
    let total: Int
    let paidTotal: Int
    let openedAt: Date
    let customerName: String?
    let tableLabel: String?
    let table: OrderTable?
    let server: Person?
    let items: [OrderItem]?
    let payments: [Payment]?

    var due: Int { max(0, total - paidTotal) }
    var isClosed: Bool { status == "PAID" || status == "CANCELLED" }
    /// Lignes visibles (hors annulées), sans les plats d'une formule (affichés sous la formule).
    var lines: [OrderItem] { (items ?? []).filter { $0.status != "VOIDED" && $0.parentItemId == nil } }
    var pendingCount: Int { lines.filter { $0.status == "PENDING" }.count }
    func children(of item: OrderItem) -> [OrderItem] { (items ?? []).filter { $0.parentItemId == item.id && $0.status != "VOIDED" } }

    /// Numéro court lisible (« 20261114-0054 » → « 54 »).
    var shortNumber: String {
        let tail = number.split(separator: "-").last.map(String.init) ?? number
        return String(Int(tail) ?? 0)
    }

    var title: String {
        if let t = table?.name { return "Table \(t)" }
        if let l = tableLabel, !l.isEmpty { return l }
        if let c = customerName, !c.isEmpty { return c }
        return "Vente n° \(shortNumber)"
    }
}

struct OrderTable: Decodable, Equatable {
    let id: String
    let name: String
}

struct Person: Decodable, Equatable {
    let id: String?
    let firstName: String?
    let displayName: String?

    var name: String { displayName ?? firstName ?? "" }
}

struct OrderItem: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
    let quantity: Int
    let unitPrice: Int
    let modifiersTotal: Int?
    let lineTotal: Int
    let status: String
    let notes: String?
    let parentItemId: String?
    let menuId: String?
    let isUrgent: Bool?
    let modifiers: [OrderItemModifier]?

    var isPending: Bool { status == "PENDING" }

    var statusLabel: String? {
        switch status {
        case "PENDING": nil
        case "SENT": "Envoyé"
        case "PREPARING": "En préparation"
        case "READY": "Prêt"
        case "SERVED": "Servi"
        default: nil
        }
    }
}

struct OrderItemModifier: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
    let groupName: String?
    let priceDelta: Int
    let quantity: Int?
}

struct Payment: Decodable, Identifiable, Equatable {
    let id: String
    let method: String
    let amount: Int
    let status: String?
    let tendered: Int?
    let changeGiven: Int?
}

struct PaymentResult: Decodable {
    let order: Order
    let payments: [Payment]
}

// MARK: Cuisine

struct KitchenTicket: Decodable, Identifiable, Equatable {
    let id: String
    let status: String
    let isUrgent: Bool?
    let createdAt: Date
    let station: KitchenStation?
    let course: KitchenCourse?
    let order: KitchenOrder
    let items: [KitchenItem]

    /// Étape suivante du ticket : statut à envoyer et libellé du bouton.
    var nextStep: KitchenStep? {
        switch status {
        case "NEW", "ACCEPTED": return KitchenStep(status: "IN_PROGRESS", label: "Commencer")
        case "IN_PROGRESS": return KitchenStep(status: "READY", label: "Prêt")
        case "READY": return KitchenStep(status: "DONE", label: "Servi")
        default: return nil
        }
    }

    var title: String {
        if let t = order.table?.name { return "Table \(t)" }
        if let l = order.tableLabel, !l.isEmpty { return l }
        if let c = order.customerName, !c.isEmpty { return c }
        let tail = order.number.split(separator: "-").last.map(String.init) ?? order.number
        return "N° \(Int(tail) ?? 0)"
    }
}

struct KitchenStep: Equatable {
    let status: String
    let label: String
}

struct KitchenStation: Decodable, Equatable {
    let id: String
    let name: String
    let color: String?
    let warnAfterSec: Int?
    let alertAfterSec: Int?
}

struct KitchenCourse: Decodable, Equatable {
    let name: String
}

struct KitchenOrder: Decodable, Equatable {
    let id: String
    let number: String
    let type: String?
    let covers: Int?
    let customerName: String?
    let tableLabel: String?
    let notes: String?
    let table: OrderTable?
    let server: Person?
}

struct KitchenItem: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
    let quantity: Int
    let seatNumber: Int?
    let notes: String?
    let isUrgent: Bool?
    let status: String
    let parentItemId: String?
    let modifiers: [KitchenModifier]?

    var isReady: Bool { status == "READY" || status == "SERVED" }
}

struct KitchenModifier: Decodable, Equatable {
    let name: String
    let groupName: String?
}

// MARK: Pointage

struct ClockStatus: Decodable, Equatable {
    struct Employee: Decodable, Equatable {
        let id: String
        let firstName: String
        let lastName: String?
        let jobTitle: String?
    }
    let employee: Employee
    let state: String
    let workedMs: Double
    let breakMs: Double
    let allowed: [String]

    var stateLabel: String {
        switch state {
        case "IN": "En service"
        case "BREAK": "En pause"
        default: "Hors service"
        }
    }

    static func label(for kind: String) -> String {
        switch kind {
        case "CLOCK_IN": "Arrivée"
        case "BREAK_START": "Pause"
        case "BREAK_END": "Reprise"
        case "CLOCK_OUT": "Départ"
        default: kind
        }
    }
}

// MARK: Journée

struct DailySummary: Decodable, Equatable {
    struct Hour: Decodable, Equatable, Identifiable {
        let hour: Int
        let revenue: Int
        let tickets: Int
        var id: Int { hour }
    }
    struct ProductLine: Decodable, Equatable, Identifiable {
        let name: String
        let revenue: Int
        let quantity: Int
        var id: String { name }
    }
    struct MethodLine: Decodable, Equatable, Identifiable {
        let method: String
        let amount: Int
        let count: Int
        var id: String { method }
    }
    struct ServerLine: Decodable, Equatable, Identifiable {
        let name: String
        let revenue: Int
        let tickets: Int
        var id: String { name }
    }
    struct Previous: Decodable, Equatable {
        let day: String
        let revenue: Int
        let tickets: Int?
        let covers: Int?
    }

    let day: String
    let revenue: Int
    let revenueHt: Int?
    let tax: Int?
    let tickets: Int
    let covers: Int
    let avgTicket: Int
    let avgPerCover: Int?
    let discounts: Int?
    let openOrders: Int?
    let foodCostPct: Double?
    let byHour: [Hour]
    let byProduct: [ProductLine]
    let byMethod: [MethodLine]?
    let byServer: [ServerLine]?
    let previous: Previous?
}
