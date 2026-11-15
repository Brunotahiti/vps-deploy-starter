import SwiftUI
import WebKit

/// Pages du site ManaResto ouvertes dans l'app, avec la même session (pas de reconnexion).
struct WebScreen: View {
    let path: String
    let title: String
    @State private var reloadToken = 0
    @State private var loading = true

    var body: some View {
        WebView(path: path, reloadToken: reloadToken, loading: $loading)
            .ignoresSafeArea(edges: .bottom)
            .overlay { if loading { ProgressView() } }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                Button { reloadToken += 1 } label: { Image(systemName: "arrow.clockwise") }
                    .accessibilityLabel("Recharger")
            }
    }
}

struct WebView: UIViewRepresentable {
    let path: String
    let reloadToken: Int
    @Binding var loading: Bool

    func makeCoordinator() -> Coordinator { Coordinator(loading: $loading) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        // Le site sait qu'il est affiché dans l'app (pour adapter l'affichage si besoin)
        config.applicationNameForUserAgent = "ManaRestoApp/\(Bundle.main.appVersion)"
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = context.coordinator
        web.allowsBackForwardNavigationGestures = true
        context.coordinator.lastToken = reloadToken
        Task { @MainActor in
            await APIClient.shared.shareCookies(with: config.websiteDataStore.httpCookieStore)
            if let url = APIClient.shared.url(path) { web.load(URLRequest(url: url)) }
        }
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {
        if context.coordinator.lastToken != reloadToken {
            context.coordinator.lastToken = reloadToken
            web.reload()
        }
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate {
        var lastToken = 0
        private let loading: Binding<Bool>

        init(loading: Binding<Bool>) { self.loading = loading }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { loading.wrappedValue = true }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loading.wrappedValue = false }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { loading.wrappedValue = false }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { loading.wrappedValue = false }

        /// Les liens vers d'autres sites (WhatsApp, Google, paiement…), le téléphone et l'e-mail s'ouvrent hors de l'app.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard let url = action.request.url else { return .allow }
            if url.scheme == "mailto" || url.scheme == "tel" || url.scheme == "sms" {
                _ = await UIApplication.shared.open(url)
                return .cancel
            }
            let ours = APIClient.shared.baseURL.host()
            if url.scheme?.hasPrefix("http") == true, url.host() != ours, action.navigationType == .linkActivated {
                _ = await UIApplication.shared.open(url)
                return .cancel
            }
            return .allow
        }
    }
}
