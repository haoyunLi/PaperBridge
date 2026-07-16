import Foundation

enum OllamaClientError: LocalizedError {
    case invalidBaseURL(String)
    case nonLocalBaseURL(String)
    case unreachable(String)
    case invalidResponse
    case httpError(String)
    case emptyResponse
    case noLocalModels
    case modelUnavailable(String)

    var errorDescription: String? {
        switch self {
        case .invalidBaseURL(let baseURL):
            return "The Ollama base URL is invalid: \(baseURL)"
        case .nonLocalBaseURL(let baseURL):
            return "PaperBridge only connects to Ollama on this Mac. Use localhost, 127.0.0.1, or ::1 instead of \(baseURL)."
        case .unreachable(let baseURL):
            return "Could not reach Ollama at \(baseURL). Make sure Ollama is running locally and the API is available."
        case .invalidResponse:
            return "Ollama returned an invalid or non-JSON response."
        case .httpError(let details):
            return "Ollama request failed: \(details)"
        case .emptyResponse:
            return "Ollama returned an empty response."
        case .noLocalModels:
            return "Ollama is reachable, but no local models were found."
        case .modelUnavailable(let model):
            return "Model '\(model)' is not available in Ollama. Pull it first with `ollama pull \(model)`."
        }
    }
}

private struct OllamaTagsResponse: Decodable {
    let models: [OllamaModelDescriptor]
}

private struct OllamaModelDescriptor: Decodable {
    let model: String?
    let name: String?
}

private struct OllamaGenerateRequest: Encodable {
    struct Options: Encodable {
        let temperature: Double
    }

    let model: String
    let prompt: String
    let stream: Bool
    let system: String?
    let options: Options
}

private struct OllamaGenerateResponse: Decodable {
    let response: String?
    let error: String?
}

final class OllamaClient {
    private let session: URLSession

    init() {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 600
        configuration.timeoutIntervalForResource = 600
        self.session = URLSession(configuration: configuration)
    }

    func listModels(baseURL: String) async throws -> [String] {
        let endpoint = try makeURL(baseURL: baseURL, path: "api/tags")
        var request = URLRequest(url: endpoint)
        request.httpMethod = "GET"

        let (data, response) = try await perform(request, baseURL: baseURL)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw OllamaClientError.invalidResponse
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            throw OllamaClientError.httpError(String(data: data, encoding: .utf8) ?? "HTTP \(httpResponse.statusCode)")
        }

        let payload = try decode(OllamaTagsResponse.self, from: data)
        let models = payload.models.compactMap { $0.model ?? $0.name }
        return Array(Set(models)).sorted()
    }

    func ensureModelAvailable(baseURL: String, model: String) async throws {
        let models = try await listModels(baseURL: baseURL)
        guard !models.isEmpty else {
            throw OllamaClientError.noLocalModels
        }
        guard models.contains(model) else {
            throw OllamaClientError.modelUnavailable(model)
        }
    }

    func generate(baseURL: String, model: String, prompt: String, systemPrompt: String?) async throws -> String {
        let endpoint = try makeURL(baseURL: baseURL, path: "api/generate")
        let payload = OllamaGenerateRequest(
            model: model,
            prompt: prompt,
            stream: false,
            system: systemPrompt,
            options: .init(temperature: 0.1)
        )

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(payload)

        let (data, response) = try await perform(request, baseURL: baseURL)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw OllamaClientError.invalidResponse
        }

        if !(200..<300).contains(httpResponse.statusCode) {
            let decoded = try? JSONDecoder().decode(OllamaGenerateResponse.self, from: data)
            throw OllamaClientError.httpError(
                decoded?.error ?? String(data: data, encoding: .utf8) ?? "HTTP \(httpResponse.statusCode)"
            )
        }

        let decoded = try decode(OllamaGenerateResponse.self, from: data)
        if let error = decoded.error, !error.isEmpty {
            throw OllamaClientError.httpError(error)
        }

        guard let text = decoded.response?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
            throw OllamaClientError.emptyResponse
        }

        return text
    }

    private func makeURL(baseURL: String, path: String) throws -> URL {
        let trimmed = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = url.host?.lowercased() else {
            throw OllamaClientError.invalidBaseURL(baseURL)
        }

        let localHosts = ["localhost", "127.0.0.1", "::1"]
        guard localHosts.contains(host) || host.hasSuffix(".localhost") else {
            throw OllamaClientError.nonLocalBaseURL(baseURL)
        }

        return url.appending(path: path)
    }

    private func perform(_ request: URLRequest, baseURL: String) async throws -> (Data, URLResponse) {
        do {
            return try await session.data(for: request)
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        } catch {
            throw OllamaClientError.unreachable(baseURL)
        }
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw OllamaClientError.invalidResponse
        }
    }
}
