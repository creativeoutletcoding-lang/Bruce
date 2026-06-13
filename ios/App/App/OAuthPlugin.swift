import Foundation
import Capacitor
import AuthenticationServices

@objc(OAuthPlugin)
public class OAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    // CAPBridgedPlugin conformance — Capacitor 8's runtime registers plugins from
    // this metadata (built-ins + capacitor.config.json packageClassList + explicit
    // registerPluginInstance). The legacy CAP_PLUGIN ObjC macro is no longer scanned.
    public let identifier = "OAuthPlugin"
    public let jsName = "OAuthPlugin"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "openForCallback", returnType: CAPPluginReturnPromise)
    ]

    private var authSession: ASWebAuthenticationSession?

    @objc func openForCallback(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"),
              let url = URL(string: urlString) else {
            call.reject("Invalid URL")
            return
        }
        NSLog("OAuthPlugin: openForCallback called with url: %@", urlString)

        DispatchQueue.main.async {
            if #available(iOS 17.4, *) {
                let callback = ASWebAuthenticationSession.Callback.https(
                    host: "heybruce.app",
                    path: "/auth/native-callback"
                )
                self.authSession = ASWebAuthenticationSession(
                    url: url,
                    callback: callback
                ) { callbackURL, error in
                    if let error = error as? ASWebAuthenticationSessionError,
                       error.code == .canceledLogin {
                        call.reject("User cancelled")
                        return
                    }
                    if let error = error {
                        call.reject("Auth failed: \(error.localizedDescription)")
                        return
                    }
                    guard let callbackURL = callbackURL else {
                        call.reject("No callback URL received")
                        return
                    }
                    call.resolve(["callbackUrl": callbackURL.absoluteString])
                }
            } else {
                call.reject("iOS 17.4+ required for native OAuth")
                return
            }
            self.authSession?.presentationContextProvider = self
            self.authSession?.prefersEphemeralWebBrowserSession = true
            self.authSession?.start()
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return self.bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }
}
