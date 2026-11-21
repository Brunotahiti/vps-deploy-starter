import Foundation

/// Serveurs acceptés dans « Avancé » : https partout ; http seulement pour un boîtier sur le réseau du restaurant
/// (adresse privée ou nom en .local), pour qu'un mot de passe ne parte jamais en clair sur internet.
enum ServerPolicy {
    static func isAllowed(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased(), !host.isEmpty else { return false }
        if url.user != nil || url.password != nil { return false }
        if scheme == "https" { return true }
        guard scheme == "http" else { return false }
        return host.hasSuffix(".local") || isPrivateIPv4(host)
    }

    /// Serveur ManaResto officiel : sinon l'écran de connexion affiche l'adresse utilisée (contre l'hameçonnage).
    static func isOfficial(_ url: URL) -> Bool {
        let host = url.host?.lowercased() ?? ""
        return host == "manaresto.com" || host.hasSuffix(".manaresto.com")
    }

    static func isPrivateIPv4(_ host: String) -> Bool {
        let parts = host.split(separator: ".", omittingEmptySubsequences: false).map { Int($0) }
        guard parts.count == 4, parts.allSatisfy({ ($0 ?? -1) >= 0 && ($0 ?? 256) <= 255 }) else { return false }
        let p = parts.map { $0! }
        return p[0] == 10 || (p[0] == 172 && (16...31).contains(p[1])) || (p[0] == 192 && p[1] == 168)
    }
}
