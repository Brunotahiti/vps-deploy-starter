import SwiftUI

/// Encaissement : moyen de paiement, montant (paiement en plusieurs fois possible), rendu de monnaie, reçu par e-mail.
/// Le tiroir-caisse s'ouvre tout seul pour les espèces, par l'imprimante du restaurant.
struct PaymentSheet: View {
    let order: Order
    let onUpdate: (Order) -> Void
    let onFinished: () -> Void

    @Environment(AppState.self) private var app
    @Environment(CatalogStore.self) private var catalog
    @Environment(\.dismiss) private var dismiss
    @State private var method: String = "CASH"
    @State private var amountText = ""
    @State private var tendered: Int?
    @State private var busy = false
    @State private var error: String?
    @State private var done: PaymentResult?
    @State private var current: Order

    init(order: Order, onUpdate: @escaping (Order) -> Void, onFinished: @escaping () -> Void) {
        self.order = order
        self.onUpdate = onUpdate
        self.onFinished = onFinished
        _current = State(initialValue: order)
        _amountText = State(initialValue: String(order.due))
    }

    private var amount: Int { min(Int(amountText.filter(\.isNumber)) ?? 0, current.due) }
    private var change: Int { max(0, (tendered ?? amount) - amount) }

    var body: some View {
        NavigationStack {
            Group {
                if let done, done.order.status == "PAID" {
                    PaidView(result: done, onFinished: onFinished)
                } else {
                    form
                }
            }
            .navigationTitle(current.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if done?.order.status != "PAID" {
                    ToolbarItem(placement: .cancellationAction) { Button("Fermer") { dismiss() } }
                }
            }
        }
        .interactiveDismissDisabled(done?.order.status == "PAID")
    }

    private var form: some View {
        Form {
            Section {
                HStack {
                    Text("Reste à payer")
                    Spacer()
                    Text(Money.format(current.due)).font(.title2.bold().monospacedDigit())
                }
                if current.paidTotal > 0 {
                    HStack { Text("Déjà réglé"); Spacer(); Text(Money.format(current.paidTotal)).monospacedDigit() }.foregroundStyle(.secondary)
                }
            }

            Section("Moyen de paiement") {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 8)], spacing: 8) {
                    ForEach(catalog.paymentMethods) { m in
                        Button {
                            method = m.method
                            tendered = nil
                        } label: {
                            Label(m.title, systemImage: icon(m.method))
                                .font(.subheadline.weight(.semibold))
                                .frame(maxWidth: .infinity, minHeight: 44)
                                .background(method == m.method ? Color.lagon : Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
                                .foregroundStyle(method == m.method ? Color.white : Color.primary)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.vertical, 4)
            }

            Section {
                HStack {
                    Text("Montant")
                    TextField("Montant", text: $amountText)
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing)
                        .font(.title3.monospacedDigit())
                    Text("F")
                }
                if current.due > 1 {
                    HStack {
                        Button("Tout") { amountText = String(current.due) }
                        Spacer()
                        Button("Moitié") { amountText = String((current.due + 1) / 2) }
                        Spacer()
                        if let covers = current.covers, covers > 1 {
                            Button("Par personne (\(covers))") { amountText = String((current.due + covers - 1) / covers) }
                        }
                    }
                    .buttonStyle(.borderless)
                    .font(.subheadline)
                }
            } footer: {
                if amount < current.due && amount > 0 { Text("Paiement partiel : il restera \(Money.format(current.due - amount)).") }
            }

            if method == "CASH" && amount > 0 {
                Section("Espèces reçues") {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 90), spacing: 8)], spacing: 8) {
                        ForEach(Money.cashSuggestions(for: amount), id: \.self) { bill in
                            Button { tendered = bill } label: {
                                Text(Money.format(bill))
                                    .font(.subheadline.weight(.semibold).monospacedDigit())
                                    .frame(maxWidth: .infinity, minHeight: 40)
                                    .background((tendered ?? amount) == bill ? Color.lagon : Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
                                    .foregroundStyle((tendered ?? amount) == bill ? Color.white : Color.primary)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.vertical, 4)
                    HStack {
                        Text("À rendre")
                        Spacer()
                        Text(Money.format(change)).font(.title3.bold().monospacedDigit()).foregroundStyle(change > 0 ? Color.orange : Color.secondary)
                    }
                }
            }

            if let error {
                Section { Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) }
            }

            Section {
                Button(action: pay) {
                    HStack {
                        if busy { ProgressView().tint(.white) }
                        Text("Encaisser \(Money.format(amount))").font(.headline)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .listRowInsets(EdgeInsets())
                .disabled(busy || amount <= 0)
            }
        }
    }

    private func icon(_ method: String) -> String {
        switch method {
        case "CASH": "banknote"
        case "CARD": "creditcard"
        case "CHECK": "signature"
        case "TRANSFER": "building.columns"
        case "MEAL_VOUCHER": "ticket"
        case "COMPLIMENTARY": "gift"
        default: "ellipsis.circle"
        }
    }

    private struct Line: Encodable { let method: String; let amount: Int; let tendered: Int? }
    private struct PayRequest: Encodable { let payments: [Line] }

    private func pay() {
        busy = true
        error = nil
        let line = Line(method: method, amount: amount, tendered: method == "CASH" ? max(tendered ?? amount, amount) : nil)
        Task {
            do {
                let result: PaymentResult = try await app.api.post("/api/orders/\(current.id)/payments", PayRequest(payments: [line]))
                current = result.order
                onUpdate(result.order)
                if result.order.status == "PAID" {
                    done = result
                } else {
                    amountText = String(result.order.due)
                    tendered = nil
                }
            } catch {
                self.error = app.handle(error)
            }
            busy = false
        }
    }
}

