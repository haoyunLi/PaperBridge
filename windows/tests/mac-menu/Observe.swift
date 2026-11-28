import AppKit
import ApplicationServices

@main
struct InspectMenu {
    @MainActor
    static func main() throws {
        let arguments = CommandLine.arguments
        guard arguments.count == 3 else { throw failure("Expected an app bundle and a JSON destination.") }
        let url = URL(fileURLWithPath: arguments[1]).standardizedFileURL
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.createsNewApplicationInstance = true
        configuration.arguments = ["-AppleLanguages", "(en)", "-SUEnableAutomaticChecks", "NO"]
        var launched: Result<NSRunningApplication, Error>?
        NSWorkspace.shared.openApplication(at: url, configuration: configuration) { app, error in
            if let app { launched = .success(app) }
            else { launched = .failure(error ?? failure("The public Mac application failed to open.")) }
        }
        let deadline = Date().addingTimeInterval(30)
        while launched == nil && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
        guard let launched else { throw failure("The app launch timed out.") }
        let app = try launched.get()
        defer { app.terminate() }
        let target = AXUIElementCreateApplication(app.processIdentifier)
        let trusted = AXIsProcessTrusted()
        print("Opened \(url.lastPathComponent). Accessibility permission: \(trusted)")
        guard trusted else { throw failure("The hosted process lacks accessibility permission to inspect the public menu.") }

        func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
            var result: CFTypeRef?
            return AXUIElementCopyAttributeValue(element, name as CFString, &result) == .success ? result : nil
        }
        func children(_ element: AXUIElement) -> [AXUIElement] {
            attribute(element, "AXChildren") as? [AXUIElement] ?? []
        }
        var menus: [String: [[String: Any]]] = [:]
        repeat {
            if let value = attribute(target, "AXMenuBar"), CFGetTypeID(value) == AXUIElementGetTypeID() {
                let bar = value as! AXUIElement
                for item in children(bar) {
                    guard let title = attribute(item, "AXTitle") as? String, !title.isEmpty,
                          let submenu = children(item).first else { continue }
                    menus[title] = children(submenu).compactMap { child in
                        guard let name = attribute(child, "AXTitle") as? String, !name.isEmpty else { return nil }
                        return ["title": name, "key": attribute(child, "AXMenuItemCmdChar") as? String ?? "",
                                "modifiers": attribute(child, "AXMenuItemCmdModifiers") as? Int ?? 0]
                    }
                }
            }
            if !menus["Selection", default: []].isEmpty && !menus["Edit", default: []].isEmpty { break }
            RunLoop.main.run(until: Date().addingTimeInterval(0.1))
        } while Date() < deadline
        guard menus["Edit"]?.contains(where: { $0["title"] as? String == "Paste" }) == true,
              menus["Selection"]?.contains(where: { $0["title"] as? String == "Explain Selection" }) == true
        else { throw failure("Could not read the Edit and Selection commands in the opened application: \(menus.keys.sorted()).") }
        let data = try JSONSerialization.data(withJSONObject: menus, options: [.sortedKeys])
        try data.write(to: URL(fileURLWithPath: arguments[2]))
        print("Observed native menus: \(menus.keys.sorted())")
    }

    static func failure(_ message: String) -> NSError {
        NSError(domain: "MacMenuReference", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
