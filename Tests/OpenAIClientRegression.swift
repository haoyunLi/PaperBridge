import Foundation
import Security

private func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else {
        print("FAIL: \(message)")
        fflush(nil)
        exit(1)
    }
}

private enum MockReply: Sendable {
    case http(Int, Data)
    case redirect(URL)
    case failure(URLError)
    case nonHTTP
    case foreignURL
    case pending
}

private final class MockState: @unchecked Sendable {
    private let lock = NSLock()
    private var reply = MockReply.pending
    private var capturedRequests: [URLRequest] = []
    private var stopped = 0

    func reset(_ reply: MockReply) {
        lock.withLock {
            self.reply = reply
            capturedRequests = []
            stopped = 0
        }
    }

    func receive(_ request: URLRequest) -> MockReply {
        lock.withLock {
            capturedRequests.append(request)
            return reply
        }
    }

    func stop() {
        lock.withLock { stopped += 1 }
    }

    var requests: [URLRequest] { lock.withLock { capturedRequests } }
    var stopCount: Int { lock.withLock { stopped } }
}

private final class OpenAIMockURLProtocol: URLProtocol, @unchecked Sendable {
    static let state = MockState()

    // Intercept every URL, including an erroneous redirect, so tests cannot use the network.
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        switch Self.state.receive(request) {
        case .http(let status, let data):
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: [
                "Content-Type": "application/json",
                "Cache-Control": "public, max-age=86400",
                "Set-Cookie": "mock-cookie=should-not-persist; Secure"
            ])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .allowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        case .redirect(let destination):
            guard request.url?.host == "api.openai.com" else {
                client?.urlProtocol(self, didFailWithError: URLError(.badURL))
                return
            }
            let response = HTTPURLResponse(url: request.url!, statusCode: 302, httpVersion: nil, headerFields: [
                "Location": destination.absoluteString
            ])!
            var redirected = request
            redirected.url = destination
            client?.urlProtocol(self, wasRedirectedTo: redirected, redirectResponse: response)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocolDidFinishLoading(self)
        case .failure(let error):
            client?.urlProtocol(self, didFailWithError: error)
        case .nonHTTP:
            let response = URLResponse(url: request.url!, mimeType: "application/json", expectedContentLength: 0, textEncodingName: nil)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocolDidFinishLoading(self)
        case .foreignURL:
            let response = HTTPURLResponse(url: URL(string: "https://example.invalid/responses")!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocolDidFinishLoading(self)
        case .pending:
            break
        }
    }

    override func stopLoading() {
        Self.state.stop()
    }
}

@main
@MainActor
struct OpenAIClientRegression {
    private static let key = "sk-test-not-a-real-api-key"
    private static let privateMarker = "PRIVATE_RESPONSE_MARKER"
    private static let prompt = "PRIVATE_PROMPT_MARKER"
    private static let completed = #"{"status":"completed","error":null,"incomplete_details":null,"output":[{"type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":"Hello"}]}]}"#

    static func main() async throws {
        let watchdog = Task.detached {
            do {
                try await Task.sleep(nanoseconds: 30_000_000_000)
            } catch {
                return
            }
            require(false, "Mock regression suite timed out")
        }
        defer { watchdog.cancel() }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [OpenAIMockURLProtocol.self]
        configuration.httpAdditionalHeaders = [
            "Cookie": "injected-cookie=must-not-be-sent",
            "X-Injected-Header": "must-not-be-sent",
            "Authorization": "Bearer must-not-be-used"
        ]
        let injectedSession = URLSession(configuration: configuration)
        defer { injectedSession.invalidateAndCancel() }
        let client = OpenAIClient(session: injectedSession)

        try await testRequestContract(client)
        try await testOutputParsing(client)
        try await testHTTPFailures(client)
        try await testResponseFailures(client)
        try await testModels(client)
        try await testTransportAndValidation(client)
        try await testRedirects(client)
        try await testCancellation(client)
        testKeychainErrorSurface()
        print("OpenAI client regression tests passed (9 groups; no live API or Keychain access).")
    }

