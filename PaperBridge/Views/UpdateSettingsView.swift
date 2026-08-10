import SwiftUI

struct UpdateSettingsView: View {
    @ObservedObject var updateController: AppUpdateController
    @State private var automaticallyChecksForUpdates: Bool
    @State private var automaticallyDownloadsUpdates: Bool

    init(updateController: AppUpdateController) {
        self.updateController = updateController
        _automaticallyChecksForUpdates = State(
            initialValue: updateController.updater.automaticallyChecksForUpdates
        )
        _automaticallyDownloadsUpdates = State(
            initialValue: updateController.updater.automaticallyDownloadsUpdates
        )
    }

    var body: some View {
        Form {
            Section("PaperBridge") {
                HStack(alignment: .center, spacing: 14) {
                    AppIconBadge(size: 48)

                    VStack(alignment: .leading, spacing: 4) {
                        Text(updateController.currentVersion)
                            .font(.headline)
                        Text("Stable release channel")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Spacer()

                    Button {
                        updateController.checkForUpdates()
                    } label: {
                        Label("Check Now", systemImage: "arrow.triangle.2.circlepath")
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!updateController.canCheckForUpdates)
                }
            }

            Section("Automatic Updates") {
                Toggle(
                    "Automatically check for updates",
                    isOn: $automaticallyChecksForUpdates
                )
                .onChange(of: automaticallyChecksForUpdates) { _, newValue in
                    updateController.updater.automaticallyChecksForUpdates = newValue
                }

                Toggle(
                    "Download updates automatically",
                    isOn: $automaticallyDownloadsUpdates
                )
                .disabled(!automaticallyChecksForUpdates)
                .onChange(of: automaticallyDownloadsUpdates) { _, newValue in
                    updateController.updater.automaticallyDownloadsUpdates = newValue
                }

                Text("PaperBridge checks at most once per day. Downloaded updates are installed securely by Sparkle and the app restarts when installation completes.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Section("Update Security") {
                Label {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Signed, notarized, and verified")
                            .fontWeight(.medium)
                        Text("Updates come from the official PaperBridge GitHub Release feed and must pass Developer ID, Apple notarization, and EdDSA signature checks before installation.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                } icon: {
                    Image(systemName: "checkmark.shield.fill")
                        .foregroundStyle(PaperBridgeTheme.success)
                }

                Link(
                    "View release history",
                    destination: URL(
                        string: "https://github.com/haoyunLi/PaperBridge/releases"
                    )!
                )
            }
        }
        .formStyle(.grouped)
        .onAppear {
            automaticallyChecksForUpdates = updateController.updater.automaticallyChecksForUpdates
            automaticallyDownloadsUpdates = updateController.updater.automaticallyDownloadsUpdates
        }
    }
}
