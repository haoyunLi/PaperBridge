import Combine
import Foundation
import Sparkle

@MainActor
final class AppUpdateController: ObservableObject {
    let updaterController: SPUStandardUpdaterController

    @Published private(set) var canCheckForUpdates = false
    private var canCheckSubscription: AnyCancellable?

    init() {
        updaterController = SPUStandardUpdaterController(
            startingUpdater: true,
            updaterDelegate: nil,
            userDriverDelegate: nil
        )

        canCheckSubscription = updater.publisher(for: \.canCheckForUpdates)
            .receive(on: RunLoop.main)
            .sink { [weak self] canCheck in
                self?.canCheckForUpdates = canCheck
            }
    }

    var updater: SPUUpdater {
        updaterController.updater
    }

    var currentVersion: String {
        let shortVersion = Bundle.main.object(
            forInfoDictionaryKey: "CFBundleShortVersionString"
        ) as? String ?? "Unknown"
        let build = Bundle.main.object(
            forInfoDictionaryKey: "CFBundleVersion"
        ) as? String ?? "Unknown"
        return "Version \(shortVersion) (\(build))"
    }

    func checkForUpdates() {
        updater.checkForUpdates()
    }
}
