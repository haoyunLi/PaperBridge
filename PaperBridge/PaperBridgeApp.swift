import SwiftUI

@main
struct PaperBridgeApp: App {
    @StateObject private var viewModel = PaperReaderViewModel()

    var body: some Scene {
        WindowGroup("PaperBridge") {
            ContentView(viewModel: viewModel)
                .frame(minWidth: 900, minHeight: 560)
        }
        .defaultSize(width: 1080, height: 700)
        .windowResizability(.contentMinSize)
        .windowStyle(.hiddenTitleBar)
    }
}
