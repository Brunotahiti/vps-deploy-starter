import XCTest
@testable import ManaResto

/// L'app sait lire chaque réponse réelle de l'API (profil, salle, carte, commande, cuisine, journée).
final class DecodingTests: XCTestCase {
    func testMe() throws {
        let me = try Fixture.decode(Me.self, "me")
        XCTAssertEqual(me.user?.firstName, "Teiva")
        XCTAssertEqual(me.establishment?.name, "Le Mana Beach")
        XCTAssertTrue(me.can("pos.use")) // propriétaire : « * »
        XCTAssertTrue(me.hasOption("team"))
    }

    func testAnonymousMe() throws {
        let me = try Fixture.decode(Me.self, "me-anonymous")
        XCTAssertNil(me.user)
        XCTAssertNil(me.terminal)
        XCTAssertFalse(me.can("pos.use"))
    }

    func testFloor() throws {
        let floor = try Fixture.decode(Floor.self, "floor")
        XCTAssertEqual(floor.rooms.map(\.name), ["Salle", "Terrasse"])
        let tables = floor.rooms.flatMap(\.tables)
        XCTAssertFalse(tables.isEmpty)
        XCTAssertTrue(tables.contains { $0.order != nil }, "une table occupée avec sa commande")
        XCTAssertTrue(tables.contains { $0.status == "FREE" && $0.order == nil })
    }

    func testCatalog() throws {
        let catalog = try Fixture.decode(Catalog.self, "catalog")
        XCTAssertFalse(catalog.categories.isEmpty)
        let burger = try XCTUnwrap(catalog.products.first { !$0.modifierGroups.isEmpty })
        XCTAssertTrue(burger.needsOptions)
        XCTAssertTrue(burger.activeGroups.contains { $0.minSelect == 1 && $0.maxSelect == 1 })
        XCTAssertTrue(catalog.products.contains { !$0.needsOptions })
        let formula = try XCTUnwrap(catalog.menus.first)
        XCTAssertFalse(formula.sections.isEmpty)
        XCTAssertNotNil(formula.sections.first?.items.first?.product?.name)
        XCTAssertTrue(catalog.paymentMethods.contains { $0.method == "CASH" && $0.isEnabled })
    }

    func testOrder() throws {
        let order = try Fixture.decode(Order.self, "order")
        XCTAssertEqual(order.status, "OPEN")
        XCTAssertEqual(order.title, "Table T01")
        XCTAssertEqual(order.shortNumber, "54")
        XCTAssertEqual(order.due, order.total - order.paidTotal)
        XCTAssertFalse(order.lines.isEmpty)
        XCTAssertEqual(order.pendingCount, order.lines.filter(\.isPending).count)
        XCTAssertEqual(order.lines.first?.modifiers?.first?.name, "Frites")
    }

    func testKitchen() throws {
        let tickets = try Fixture.decode([KitchenTicket].self, "kitchen")
        let t = try XCTUnwrap(tickets.first)
        XCTAssertEqual(t.title, "Table T17")
        XCTAssertEqual(t.nextStep, KitchenStep(status: "DONE", label: "Servi"))
        XCTAssertFalse(t.items.isEmpty)
    }

    func testDaily() throws {
        let s = try Fixture.decode(DailySummary.self, "daily")
        XCTAssertGreaterThan(s.revenue, 0)
        XCTAssertFalse(s.byHour.isEmpty)
        XCTAssertEqual(s.previous?.day, "2026-11-07")
    }

    func testServerError() throws {
        XCTAssertThrowsError(try Fixture.decode(Order.self, "error", status: 400)) { error in
            XCTAssertEqual(error as? APIError, APIError(code: "INSUFFICIENT_CASH", message: "Espèces reçues insuffisantes", status: 400))
        }
    }
}
