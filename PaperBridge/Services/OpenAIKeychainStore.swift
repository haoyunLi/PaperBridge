import Foundation
import Security

protocol APIKeyStoring {
    func read() throws -> String?
    func save(_ key: String) throws
    func delete() throws
}

enum OpenAIKeychainError: LocalizedError, Equatable {
    case operationFailed(OSStatus)
    case invalidData
    case emptyKey

    var errorDescription: String? {
        switch self {
        case .operationFailed(errSecInteractionNotAllowed):
            return "The Keychain is locked or unavailable. Unlock your login Keychain and try again."
        case .operationFailed(errSecAuthFailed):
            return "Access to the OpenAI API key in Keychain was denied."
        case .operationFailed(errSecUserCanceled):
            return "Keychain access was cancelled."
        case .operationFailed(let status):
            return "The OpenAI Keychain operation failed (status \(status))."
        case .invalidData:
            return "The saved OpenAI API key could not be read. Replace it in Settings."
        case .emptyKey:
            return "Enter an OpenAI API key before saving."
        }
    }
}

final class OpenAIKeychainStore: APIKeyStoring {
    private let service: String
    private let account: String

    init(
        service: String = (Bundle.main.bundleIdentifier ?? "com.haoyunli.PaperBridge") + ".openai",
        account: String = "api-key"
    ) {
        self.service = service
        self.account = account
    }

    func read() throws -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else {
            throw OpenAIKeychainError.operationFailed(status)
        }
        guard let data = result as? Data, let key = String(data: data, encoding: .utf8) else {
            throw OpenAIKeychainError.invalidData
        }
        return key
    }

    func save(_ key: String) throws {
        guard !key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw OpenAIKeychainError.emptyKey
        }
        let attributes: [String: Any] = [
            kSecValueData as String: Data(key.utf8)
        ]
        // Updating first preserves the existing key if writing its replacement fails.
        var status = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            let item = baseQuery.merging(attributes) { _, new in new }
            status = SecItemAdd(item as CFDictionary, nil)
            if status == errSecDuplicateItem {
                // Another writer may have inserted the item between the update and add.
                status = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
            }
        }
        guard status == errSecSuccess else {
            throw OpenAIKeychainError.operationFailed(status)
        }
    }

    func delete() throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw OpenAIKeychainError.operationFailed(status)
        }
    }

    // Side-effect-free for policy tests. TN3137: file-based Keychain uses the creator's
    // default ACL, not provisioned access groups. The user's default is normally login.
    // Non-synchronizable does not provide ThisDeviceOnly backup/migration protection;
    // kSecAttrAccessible is unsupported here and must not be supplied on writes either.
    var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: false,
            kSecUseDataProtectionKeychain as String: false
        ]
    }
}
