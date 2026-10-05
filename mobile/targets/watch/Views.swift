import SwiftUI

@main
struct EyeMyHealthWatchApp: App {
    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            Group {
                switch model.phase {
                case .signedOut: SignedOutView()
                case .pairing(let start): PairingView(start: start)
                case .signedIn: HomeView()
                }
            }
            .environmentObject(model)
            .task { if case .signedIn = model.phase { await model.refresh() } }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active, case .signedIn = model.phase { Task { await model.refresh() } }
            }
        }
    }
}

struct SignedOutView: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        VStack(spacing: 8) {
            Text("EyeMyHealth").font(.headline)
            Text("Connect this watch to your account.").font(.footnote).multilineTextAlignment(.center)
            if let e = model.error { Text(e).font(.caption2).foregroundStyle(Brand.warning) }
            Button("Get code") { model.startPairing() }.tint(Brand.primary)
        }.padding()
    }
}

struct PairingView: View {
    @EnvironmentObject var model: AppModel
    let start: PairStart
    var body: some View {
        VStack(spacing: 6) {
            Text("Enter on your phone").font(.footnote)
            Text(start.code).font(.system(size: 30, weight: .heavy, design: .rounded)).monospacedDigit().kerning(3)
            Text("EyeMyHealth → More → Watch").font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center)
            ProgressView().padding(.top, 4)
        }
    }
}

struct Rings: View {
    let steps: Double, water: Double, doses: Double
    private func ring(_ value: Double, _ color: Color, _ size: CGFloat) -> some View {
        ZStack {
            Circle().stroke(color.opacity(0.22), lineWidth: 8)
            Circle().trim(from: 0, to: min(max(value, 0), 1)).stroke(color, style: StrokeStyle(lineWidth: 8, lineCap: .round)).rotationEffect(.degrees(-90))
        }.frame(width: size, height: size)
    }
    var body: some View {
        ZStack { ring(water, Brand.teal, 100); ring(doses, Brand.good, 74) }
    }
}

struct HomeView: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        NavigationStack {
            List {
                VStack(spacing: 6) {
                    let all = model.reminders.flatMap { $0.doses }
                    let taken = all.filter { $0.status == "taken" }.count
                    Rings(steps: 0, water: Double(model.waterMl) / Double(max(model.waterTargetMl, 1)), doses: all.isEmpty ? 0 : Double(taken) / Double(all.count))
                    Text("\(taken)/\(all.count) doses · \(model.waterMl) ml").font(.caption2).foregroundStyle(.secondary)
                    if let (r, _) = model.dueDose { Text("💊 \(r.name)").font(.caption).padding(.horizontal, 8).padding(.vertical, 3).background(Brand.card, in: Capsule()) }
                }.frame(maxWidth: .infinity).listRowBackground(Color.clear)
                NavigationLink("Medications") { DosesView() }
                NavigationLink("Water") { WaterView() }
                NavigationLink("Weight") { WeightView() }
                if model.queued > 0 { Text("\(model.queued) waiting to sync").font(.caption2).foregroundStyle(Brand.warning) }
                else if let e = model.error { Text(e).font(.caption2).foregroundStyle(Brand.warning) }
                Button("Remove from this watch", role: .destructive) { model.signOut() }.font(.caption2)
            }
            .navigationTitle("EyeMyHealth")
        }
    }
}

struct DosesView: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        List {
            if model.reminders.isEmpty { Text("No doses today").foregroundStyle(.secondary) }
            ForEach(model.reminders) { r in
                ForEach(r.doses) { d in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(r.name).font(.headline)
                        Text(d.slot.capitalized + (r.foodRelation.map { " · " + $0.replacingOccurrences(of: "_", with: " ") } ?? "")).font(.caption2).foregroundStyle(.secondary)
                        if d.status == "pending" {
                            HStack {
                                Button("Taken") { model.logDose(r, d, status: "taken") }.tint(Brand.good)
                                Button("Skip") { model.logDose(r, d, status: "skipped") }.tint(.gray)
                            }.font(.caption)
                        } else {
                            Text(d.status == "taken" ? "✓ Taken" : "Skipped").font(.caption).foregroundStyle(d.status == "taken" ? Brand.good : .secondary)
                        }
                    }
                }
            }
        }.navigationTitle("Today")
    }
}

struct WaterView: View {
    @EnvironmentObject var model: AppModel
    @State private var amount: Double = 250
    var body: some View {
        VStack(spacing: 6) {
            Text("\(model.waterMl) / \(model.waterTargetMl) ml").font(.headline).monospacedDigit()
            ProgressView(value: Double(model.waterMl), total: Double(max(model.waterTargetMl, 1))).tint(Brand.teal)
            Button("+ \(Int(amount)) ml") { model.logWater(Int(amount)) }.tint(Brand.teal)
            Text("Turn the Digital Crown to change").font(.caption2).foregroundStyle(.secondary)
        }
        .focusable()
        .digitalCrownRotation($amount, from: 100, through: 1000, by: 50, sensitivity: .medium, isContinuous: false, isHapticFeedbackEnabled: true)
        .navigationTitle("Water")
    }
}

struct WeightView: View {
    @EnvironmentObject var model: AppModel
    @State private var kg: Double = 70
    @State private var saved = false
    var body: some View {
        VStack(spacing: 6) {
            Text(String(format: "%.1f kg", kg)).font(.system(size: 28, weight: .heavy, design: .rounded)).monospacedDigit()
            Button(saved ? "Saved ✓" : "Save") { model.logWeight((kg * 10).rounded() / 10); saved = true }.tint(Brand.primary).disabled(saved)
        }
        .focusable()
        .digitalCrownRotation($kg, from: 20, through: 300, by: 0.1, sensitivity: .low, isContinuous: false, isHapticFeedbackEnabled: true)
        .onChange(of: kg) { _, _ in saved = false }
        .navigationTitle("Weight")
    }
}
