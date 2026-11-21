import XCTest
@testable import ManaResto

final class MoneyTests: XCTestCase {
    func testFormat() {
        XCTAssertEqual(Money.format(0), "0\u{00A0}F")
        XCTAssertEqual(Money.format(950), "950\u{00A0}F")
        XCTAssertEqual(Money.format(13800), "13\u{202F}800\u{00A0}F")
        XCTAssertEqual(Money.format(1_250_000), "1\u{202F}250\u{202F}000\u{00A0}F")
        XCTAssertEqual(Money.format(-500), "−500\u{00A0}F")
    }

    func testCashSuggestions() {
        XCTAssertEqual(Money.cashSuggestions(for: 13800), [13800, 14000, 15000, 20000])
        XCTAssertEqual(Money.cashSuggestions(for: 5000), [5000, 10000])
        XCTAssertEqual(Money.cashSuggestions(for: 0), [])
    }

    func testElapsed() {
        let start = Date(timeIntervalSince1970: 0)
        XCTAssertEqual(Elapsed.short(since: start, now: start.addingTimeInterval(12 * 60)), "12 min")
        XCTAssertEqual(Elapsed.short(since: start, now: start.addingTimeInterval(65 * 60)), "1 h 05")
    }
}

final class ModifierSelectionTests: XCTestCase {
    private func group(_ id: String, min: Int, max: Int?, defaults: [String] = [], prices: [Int] = [0, 0, 0]) -> ModifierGroup {
        ModifierGroup(id: id, name: id, minSelect: min, maxSelect: max, isActive: true, modifiers: prices.enumerated().map { i, p in
            Modifier(id: "\(id)\(i)", name: "\(id)\(i)", priceDelta: p, isDefault: defaults.contains("\(id)\(i)"), isAvailable: true)
        })
    }

    func testDefaultsAndRequiredGroup() {
        let cuisson = group("c", min: 1, max: 1, defaults: ["c2"])
        let accomp = group("a", min: 1, max: 1)
        var sel = ModifierSelection(groups: [cuisson, accomp])
        XCTAssertTrue(sel.isSelected(cuisson.modifiers[2], in: cuisson))
        XCTAssertEqual(sel.missing(in: [cuisson, accomp]).map(\.id), ["a"])
        sel.toggle(accomp.modifiers[0], in: accomp)
        XCTAssertTrue(sel.isComplete(for: [cuisson, accomp]))
        // Choix unique : un autre choix remplace le précédent, et un groupe obligatoire ne se vide pas
        sel.toggle(cuisson.modifiers[0], in: cuisson)
        sel.toggle(cuisson.modifiers[0], in: cuisson)
        XCTAssertEqual(sel.payload(for: [cuisson]), [ModifierChoice(modifierId: "c0")])
    }

    func testMultipleWithMaxAndPrice() {
        let supp = group("s", min: 0, max: 2, prices: [250, 150, 100])
        var sel = ModifierSelection(groups: [supp])
        for m in supp.modifiers { sel.toggle(m, in: supp) }
        XCTAssertEqual(sel.payload(for: [supp]).map(\.modifierId), ["s0", "s1"]) // maximum 2
        XCTAssertEqual(sel.extra(in: [supp]), 400)
        sel.toggle(supp.modifiers[0], in: supp)
        XCTAssertEqual(sel.extra(in: [supp]), 150)
    }

    func testOptionalSingleChoiceCanBeCleared() {
        let sauce = group("x", min: 0, max: 1)
        var sel = ModifierSelection(groups: [sauce])
        sel.toggle(sauce.modifiers[1], in: sauce)
        sel.toggle(sauce.modifiers[1], in: sauce)
        XCTAssertTrue(sel.payload(for: [sauce]).isEmpty)
    }
}

final class PushTests: XCTestCase {
    func testTokenHex() {
        XCTAssertEqual(PushManager.hex(Data([0x00, 0x0f, 0xab, 0xff])), "000fabff")
        XCTAssertEqual(PushManager.hex(Data(repeating: 0x1a, count: 32)).count, 64)
    }

    func testOrderFromNotification() {
        // Charge utile envoyée par le serveur ManaResto pour un plat prêt
        let userInfo: [AnyHashable: Any] = ["aps": ["alert": ["title": "Plat prêt · Table T01", "body": "Burger — à apporter"], "sound": "default"], "url": "/pos/order/abc", "orderId": "abc"]
        XCTAssertEqual(PushManager.orderId(from: userInfo), "abc")
        XCTAssertNil(PushManager.orderId(from: ["aps": [:]]))
        XCTAssertNil(PushManager.orderId(from: ["orderId": ""]))
    }

    func testEnvironmentForDebugBuildIsSandbox() {
        // Les tests tournent en Debug : jeton de développement (sandbox)
        XCTAssertEqual(PushManager.environment, "sandbox")
    }

    func testServerPolicy() {
        XCTAssertTrue(ServerPolicy.isAllowed(URL(string: "https://app.manaresto.com")!))
        XCTAssertTrue(ServerPolicy.isAllowed(URL(string: "https://caisse.monresto.pf")!))
        XCTAssertTrue(ServerPolicy.isAllowed(URL(string: "http://192.168.1.20:3000")!))
        XCTAssertTrue(ServerPolicy.isAllowed(URL(string: "http://boitier.local")!))
        XCTAssertFalse(ServerPolicy.isAllowed(URL(string: "http://app.manaresto.com")!))
        XCTAssertFalse(ServerPolicy.isAllowed(URL(string: "http://8.8.8.8")!))
        XCTAssertFalse(ServerPolicy.isAllowed(URL(string: "ftp://192.168.1.20")!))
        XCTAssertFalse(ServerPolicy.isAllowed(URL(string: "https://user:pw@exemple.com")!))
        XCTAssertTrue(ServerPolicy.isOfficial(URL(string: "https://app.manaresto.com")!))
        XCTAssertFalse(ServerPolicy.isOfficial(URL(string: "https://manaresto-support.com")!))
        XCTAssertFalse(ServerPolicy.isOfficial(URL(string: "https://app.manaresto.com.evil.io")!))
    }
}
