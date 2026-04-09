import SwiftUI

@main
struct PaperBridgeApp: App {
    @StateObject private var viewModel = PaperReaderViewModel()

    var body: some Scene {
        WindowGroup("PaperBridge") {
            ContentView(viewModel: viewModel)
                .frame(minWidth: 1220, minHeight: 780)
        }
        .windowStyle(.hiddenTitleBar)
    }
}
