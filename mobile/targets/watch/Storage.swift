import Foundation
import Security

// The watch token lives in the Keychain; queued actions in UserDefaults.

enum TokenStore {
    private static let account = "watch-token"
    private static let service = "com.eyemyhealth.watch"

    static func save(_ token: String) {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        SecItemDelete(base as CFDictionary)
        var add = base
        add[kSecValueData as String] = Data(token.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }

    static func load() -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account, kSecReturnData as String: true]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func clear() {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        SecItemDelete(query as CFDictionary)
    }
}

// An action taken while offline. Water carries a client id so a retry after a
// dropped connection never counts twice (server: water_entries.client_entry_id).
struct QueuedAction: Codable, Identifiable {
    enum Kind: String, Codable { case water, weight, dose }
    var id = UUID().uuidString
    var kind: Kind
    var amountMl: Int?
    var weightKg: Double?
    var medicationId: String?
    var slot: String?
    var status: String?
    var date: String?
    var loggedAt = Date()
}

enum OfflineQueue {
    private static let key = "queued-actions"

    static func all() -> [QueuedAction] {
        guard let data = UserDefaults.standard.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode([QueuedAction].self, from: data)) ?? []
    }

    static func save(_ actions: [QueuedAction]) {
        UserDefaults.standard.set(try? JSONEncoder().encode(actions), forKey: key)
    }
}
