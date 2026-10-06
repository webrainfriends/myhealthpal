import SwiftUI
import WatchKit

@MainActor
final class AppModel: ObservableObject {
    enum Phase { case signedOut, pairing(PairStart), signedIn }

    @Published var phase: Phase = TokenStore.load() == nil ? .signedOut : .signedIn
    @Published var reminders: [Reminder] = []
    @Published var waterMl = 0
    @Published var waterTargetMl = 2000
    @Published var queued = OfflineQueue.all().count
    @Published var error: String?

    private var pollTask: Task<Void, Never>?

    static var todayKey: String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX")
        return f.string(from: Date())
    }

    // MARK: Pairing

    func startPairing() {
        error = nil
        pollTask?.cancel()
        pollTask = Task {
            do {
                let start = try await API.pairStart(deviceName: WKInterfaceDevice.current().name)
                phase = .pairing(start)
                let deadline = Date().addingTimeInterval(TimeInterval(start.expiresInSeconds))
                while !Task.isCancelled && Date() < deadline {
                    try await Task.sleep(nanoseconds: 3_000_000_000)
                    let poll = try await API.pairPoll(start)
                    if poll.status == "approved", let token = poll.token {
                        TokenStore.save(token); phase = .signedIn; await refresh(); return
                    }
                    if poll.status == "expired" { break }
                }
                if !Task.isCancelled { phase = .signedOut; error = "Code expired. Try again." }
            } catch is CancellationError {
            } catch { phase = .signedOut; self.error = (error as? APIError)?.message ?? "No connection" }
        }
    }

    func signOut() { TokenStore.clear(); phase = .signedOut; reminders = [] }

    // MARK: Data

    func refresh() async {
        await flushQueue()
        do {
            reminders = try await API.reminders(date: Self.todayKey).reminders.filter { $0.active }
            let water = try await API.waterSummary()
            waterMl = water.totalMl
            waterTargetMl = water.target.ideal_ml ?? 2000
            error = nil
        } catch let e as APIError where e.status == 401 { signOut() }
        catch { self.error = "Offline" }
    }

    var dueDose: (Reminder, Dose)? {
        for r in reminders { if let d = r.doses.first(where: { $0.status == "pending" }) { return (r, d) } }
        return nil
    }

    // MARK: Actions (queued first, then sent, so nothing is lost offline)

    func logWater(_ ml: Int) { enqueue(QueuedAction(kind: .water, amountMl: ml)); waterMl += ml }
    func logWeight(_ kg: Double) { enqueue(QueuedAction(kind: .weight, weightKg: kg)) }
    func logDose(_ r: Reminder, _ d: Dose, status: String) {
        enqueue(QueuedAction(kind: .dose, medicationId: r.medicationId, slot: d.slot, status: status, date: Self.todayKey))
        reminders = reminders.map { item in
            guard item.medicationId == r.medicationId else { return item }
            return Reminder(medicationId: item.medicationId, name: item.name, foodRelation: item.foodRelation, active: true,
                            doses: item.doses.map { $0.slot == d.slot ? Dose(slot: $0.slot, status: status) : $0 })
        }
        WKInterfaceDevice.current().play(status == "taken" ? .success : .click)
    }

    private func enqueue(_ action: QueuedAction) {
        OfflineQueue.save(OfflineQueue.all() + [action]); queued = OfflineQueue.all().count
        Task { await flushQueue() }
    }

    func flushQueue() async {
        var remaining: [QueuedAction] = []
        for a in OfflineQueue.all() {
            do {
                switch a.kind {
                case .water: try await API.logWater(amountMl: a.amountMl ?? 0, clientEntryId: a.id, at: a.loggedAt)
                case .weight: try await API.logWeight(kg: a.weightKg ?? 0)
                case .dose: try await API.logDose(medicationId: a.medicationId ?? "", slot: a.slot ?? "", status: a.status ?? "taken", date: a.date ?? Self.todayKey)
                }
            } catch let e as APIError where (400..<500).contains(e.status) && e.status != 401 && e.status != 429 {
                // The server rejected it for good (e.g. dose already logged): drop it.
            } catch { remaining.append(a) }
        }
        OfflineQueue.save(remaining); queued = remaining.count
    }
}