    private static func testRequestContract(_ client: OpenAIClient) async throws {
        respond(completed)
        let text = try await client.generate(apiKey: key, model: "chosen-model", prompt: prompt, systemPrompt: "System instructions")
        require(text == "Hello", "Expected completed text")
        require(OpenAIMockURLProtocol.state.requests.count == 1, "Generation must not retry")
        let request = OpenAIMockURLProtocol.state.requests[0]
        assertRequest(request, endpoint: "responses", method: "POST")
        require(request.value(forHTTPHeaderField: "Content-Type") == "application/json", "Missing JSON content type")
        let body = try bodyObject(request)
        require(Set(body.keys) == ["model", "input", "instructions", "store", "stream", "max_output_tokens"], "Unexpected generation parameters")
        require(body["model"] as? String == "chosen-model", "Model was changed")
        require(body["input"] as? String == prompt, "Input was changed")
        require(body["instructions"] as? String == "System instructions", "Instructions were lost")
        require(body["store"] as? Bool == false, "Response storage must be disabled")
        require(body["stream"] as? Bool == false, "Streaming must be disabled")
        require(body["max_output_tokens"] as? Int == 8192, "Incorrect token limit")

        for systemPrompt in [nil, ""] as [String?] {
            respond(completed)
            _ = try await client.generate(apiKey: key, model: "another-model", prompt: prompt, systemPrompt: systemPrompt)
            let body = try bodyObject(OpenAIMockURLProtocol.state.requests[0])
            if let systemPrompt {
                require(body["instructions"] as? String == systemPrompt, "Present empty instructions must be preserved")
            } else {
                require(body["instructions"] == nil, "Absent instructions must be omitted, not null")
            }
            require(body["temperature"] == nil && body["reasoning"] == nil, "Model-specific assumptions must not be sent")
        }
        print("PASS request endpoint, authentication, exact payload, and session isolation")
    }