/// Commande réglée : monnaie à rendre en grand, reçu par e-mail si le client le souhaite.
struct PaidView: View {
    let result: PaymentResult
    let onFinished: () -> Void

    @Environment(AppState.self) private var app
    @State private var email = ""
    @State private var sending = false
    @State private var sent = false
    @State private var error: String?

    private var change: Int { result.payments.reduce(0) { $0 + ($1.changeGiven ?? 0) } }

    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                Image(systemName: "checkmark.circle.fill").font(.system(size: 72)).foregroundStyle(.green)
                    .symbolEffect(.bounce, value: result.order.id)
                Text("Encaissé").font(.largeTitle.bold())
                Text(Money.format(result.order.total)).font(.title2.monospacedDigit()).foregroundStyle(.secondary)
                if change > 0 {
                    VStack(spacing: 4) {
                        Text("À rendre").font(.headline)
                        Text(Money.format(change)).font(.system(size: 44, weight: .heavy).monospacedDigit()).foregroundStyle(.orange)
                    }
                    .padding()
                    .frame(maxWidth: .infinity)
                    .background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 18))
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Reçu par e-mail").font(.headline)
                    Text("Le client reçoit son ticket sur son téléphone, sans imprimante.").font(.footnote).foregroundStyle(.secondary)
                    HStack {
                        TextField("adresse@client.pf", text: $email)
                            .keyboardType(.emailAddress)
                            .textContentType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .textFieldStyle(.roundedBorder)
                        Button(sent ? "Envoyé" : "Envoyer", action: sendReceipt)
                            .buttonStyle(.bordered)
                            .disabled(sending || sent || !email.contains("@"))
                    }
                    if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                }
                .padding()
                .background(.background.secondary, in: RoundedRectangle(cornerRadius: 18))

                Button(action: onFinished) {
                    Text("Terminer").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }
            .padding(24)
        }
        .sensoryFeedback(.success, trigger: result.order.id)
    }

    private struct EmailBody: Encodable { let email: String }

    private func sendReceipt() {
        sending = true
        error = nil
        Task {
            do {
                let _: Ignored = try await app.api.post("/api/orders/\(result.order.id)/email", EmailBody(email: email.trimmingCharacters(in: .whitespaces)))
                sent = true
            } catch {
                self.error = app.handle(error)
            }
            sending = false
        }
    }
}
