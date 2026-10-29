import Foundation

enum OpenAIClientError: LocalizedError, Equatable {
    case invalidAPIKey
    case invalidRequest
    case authenticationFailed
    case permissionDenied
    case rateLimited
    case serverError
    case httpError(Int)
    case redirectRejected
    case networkError
    case invalidResponse
    case malformedResponse
    case incompleteResponse
    case failedResponse
    case refusedResponse
    case emptyResponse

    var errorDescription: String? {
        switch self {
        case .invalidAPIKey:
            return "Enter a valid OpenAI API key in Settings."
        case .invalidRequest:
            return "The OpenAI request could not be prepared."
        case .authenticationFailed:
            return "OpenAI could not authenticate the API key. Check or replace it in Settings."
        case .permissionDenied:
            return "OpenAI denied access. Check the API key's project permissions and model access."
        case .rateLimited:
            return "OpenAI's rate or usage limit was reached. Check your API quota and billing, or try again later."
        case .serverError:
            return "OpenAI is temporarily unavailable. Try again later."
        case .httpError(let status):
            return "OpenAI rejected the request (HTTP \(status)). Check the selected model and request settings."
        case .redirectRejected:
            return "OpenAI returned a redirect. It was blocked to protect your API key."
        case .networkError:
            return "Could not connect to OpenAI. Check your internet connection and try again."
        case .invalidResponse:
            return "OpenAI returned an unexpected network response."
        case .malformedResponse:
            return "OpenAI returned malformed or unexpected JSON."
        case .incompleteResponse:
            return "OpenAI did not finish the response. No partial result was used. Try a shorter request."
        case .failedResponse:
            return "OpenAI could not complete the response. No partial result was used."
        case .refusedResponse:
            return "OpenAI declined this request. No partial result was used."
        case .emptyResponse:
            return "OpenAI returned no text."
        }
    }
}

private struct OpenAIModelsResponse: Decodable {
    struct Model: Decodable {
        let id: String
    }

    let data: [Model]
}

private struct OpenAIGenerateRequest: Encodable {
    let model: String
    let input: String
    let instructions: String?
    let store = false
    let stream = false
    let max_output_tokens = 8192
}

private final class OpenAIRedirectBlocker: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

final class OpenAIClient: Sendable {
    private let session: URLSession

    init(session: URLSession? = nil) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.urlCredentialStorage = nil
        configuration.timeoutIntervalForRequest = 600
        configuration.timeoutIntervalForResource = 600
        // Injection supplies transport mocks only; it cannot weaken credential isolation.
        if let session {
            configuration.protocolClasses = session.configuration.protocolClasses
        }
        self.session = URLSession(
            configuration: configuration,
            delegate: OpenAIRedirectBlocker(),
            delegateQueue: nil
        )
    }

    deinit {
        session.invalidateAndCancel()
    }

    func listModels(apiKey: String) async throws -> [String] {
        let request = try makeRequest(path: "models", method: "GET", apiKey: apiKey)
        let data = try await perform(request)
        let payload: OpenAIModelsResponse
        do {
            payload = try JSONDecoder().decode(OpenAIModelsResponse.self, from: data)
        } catch {
            throw OpenAIClientError.malformedResponse
        }
        try Task.checkCancellation()
        // Listing an ID does not establish that it supports the Responses API.
        return payload.data.map(\.id).sorted()
    }

    func generate(apiKey: String, model: String, prompt: String, systemPrompt: String?) async throws -> String {
        var request = try makeRequest(path: "responses", method: "POST", apiKey: apiKey)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        do {
            request.httpBody = try JSONEncoder().encode(OpenAIGenerateRequest(
                model: model,
                input: prompt,
                instructions: systemPrompt
            ))
        } catch {
            throw OpenAIClientError.invalidRequest
        }
        let data = try await perform(request)
        let text = try responseText(from: data)
        try Task.checkCancellation()
        return text
    }

    private func makeRequest(path: String, method: String, apiKey: String) throws -> URLRequest {
        try Task.checkCancellation()
        let key = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty, key.unicodeScalars.allSatisfy({ (0x21...0x7E).contains($0.value) }) else {
            throw OpenAIClientError.invalidAPIKey
        }
        let url = URL(string: "https://api.openai.com/v1/" + path)!
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        request.httpMethod = method
        request.httpShouldHandleCookies = false
        request.setValue("Bearer " + key, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }

    private func perform(_ request: URLRequest) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            if error is CancellationError || (error as? URLError)?.code == .cancelled || Task.isCancelled {
                throw CancellationError()
            }
            // Transport errors can contain URLs, headers, or payloads. Do not expose them.
            throw OpenAIClientError.networkError
        }
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse, http.url == request.url else {
            throw OpenAIClientError.invalidResponse
        }
        switch http.statusCode {
        case 200..<300:
            return data
        case 300..<400:
            throw OpenAIClientError.redirectRejected
        case 401:
            throw OpenAIClientError.authenticationFailed
        case 403:
            throw OpenAIClientError.permissionDenied
        case 429:
            throw OpenAIClientError.rateLimited
        case 500..<600:
            throw OpenAIClientError.serverError
        default:
            throw OpenAIClientError.httpError(http.statusCode)
        }
    }

    private func responseText(from data: Data) throws -> String {
        let object: Any
        do {
            object = try JSONSerialization.jsonObject(with: data)
        } catch {
            throw OpenAIClientError.malformedResponse
        }
        guard let response = object as? [String: Any], let status = response["status"] as? String else {
            throw OpenAIClientError.malformedResponse
        }
        switch status {
        case "cancelled":
            throw CancellationError()
        case "failed":
            throw OpenAIClientError.failedResponse
        case "incomplete", "in_progress", "queued":
            throw OpenAIClientError.incompleteResponse
        case "completed":
            break
        default:
            throw OpenAIClientError.malformedResponse
        }
        if let error = response["error"], !(error is NSNull) {
            throw OpenAIClientError.failedResponse
        }
        if let details = response["incomplete_details"], !(details is NSNull) {
            throw OpenAIClientError.incompleteResponse
        }
        guard let output = response["output"] as? [[String: Any]] else {
            throw OpenAIClientError.malformedResponse
        }
        var fragments: [String] = []
        for item in output {
            guard let type = item["type"] as? String else {
                throw OpenAIClientError.malformedResponse
            }
            // Never decode reasoning, tool output, or top-level convenience text as an answer.
            guard type == "message" else { continue }
            guard item["role"] as? String == "assistant" else {
                throw OpenAIClientError.malformedResponse
            }
            if let messageStatus = item["status"] {
                guard let messageStatus = messageStatus as? String else {
                    throw OpenAIClientError.malformedResponse
                }
                switch messageStatus {
                case "completed": break
                case "incomplete", "in_progress": throw OpenAIClientError.incompleteResponse
                default: throw OpenAIClientError.malformedResponse
                }
            }
            guard let content = item["content"] as? [[String: Any]] else {
                throw OpenAIClientError.malformedResponse
            }
            for part in content {
                guard let contentType = part["type"] as? String else {
                    throw OpenAIClientError.malformedResponse
                }
                switch contentType {
                case "refusal":
                    throw OpenAIClientError.refusedResponse
                case "output_text":
                    guard let text = part["text"] as? String else {
                        throw OpenAIClientError.malformedResponse
                    }
                    fragments.append(text)
                default:
                    continue
                }
            }
        }
        let text = fragments.joined().trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            throw OpenAIClientError.emptyResponse
        }
        return text
    }
}