    private static func testOutputParsing(_ client: OpenAIClient) async throws {
        respond(#"{"status":"completed","output_text":"DO_NOT_USE","output":[{"type":"reasoning","summary":[{"type":"summary_text","text":"DO_NOT_USE"}],"content":[{"type":"output_text","text":"DO_NOT_USE"}]},{"type":"function_call","text":"DO_NOT_USE"},{"type":"message","role":"assistant","status":"completed","content":[{"type":"reasoning_text","text":"DO_NOT_USE"},{"type":"output_text","text":"  First "},{"type":"output_text","text":"answer."}]},{"type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":"\nSecond answer.  "}]}]}"#)
        let text = try await client.generate(apiKey: key, model: "test", prompt: prompt, systemPrompt: nil)
        require(text == "First answer.\nSecond answer.", "Only ordered message output_text fragments should be returned")
        print("PASS message parsing ignores reasoning, tools, and top-level text")
    }

    private static func testHTTPFailures(_ client: OpenAIClient) async throws {
        let cases: [(Int, OpenAIClientError)] = [
            (400, .httpError(400)), (401, .authenticationFailed), (403, .permissionDenied),
            (404, .httpError(404)), (408, .httpError(408)), (429, .rateLimited),
            (500, .serverError), (502, .serverError), (503, .serverError),
            (301, .redirectRejected), (307, .redirectRejected), (308, .redirectRejected)
        ]
        for (status, expected) in cases {
            for useModels in [false, true] {
                respond("<html>\(key) \(privateMarker) \(prompt)</html>", status: status)
                await expectError(expected) {
                    if useModels {
                        _ = try await client.listModels(apiKey: key)
                    } else {
                        _ = try await client.generate(apiKey: key, model: "test", prompt: prompt, systemPrompt: nil)
                    }
                }
                require(OpenAIMockURLProtocol.state.requests.count == 1, "An HTTP failure must not trigger automatic retries or fallback")
            }
        }
        print("PASS HTTP error mapping, redaction, and no retries")
    }

    private static func testResponseFailures(_ client: OpenAIClient) async throws {
        let partial = #"{"type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":"PRIVATE_RESPONSE_MARKER"}]}"#
        let cases: [(String, OpenAIClientError)] = [
            (#"{"status":"incomplete","output":["# + partial + #"],"incomplete_details":{"reason":"max_output_tokens"}}"#, .incompleteResponse),
            (#"{"status":"failed","error":{"message":""# + key + #""},"output":["# + partial + "]}", .failedResponse),
            (#"{"status":"completed","error":{"message":"PRIVATE_RESPONSE_MARKER"},"output":["# + partial + "]}", .failedResponse),
            (#"{"status":"completed","incomplete_details":{"reason":"content_filter"},"output":["# + partial + "]}", .incompleteResponse),
            (#"{"status":"queued","output":[]}"#, .incompleteResponse),
            (#"{"status":"in_progress","output":[]}"#, .incompleteResponse),
            (#"{"status":"unknown","output":[]}"#, .malformedResponse),
            (#"{"status":"completed","output":["# + partial + #",{"type":"message","role":"assistant","content":[{"type":"refusal","refusal":"PRIVATE_RESPONSE_MARKER"}]}]}"#, .refusedResponse),
            (#"{"status":"completed","output":["# + partial + #",{"type":"message","role":"assistant","status":"incomplete","content":[]}]}"#, .incompleteResponse),
            (#"{"status":"completed","output":["# + partial + #",{"type":"message","role":"assistant","status":"in_progress","content":[]}]}"#, .incompleteResponse),
            (#"{"status":"completed","output":["# + partial + #",{"type":"message","role":"assistant","content":[{"type":"output_text","text":5}]}]}"#, .malformedResponse),
            (#"{"status":"completed","output":[]}"#, .emptyResponse),
            (#"{"status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":" \n\t "}]}]}"#, .emptyResponse),
            (#"{"status":"completed","output_text":"PRIVATE_RESPONSE_MARKER","output":[{"type":"reasoning","content":[{"type":"output_text","text":"PRIVATE_RESPONSE_MARKER"}]}]}"#, .emptyResponse),
            (#"{"status":"completed","output":[{"type":"message","role":"user","content":[{"type":"output_text","text":"PRIVATE_RESPONSE_MARKER"}]}]}"#, .malformedResponse),
            (#"{"status":"completed","output":[{"type":"message","role":"assistant","content":{}}]}"#, .malformedResponse),
            (#"{"status":"completed","output":[{"type":"message","role":"assistant","content":[{"text":"PRIVATE_RESPONSE_MARKER"}]}]}"#, .malformedResponse),
            (#"{"status":"completed","output":[{}]}"#, .malformedResponse),
            (#"{"status":"completed","output":[1]}"#, .malformedResponse),
            (#"{"status":"completed","output":null}"#, .malformedResponse),
            (#"{"status":"completed"}"#, .malformedResponse),
            (#"{"output":[]}"#, .malformedResponse),
            ("[]", .malformedResponse), ("null", .malformedResponse),
            ("{not JSON " + key, .malformedResponse), ("", .malformedResponse)
        ]
        for (json, expected) in cases {
            respond(json)
            await expectError(expected) {
                _ = try await client.generate(apiKey: key, model: "test", prompt: prompt, systemPrompt: nil)
            }
            require(OpenAIMockURLProtocol.state.requests.count == 1, "Response failure retried or used a fallback")
        }
        print("PASS incomplete, failed, refusal, empty, and malformed responses never return partial text")
    }

    private static func testModels(_ client: OpenAIClient) async throws {
        respond(#"{"data":[{"id":"z-model"},{"id":"embedding-model"},{"id":"a-model"},{"id":"a-model"}]}"#)
        let models = try await client.listModels(apiKey: key)
        require(models == ["a-model", "a-model", "embedding-model", "z-model"], "Model IDs should only be sorted, not filtered by inferred support")
        let request = OpenAIMockURLProtocol.state.requests[0]
        assertRequest(request, endpoint: "models", method: "GET")
        require(request.httpBody == nil && request.httpBodyStream == nil, "Model list must not have a request body")
        _ = try await client.listModels(apiKey: key)
        require(OpenAIMockURLProtocol.state.requests.count == 2, "Model responses must not be cached")
        require(OpenAIMockURLProtocol.state.requests[1].value(forHTTPHeaderField: "Cookie") == nil, "Response cookies must not be reused")

        respond(#"{"data":[]}"#)
        let empty = try await client.listModels(apiKey: key)
        require(empty.isEmpty, "An empty model catalog is valid")
        for json in ["{}", #"{"data":null}"#, #"{"data":[{}]}"#, #"{"data":[{"id":3}]}"#, key] {
            respond(json)
            await expectError(.malformedResponse) { _ = try await client.listModels(apiKey: key) }
        }
        print("PASS model sorting, schema validation, no inferred compatibility, no cache or cookies")
    }

    private static func testTransportAndValidation(_ client: OpenAIClient) async throws {
        for code in [URLError.Code.notConnectedToInternet, .timedOut, .secureConnectionFailed] {
            OpenAIMockURLProtocol.state.reset(.failure(URLError(code, userInfo: [NSLocalizedDescriptionKey: key + privateMarker])))
            await expectError(.networkError) {
                _ = try await client.generate(apiKey: key, model: "test", prompt: prompt, systemPrompt: nil)
            }
            require(OpenAIMockURLProtocol.state.requests.count == 1, "Network failure must not retry")
        }
        for reply in [MockReply.nonHTTP, .foreignURL] {
            OpenAIMockURLProtocol.state.reset(reply)
            await expectError(.invalidResponse) { _ = try await client.listModels(apiKey: key) }
        }
        for invalidKey in ["", " \n", "bad\r\nInjected: secret", "key with spaces", "key\u{0000}"] {
            respond(completed)
            await expectError(.invalidAPIKey) { _ = try await client.listModels(apiKey: invalidKey) }
            require(OpenAIMockURLProtocol.state.requests.isEmpty, "Invalid keys must fail before transport")
        }
        print("PASS sanitized transport failures and API key validation")
    }

    private static func testRedirects(_ client: OpenAIClient) async throws {
        for destination in ["https://example.invalid/stolen", "http://api.openai.com/v1/responses", "https://api.openai.com/v1/other"] {
            OpenAIMockURLProtocol.state.reset(.redirect(URL(string: destination)!))
            await expectError(.redirectRejected) {
                _ = try await client.generate(apiKey: key, model: "test", prompt: prompt, systemPrompt: nil)
            }
            require(OpenAIMockURLProtocol.state.requests.count == 1, "Redirect followed; credentials could leave the endpoint")
        }
        print("PASS cross-host, downgrade, and same-host redirects blocked")
    }

    private static func testCancellation(_ client: OpenAIClient) async throws {
        for useModels in [false, true] {
            OpenAIMockURLProtocol.state.reset(.pending)
            let task = Task {
                if useModels {
                    _ = try await client.listModels(apiKey: key)
                } else {
                    _ = try await client.generate(apiKey: key, model: "test", prompt: prompt, systemPrompt: nil)
                }
            }
            for _ in 0..<500 where OpenAIMockURLProtocol.state.requests.isEmpty {
                try await Task.sleep(nanoseconds: 1_000_000)
            }
            require(OpenAIMockURLProtocol.state.requests.count == 1, "Cancellation fixture never started")
            task.cancel()
            await expectCancellation { try await task.value }
            for _ in 0..<500 where OpenAIMockURLProtocol.state.stopCount == 0 {
                try await Task.sleep(nanoseconds: 1_000_000)
            }
            require(OpenAIMockURLProtocol.state.stopCount > 0, "Cancellation did not stop the underlying request")
        }

        OpenAIMockURLProtocol.state.reset(.failure(URLError(.cancelled, userInfo: [NSLocalizedDescriptionKey: key])))
        await expectCancellation { _ = try await client.listModels(apiKey: key) }
        respond(#"{"status":"cancelled","output":[]}"#)
        await expectCancellation {
            _ = try await client.generate(apiKey: key, model: "test", prompt: prompt, systemPrompt: nil)
        }

        respond(completed)
        let cancelledTask = Task {
            while !Task.isCancelled { await Task.yield() }
            _ = try await client.listModels(apiKey: key)
        }
        cancelledTask.cancel()
        await expectCancellation { try await cancelledTask.value }
        require(OpenAIMockURLProtocol.state.requests.isEmpty, "Pre-cancelled tasks must not start a request")
        print("PASS in-flight, transport, server, and pre-flight cancellation")
    }

    private static func testKeychainErrorSurface() {
        func checkConformance<T: APIKeyStoring>(_ type: T.Type) {}
        checkConformance(OpenAIKeychainStore.self)
        // Construction and query inspection do not call any Security credential API.
        let store = OpenAIKeychainStore(service: "regression-only.openai", account: "test-account")
        let query = store.baseQuery
        require(query[kSecClass as String] as? String == kSecClassGenericPassword as String, "Expected a generic-password item")
        require(query[kSecAttrService as String] as? String == "regression-only.openai", "Wrong Keychain service")
        require(query[kSecAttrAccount as String] as? String == "test-account", "Wrong Keychain account")
        require(query[kSecUseDataProtectionKeychain as String] as? Bool == false, "Direct builds must use the file-based Keychain")
        require(query[kSecAttrSynchronizable as String] as? Bool == false, "API keys must not synchronize through iCloud")
        require(query[kSecAttrAccessGroup as String] == nil, "File-based Keychain must not require provisioned access groups")
        require(query[kSecAttrAccessible as String] == nil, "Do not claim unsupported ThisDeviceOnly accessibility")
        require(query[kSecValueData as String] == nil, "Lookup policy must not contain a credential")
        for error in [OpenAIKeychainError.operationFailed(errSecInteractionNotAllowed), .operationFailed(errSecAuthFailed),
                      .operationFailed(errSecUserCanceled), .operationFailed(errSecParam), .invalidData, .emptyKey] {
            require(!error.localizedDescription.isEmpty, "Keychain errors need a safe user-facing description")
            assertRedacted(error)
        }
        print("PASS file-based non-synchronizable Keychain policy and safe errors (storage not accessed)")
    }

    private static func respond(_ json: String, status: Int = 200) {
        OpenAIMockURLProtocol.state.reset(.http(status, Data(json.utf8)))
    }

    private static func assertRequest(_ request: URLRequest, endpoint: String, method: String) {
        require(request.url?.absoluteString == "https://api.openai.com/v1/" + endpoint, "Endpoint must be fixed to the official API")
        require(request.httpMethod == method, "Incorrect HTTP method")
        require(request.value(forHTTPHeaderField: "Authorization") == "Bearer " + key, "Incorrect Bearer authentication")
        require(request.value(forHTTPHeaderField: "Accept") == "application/json", "Expected JSON response header")
        require(request.cachePolicy == .reloadIgnoringLocalCacheData, "Caching must be disabled")
        require(!request.httpShouldHandleCookies, "Request must disable cookie handling")
        require(request.value(forHTTPHeaderField: "Cookie") == nil, "Injected session cookies must not be sent")
        require(request.value(forHTTPHeaderField: "X-Injected-Header") == nil, "Injected session settings must not weaken isolation")
    }

    private static func bodyObject(_ request: URLRequest) throws -> [String: Any] {
        var data = request.httpBody ?? Data()
        if let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 4096)
            while true {
                let count = stream.read(&buffer, maxLength: buffer.count)
                require(count >= 0, "Could not read mock request body")
                if count == 0 { break }
                data.append(contentsOf: buffer.prefix(count))
            }
        }
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }

    private static func expectError(_ expected: OpenAIClientError, _ operation: () async throws -> Void) async {
        do {
            try await operation()
            require(false, "Expected a client error, not success or partial output")
        } catch {
            require(error as? OpenAIClientError == expected, "Wrong client error category; expected \(expected)")
            assertRedacted(error)
        }
    }

    private static func expectCancellation(_ operation: () async throws -> Void) async {
        do {
            try await operation()
            require(false, "Cancellation unexpectedly succeeded")
        } catch {
            require(error is CancellationError, "Cancellation must use CancellationError")
            assertRedacted(error)
        }
    }

    private static func assertRedacted(_ error: Error) {
        let descriptions = [error.localizedDescription, String(reflecting: error), String(describing: (error as NSError).userInfo)]
        for description in descriptions {
            require(!description.contains(key) && !description.contains(privateMarker) && !description.contains(prompt), "Error exposed sensitive content")
        }
    }
}
