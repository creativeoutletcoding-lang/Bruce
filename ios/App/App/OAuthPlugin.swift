import Foundation
import Capacitor
import AuthenticationServices

@objc(OAuthPlugin)
public class OAuthPlugin: CAPPlugin, ASWebAuthenticationPresentationContextProviding {
    private var authSession: ASWebAuthenticationSession?

    @objc func openForCallback(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"),
              let url = URL(string: urlString) else {
            call.reject("Invalid URL")
            return
        }

        DispatchQueue.main.async {
            if #available(iOS 17.4, *) {
                let callback = ASWebAuthenticationSessionCallback.https(
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
            self.authSession?.prefersEphemeralWebBrowserSession = false
            self.authSession?.start()
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return self.bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }
}
