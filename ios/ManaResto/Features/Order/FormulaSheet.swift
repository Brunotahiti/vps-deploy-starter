import SwiftUI

/// Plat choisi dans une section de formule, envoyé au serveur (`menuSelections`).
struct FormulaChoice: Encodable, Equatable {
    let sectionId: String
    let productId: String
    var modifiers: [ModifierChoice]? = nil
}

/// Formule : un plat (ou plus) par section, avec les options de chaque plat (cuisson…).
struct FormulaSheet: View {
    let formula: Formula
    let onAdd: ([FormulaChoice]) async -> Bool

    @Environment(\.dismiss) private var dismiss
    @Environment(CatalogStore.self) private var catalog
    @State private var picks: [String: [String]] = [:] // section → produits
    @State private var options: [String: ModifierSelection] = [:] // « section/produit » → options
    @State private var busy = false

    private func key(_ sectionId: String, _ productId: String) -> String { "\(sectionId)/\(productId)" }
    private func groups(_ productId: String) -> [ModifierGroup] { catalog.catalog?.product(productId)?.activeGroups ?? [] }

    private var price: Int {
        var total = formula.priceTtc
        for section in formula.sections {
            for productId in picks[section.id, default: []] {
                total += section.items.first { $0.productId == productId }?.supplement ?? 0
                total += options[key(section.id, productId)]?.extra(in: groups(productId)) ?? 0
            }
        }
        return total
    }

    private var incomplete: [String] {
        formula.sections.compactMap { s -> String? in
            let chosen = picks[s.id, default: []]
            if chosen.count < s.minSelect { return s.name }
            let optionsMissing = chosen.contains { !(options[key(s.id, $0)]?.isComplete(for: groups($0)) ?? true) }
            return optionsMissing ? "options \(s.name.lowercased())" : nil
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                ForEach(formula.sections) { section in
                    Section {
                        ForEach(section.items.filter { ($0.product?.isActive ?? true) }) { item in
                            let chosen = picks[section.id, default: []].contains(item.productId)
                            Button { toggle(section, item) } label: {
                                HStack {
                                    Image(systemName: chosen ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(chosen ? Color.lagon : Color.secondary)
                                    Text(item.product?.name ?? "Plat").foregroundStyle(.primary)
                                    Spacer()
                                    if item.supplement > 0 { Text("+" + Money.format(item.supplement)).foregroundStyle(.secondary) }
                                }
                            }
                            .disabled(item.product?.isAvailable == false)
                            if chosen {
                                ForEach(groups(item.productId)) { group in
                                    FormulaOptionsRow(group: group, selection: Binding(
                                        get: { options[key(section.id, item.productId)] ?? ModifierSelection(groups: groups(item.productId)) },
                                        set: { options[key(section.id, item.productId)] = $0 }
                                    ))
                                }
                            }
                        }
                    } header: {
                        Text(section.name)
                    } footer: {
                        if let max = section.maxSelect, max > 1 { Text("Jusqu'à \(max) choix") }
                    }
                }
            }
            .navigationTitle(formula.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Annuler") { dismiss() } } }
            .safeAreaInset(edge: .bottom) {
                Button {
                    busy = true
                    Task {
                        let ok = await onAdd(payload())
                        busy = false
                        if ok { dismiss() }
                    }
                } label: {
                    Text(incomplete.isEmpty ? "Ajouter · \(Money.format(price))" : "À choisir : \(incomplete.joined(separator: ", "))")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(!incomplete.isEmpty || busy)
                .padding()
                .background(.bar)
            }
        }
    }

    private func toggle(_ section: FormulaSection, _ item: FormulaItem) {
        var chosen = picks[section.id, default: []]
        if let i = chosen.firstIndex(of: item.productId) {
            chosen.remove(at: i)
        } else if section.maxSelect == 1 {
            chosen = [item.productId]
        } else if section.maxSelect == nil || chosen.count < section.maxSelect! {
            chosen.append(item.productId)
        }
        picks[section.id] = chosen
        for productId in chosen where options[key(section.id, productId)] == nil {
            options[key(section.id, productId)] = ModifierSelection(groups: groups(productId))
        }
    }

    private func payload() -> [FormulaChoice] {
        formula.sections.flatMap { s in
            picks[s.id, default: []].map { productId in
                let mods = options[key(s.id, productId)]?.payload(for: groups(productId)) ?? []
                return FormulaChoice(sectionId: s.id, productId: productId, modifiers: mods.isEmpty ? nil : mods)
            }
        }
    }
}

/// Options d'un plat de formule, en ligne compacte (menu déroulant ou cases).
struct FormulaOptionsRow: View {
    let group: ModifierGroup
    @Binding var selection: ModifierSelection

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(group.name + (group.minSelect > 0 ? " *" : "")).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(group.availableModifiers) { m in
                        let on = selection.isSelected(m, in: group)
                        Button { selection.toggle(m, in: group) } label: {
                            Text(m.name + (m.priceDelta > 0 ? " +\(Money.format(m.priceDelta))" : ""))
                                .font(.caption.weight(.semibold))
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(on ? Color.lagon : Color.secondary.opacity(0.12), in: Capsule())
                                .foregroundStyle(on ? Color.white : Color.primary)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(.leading, 28)
    }
}
