import SwiftUI

/// Choix avant ajout : variante (taille…), options (cuisson, accompagnement, suppléments), quantité, note pour la cuisine.
struct ProductSheet: View {
    let product: Product
    let onAdd: (_ variantId: String?, _ modifiers: [ModifierChoice], _ quantity: Int, _ notes: String?) async -> Bool

    @Environment(\.dismiss) private var dismiss
    @State private var variantId: String?
    @State private var selection: ModifierSelection
    @State private var quantity = 1
    @State private var notes = ""
    @State private var busy = false

    init(product: Product, onAdd: @escaping (_ variantId: String?, _ modifiers: [ModifierChoice], _ quantity: Int, _ notes: String?) async -> Bool) {
        self.product = product
        self.onAdd = onAdd
        _selection = State(initialValue: ModifierSelection(groups: product.activeGroups))
        _variantId = State(initialValue: product.activeVariants.first?.id)
    }

    private var unitPrice: Int {
        let base = product.activeVariants.first { $0.id == variantId }?.priceTtc ?? product.priceTtc
        return base + selection.extra(in: product.activeGroups)
    }

    private var missing: [ModifierGroup] { selection.missing(in: product.activeGroups) }

    var body: some View {
        NavigationStack {
            Form {
                if !product.activeVariants.isEmpty {
                    Section("Format") {
                        Picker("Format", selection: $variantId) {
                            ForEach(product.activeVariants) { v in
                                Text("\(v.name) · \(Money.format(v.priceTtc))").tag(Optional(v.id))
                            }
                        }
                        .pickerStyle(.inline)
                        .labelsHidden()
                    }
                }
                ForEach(product.activeGroups) { group in
                    ModifierGroupSection(group: group, selection: $selection)
                }
                Section {
                    Stepper("Quantité : \(quantity)", value: $quantity, in: 1...50)
                    TextField("Note pour la cuisine (sans oignon…)", text: $notes, axis: .vertical)
                }
            }
            .navigationTitle(product.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Annuler") { dismiss() } }
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    busy = true
                    Task {
                        let ok = await onAdd(variantId, selection.payload(for: product.activeGroups), quantity, notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : notes)
                        busy = false
                        if ok { dismiss() }
                    }
                } label: {
                    Text(missing.isEmpty ? "Ajouter · \(Money.format(unitPrice * quantity))" : "Choisir : \(missing.map(\.name).joined(separator: ", "))")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(!missing.isEmpty || busy)
                .padding()
                .background(.bar)
            }
        }
        .presentationDetents([.large])
    }
}

/// Un groupe d'options : choix unique (rond) ou multiple (case), avec le min / max rappelé.
struct ModifierGroupSection: View {
    let group: ModifierGroup
    @Binding var selection: ModifierSelection

    private var rule: String {
        let min = group.minSelect
        guard let max = group.maxSelect else { return min == 0 ? "Facultatif" : "\(min) au moins" }
        if min == 1 && max == 1 { return "Obligatoire" }
        if min == 0 { return max == 1 ? "Facultatif · 1 au choix" : "Jusqu'à \(max)" }
        return min == max ? "\(min) à choisir" : "\(min) à \(max)"
    }

    var body: some View {
        Section {
            ForEach(group.availableModifiers) { m in
                Button {
                    selection.toggle(m, in: group)
                } label: {
                    HStack {
                        Image(systemName: icon(for: m))
                            .foregroundStyle(selection.isSelected(m, in: group) ? Color.lagon : Color.secondary)
                        Text(m.name).foregroundStyle(.primary)
                        Spacer()
                        if m.priceDelta != 0 {
                            Text((m.priceDelta > 0 ? "+" : "") + Money.format(m.priceDelta)).foregroundStyle(.secondary).monospacedDigit()
                        }
                    }
                }
            }
        } header: {
            HStack {
                Text(group.name)
                Spacer()
                Text(rule).font(.caption).foregroundStyle(group.minSelect > 0 ? .orange : .secondary)
            }
        }
    }

    private func icon(for m: Modifier) -> String {
        let on = selection.isSelected(m, in: group)
        if group.isSingleChoice { return on ? "largecircle.fill.circle" : "circle" }
        return on ? "checkmark.square.fill" : "square"
    }
}
