import SwiftUI
import Charts

/// La journée en un coup d'œil : chiffre d'affaires, couverts, ticket moyen, ventes par heure, meilleurs plats.
struct TodayView: View {
    @Environment(AppState.self) private var app
    @State private var summary: DailySummary?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                if let s = summary {
                    VStack(spacing: 16) {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                            Kpi(title: "Chiffre d'affaires", value: Money.format(s.revenue), detail: s.previous.map { compare(s.revenue, $0.revenue) })
                            Kpi(title: "Tickets", value: "\(s.tickets)", detail: s.openOrders.map { "\($0) en cours" })
                            Kpi(title: "Couverts", value: "\(s.covers)", detail: s.avgPerCover.map { "\(Money.format($0)) / couvert" })
                            Kpi(title: "Ticket moyen", value: Money.format(s.avgTicket), detail: s.foodCostPct.map { "Coût matière \(Int($0.rounded())) %" })
                        }
                        if !s.byHour.isEmpty {
                            Card(title: "Ventes par heure") {
                                Chart(s.byHour) { h in
                                    BarMark(x: .value("Heure", "\(h.hour) h"), y: .value("CA", h.revenue))
                                        .foregroundStyle(Color.lagon.gradient)
                                        .cornerRadius(4)
                                }
                                .chartYAxis {
                                    AxisMarks { value in
                                        AxisGridLine()
                                        AxisValueLabel { if let v = value.as(Int.self) { Text(Money.format(v)) } }
                                    }
                                }
                                .frame(height: 200)
                            }
                        }
                        if !s.byProduct.isEmpty {
                            Card(title: "Plats les plus vendus") {
                                ForEach(s.byProduct.prefix(8)) { p in
                                    HStack {
                                        Text(p.name).lineLimit(1)
                                        Spacer()
                                        Text("\(p.quantity)").foregroundStyle(.secondary).monospacedDigit()
                                        Text(Money.format(p.revenue)).monospacedDigit().frame(minWidth: 90, alignment: .trailing)
                                    }
                                    .font(.subheadline)
                                }
                            }
                        }
                        if let methods = s.byMethod, !methods.isEmpty {
                            Card(title: "Encaissements") {
                                ForEach(methods) { m in
                                    HStack {
                                        Text(PaymentMethodConfig.label(for: m.method))
                                        Spacer()
                                        Text(Money.format(m.amount)).monospacedDigit()
                                    }
                                    .font(.subheadline)
                                }
                            }
                        }
                    }
                    .padding()
                } else if error == nil {
                    ProgressView().padding(.top, 80)
                }
            }
            .overlay(alignment: .top) { ErrorBanner(message: $error) }
            .navigationTitle("Journée")
            .refreshable { await load() }
            .task { await load() }
            .refreshing(every: 60) { await load() }
        }
    }

    private func compare(_ today: Int, _ before: Int) -> String {
        guard before > 0 else { return "" }
        let pct = Int((Double(today - before) / Double(before) * 100).rounded())
        return "\(pct >= 0 ? "+" : "")\(pct) % par rapport à il y a 7 jours"
    }

    private func load() async {
        do { summary = try await app.api.get("/api/reports/daily") } catch { self.error = app.handle(error) }
    }
}

struct Kpi: View {
    let title: String
    let value: String
    let detail: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            Text(value).font(.title2.bold().monospacedDigit()).minimumScaleFactor(0.6).lineLimit(1)
            if let detail, !detail.isEmpty { Text(detail).font(.caption2).foregroundStyle(.secondary).lineLimit(2) }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 16))
    }
}

struct Card<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.headline)
            content
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 16))
    }
}
