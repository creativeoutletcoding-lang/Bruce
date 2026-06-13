import UIKit
import Capacitor

/// Bridge view controller subclass used to register app-target (local) plugins.
///
/// Capacitor 8's auto-registration only loads built-in plugins plus the classes
/// listed in capacitor.config.json's `packageClassList`, which the CLI regenerates
/// from installed npm plugins on every `cap sync` — app-target plugins are never
/// scanned, and the legacy CAP_PLUGIN ObjC-runtime discovery was removed. The
/// official, sync-proof hook is `capacitorDidLoad()`, called right after the bridge
/// is created. `registerPluginInstance` registers regardless of autoRegisterPlugins.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(OAuthPlugin())
    }
}
