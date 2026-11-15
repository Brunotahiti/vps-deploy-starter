import SwiftUI

/// Montants en F CFP, sans décimales : 13800 → « 13 800 F ».
enum Money {
    static func format(_ amount: Int) -> String {
        var digits = String(amount.magnitude)
        var groups: [String] = []
        while digits.count > 3 {
            groups.insert(String(digits.suffix(3)), at: 0)
            digits.removeLast(3)
        }
        groups.insert(digits, at: 0)
        return (amount < 0 ? "−" : "") + groups.joined(separator: "\u{202F}") + "\u{00A0}F"
    }

    /// Billets proposés pour un paiement en espèces : le compte juste puis les montants ronds au-dessus.
    static func cashSuggestions(for due: Int) -> [Int] {
        guard due > 0 else { return [] }
        var out = [due]
        for step in [500, 1000, 5000, 10000] {
            let rounded = ((due + step - 1) / step) * step
            if rounded > due, !out.contains(rounded) { out.append(rounded) }
        }
        return Array(out.prefix(4))
    }
}

enum Elapsed {
    /// « 12 min », « 1 h 05 »
    static func short(since date: Date, now: Date = .now) -> String {
        let minutes = max(0, Int(now.timeIntervalSince(date) / 60))
        if minutes < 60 { return "\(minutes) min" }
        return "\(minutes / 60) h \(String(format: "%02d", minutes % 60))"
    }

    static func hours(fromMs ms: Double) -> String {
        let minutes = Int(ms / 60_000)
        return "\(minutes / 60) h \(String(format: "%02d", minutes % 60))"
    }
}

extension Color {
    /// Couleur « #0EA5A4 » venant du serveur.
    init(hex: String?, fallback: Color = .accentColor) {
        guard let hex, hex.hasPrefix("#"), hex.count == 7, let v = UInt32(hex.dropFirst(), radix: 16) else {
            self = fallback
            return
        }
        self = Color(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }

    static let lagon = Color("Lagon")
}
