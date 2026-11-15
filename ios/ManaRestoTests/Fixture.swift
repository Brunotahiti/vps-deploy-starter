import Foundation
@testable import ManaResto

/// Réponses réelles du serveur ManaResto (restaurant de démonstration), enregistrées dans Fixtures/.
enum Fixture {
    static func data(_ name: String) throws -> Data {
        let bundle = Bundle(for: BundleToken.self)
        let url = bundle.url(forResource: name, withExtension: "json", subdirectory: "Fixtures") ?? bundle.url(forResource: name, withExtension: "json")
        guard let url else { throw NSError(domain: "Fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "Fixture \(name).json introuvable"]) }
        return try Data(contentsOf: url)
    }

    static func decode<T: Decodable>(_ type: T.Type, _ name: String, status: Int = 200) throws -> T {
        try APIClient(session: .shared).decode(try data(name), status: status)
    }
}

private final class BundleToken {}
