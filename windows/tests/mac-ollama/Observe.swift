import Foundation

@main
struct ObserveOllama {
    static func main() async throws {
        let root = CommandLine.arguments[1]
        let client = OllamaClient()
        let model = "reader:4b"
        var observations: [String: Any] = [:]
        observations["models"] = try await client.listModels(baseURL: root + "/inventory")
        for scenario in ["success", "installed", "missing"] {
            do {
                try await client.pullModel(baseURL: root + "/" + scenario, model: model, progress: { _ in })
                observations[scenario] = true
            } catch OllamaClientError.modelUnavailable {
                observations[scenario] = false
            }
        }
        do {
            _ = try await client.listModels(baseURL: root + "/invalid")
            observations["invalidRejected"] = false
        } catch OllamaClientError.invalidResponse {
            observations["invalidRejected"] = true
        }
        FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: observations))
    }
}
