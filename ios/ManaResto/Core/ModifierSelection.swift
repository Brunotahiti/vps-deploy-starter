import Foundation

/// Choix envoyés au serveur pour un produit : `{ modifierId, quantity }`.
struct ModifierChoice: Encodable, Equatable {
    let modifierId: String
    var quantity: Int? = nil
}

/// Options choisies pour un produit (cuisson, accompagnement, suppléments), avec les règles min / max de chaque groupe.
struct ModifierSelection: Equatable {
    private(set) var chosen: [String: [String]] = [:] // groupe → options, dans l'ordre du choix

    /// Options par défaut pré-cochées (dans la limite du maximum du groupe).
    init(groups: [ModifierGroup]) {
        for g in groups {
            let defaults = g.availableModifiers.filter { $0.isDefault == true }.map(\.id)
            chosen[g.id] = Array(defaults.prefix(g.maxSelect ?? defaults.count))
        }
    }

    func isSelected(_ modifier: Modifier, in group: ModifierGroup) -> Bool {
        chosen[group.id, default: []].contains(modifier.id)
    }

    /// Choix unique : remplace. Choix multiple : coche / décoche, sans dépasser le maximum.
    mutating func toggle(_ modifier: Modifier, in group: ModifierGroup) {
        var ids = chosen[group.id, default: []]
        if group.isSingleChoice {
            ids = ids == [modifier.id] && group.minSelect == 0 ? [] : [modifier.id]
        } else if let i = ids.firstIndex(of: modifier.id) {
            ids.remove(at: i)
        } else if group.maxSelect == nil || ids.count < group.maxSelect! {
            ids.append(modifier.id)
        }
        chosen[group.id] = ids
    }

    /// Groupes dont le minimum n'est pas atteint (ex. « Cuisson » obligatoire).
    func missing(in groups: [ModifierGroup]) -> [ModifierGroup] {
        groups.filter { chosen[$0.id, default: []].count < $0.minSelect }
    }

    func isComplete(for groups: [ModifierGroup]) -> Bool { missing(in: groups).isEmpty }

    /// Supplément total des options choisies.
    func extra(in groups: [ModifierGroup]) -> Int {
        groups.reduce(0) { sum, g in
            sum + g.modifiers.filter { chosen[g.id, default: []].contains($0.id) }.reduce(0) { $0 + $1.priceDelta }
        }
    }

    func payload(for groups: [ModifierGroup]) -> [ModifierChoice] {
        groups.flatMap { g in chosen[g.id, default: []].map { ModifierChoice(modifierId: $0) } }
    }
}
