import Foundation

// Talks to the same REST API as the phone app, with the scoped watch token
// (server/src/middleware/auth.js limits what it may call).

struct APIError: Error { let status: Int; let message: String }

struct Dose: Decodable, Identifiable {
    let slot: String
    let status: String
    var id: String { slot }
}

struct Reminder: Decodable, Identifiable {
    let medicationId: String
    let name: String
    let foodRelation: String?
    let active: Bool
    let doses: [Dose]
    var id: String { medicationId }
}

struct RemindersResponse: Decodable { let date: String; let reminders: [Reminder] }
struct WaterSummary: Decodable {
    struct Target: Decodable { let ideal_ml: Int? }
    let totalMl: Int
    let target: Target
}

struct PairStart: Decodable { let pairingId: String; let code: String; let pollSecret: String; let expiresInSeconds: Int }
struct PairPoll: Decodable { let status: String; let token: String? }

enum API {
    static var baseURL = URL(string: "https://eyemyhealth.com")!

    private static func request<T: Decodable>(_ method: String, _ path: String, body: [String: Any]? = nil, auth: Bool = true) async throws -> T {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = method
        req.timeoutInterval = 15
        if let body { req.httpBody = try JSONSerialization.data(withJSONObject: body); req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if auth, let token = TokenStore.load() { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let (data, response) = try await URLSession.shared.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String ?? "Request failed"
            throw APIError(status: status, message: message)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private struct Empty: Decodable {}

    static func pairStart(deviceName: String) async throws -> PairStart {
        try await request("POST", "api/watch/pair/start", body: ["deviceName": deviceName, "platform": "watchos"], auth: false)
    }
    static func pairPoll(_ start: PairStart) async throws -> PairPoll {
        try await request("POST", "api/watch/pair/poll", body: ["pairingId": start.pairingId, "pollSecret": start.pollSecret], auth: false)
    }
    static func reminders(date: String) async throws -> RemindersResponse {
        try await request("GET", "api/medications/reminders/today?date=\(date)")
    }
    static func logDose(medicationId: String, slot: String, status: String, date: String) async throws {
        let _: Empty = try await request("POST", "api/medications/\(medicationId)/doses", body: ["slot": slot, "status": status, "date": date])
    }
    static func waterSummary() async throws -> WaterSummary {
        try await request("GET", "api/water/summary")
    }
    static func logWater(amountMl: Int, clientEntryId: String, at: Date) async throws {
        let _: Empty = try await request("POST", "api/water/entries", body: ["amount_ml": amountMl, "client_entry_id": clientEntryId, "logged_at": ISO8601DateFormatter().string(from: at)])
    }
    static func logWeight(kg: Double) async throws {
        let _: Empty = try await request("POST", "api/health-profile/weight", body: ["weightKg": kg])
    }
}
