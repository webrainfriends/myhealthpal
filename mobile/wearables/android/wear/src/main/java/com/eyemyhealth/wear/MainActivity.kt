package com.eyemyhealth.wear

import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.UUID

// Colors from mobile/src/theme/theme.js, tuned for a dark watch face.
private val Primary = Color(0xFF6C4DFF)
private val Good = Color(0xFF0FB981)
private val Warn = Color(0xFFFF9500)
private val Teal = Color(0xFF0E9FB4)
private val Dim = Color(0xFF9A95B5)
private val Card = Color(0xFF1D1838)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme(colors = Colors(primary = Primary, background = Color(0xFF0D0A1F))) { App(Store(this)) } }
    }
}

@Composable
fun App(store: Store) {
    var token by remember { mutableStateOf(store.token) }
    if (token == null) PairScreen(store) { token = it } else Home(store) { store.token = null; token = null }
}

@Composable
fun PairScreen(store: Store, onPaired: (String) -> Unit) {
    var start by remember { mutableStateOf<PairStart?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    fun begin() = scope.launch {
        message = null
        try {
            val s = Api.pairStart(Build.MODEL ?: "Wear OS watch")
            start = s
            val deadline = System.currentTimeMillis() + s.expiresInSeconds * 1000L
            while (System.currentTimeMillis() < deadline) {
                delay(3000)
                val result = Api.pairPoll(s)
                if (result == "expired") break
                if (result != null) { store.token = result; onPaired(result); return@launch }
            }
            start = null; message = "Code expired. Try again."
        } catch (e: Exception) { start = null; message = (e as? ApiException)?.message ?: "No connection" }
    }

    Column(Modifier.fillMaxSize().padding(horizontal = 22.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        val s = start
        if (s == null) {
            Text("Connect to your account", textAlign = TextAlign.Center, fontSize = 13.sp)
            message?.let { Text(it, color = Warn, fontSize = 11.sp, textAlign = TextAlign.Center) }
            Spacer(Modifier.height(8.dp))
            Chip(onClick = { begin() }, label = { Text("Get code") }, colors = ChipDefaults.primaryChipColors())
        } else {
            Text("Enter on your phone", fontSize = 12.sp)
            Text(s.code, fontSize = 30.sp, fontWeight = FontWeight.ExtraBold)
            Text("EyeMyHealth → More → Watch", fontSize = 10.sp, color = Dim, textAlign = TextAlign.Center)
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun Home(store: Store, onSignedOut: () -> Unit) {
    val token = store.token ?: return
    val scope = rememberCoroutineScope()
    var reminders by remember { mutableStateOf<List<Reminder>>(emptyList()) }
    var waterMl by remember { mutableStateOf(0) }
    var waterTarget by remember { mutableStateOf(2000) }
    var queued by remember { mutableStateOf(store.queue().length()) }
    var status by remember { mutableStateOf<String?>(null) }
    var amount by remember { mutableStateOf(250) }
    var screen by remember { mutableStateOf("home") }
    val focus = remember { FocusRequester() }

    suspend fun flush() {
        val keep = org.json.JSONArray()
        val q = store.queue()
        for (i in 0 until q.length()) {
            val a = q.getJSONObject(i)
            try { Api.send(token, a) } catch (e: ApiException) {
                if (e.status == 401) { onSignedOut(); return }
                if (e.status !in 400..499 || e.status == 429) keep.put(a) // other 4xx: rejected for good, drop it
            } catch (e: Exception) { keep.put(a) }
        }
        store.saveQueue(keep); queued = keep.length()
    }

    suspend fun refresh() {
        flush()
        try {
            reminders = Api.reminders(token)
            val (total, target) = Api.water(token); waterMl = total; waterTarget = target; status = null
        } catch (e: ApiException) { if (e.status == 401) onSignedOut() else status = e.message }
        catch (e: Exception) { status = "Offline" }
    }

    fun enqueue(a: JSONObject) {
        val q = store.queue(); q.put(a.put("id", UUID.randomUUID().toString()).put("loggedAt", System.currentTimeMillis()))
        store.saveQueue(q); queued = q.length()
        scope.launch { flush() }
    }

    LaunchedEffect(Unit) { refresh() }
    LaunchedEffect(screen) { if (screen == "water") focus.requestFocus() }

    val due = reminders.flatMap { r -> r.doses.map { r to it } }.firstOrNull { it.second.status == "pending" }
    val all = reminders.flatMap { it.doses }

    ScalingLazyColumn(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
        when (screen) {
            "home" -> {
                item { Text("${all.count { it.status == "taken" }}/${all.size} doses", fontSize = 18.sp, fontWeight = FontWeight.ExtraBold) }
                item { Text("$waterMl / $waterTarget ml water", fontSize = 11.sp, color = Teal) }
                due?.let { (r, d) -> item { Chip(onClick = { screen = "doses" }, label = { Text("💊 ${r.name}") }, secondaryLabel = { Text(d.slot) }, colors = ChipDefaults.secondaryChipColors()) } }
                item { Chip(onClick = { screen = "doses" }, label = { Text("Medications") }, colors = ChipDefaults.secondaryChipColors()) }
                item { Chip(onClick = { screen = "water" }, label = { Text("Water") }, colors = ChipDefaults.secondaryChipColors()) }
                if (queued > 0) item { Text("$queued waiting to sync", fontSize = 10.sp, color = Warn) }
                else status?.let { item { Text(it, fontSize = 10.sp, color = Warn) } }
                item { CompactChip(onClick = onSignedOut, label = { Text("Remove from watch") }, colors = ChipDefaults.secondaryChipColors()) }
            }
            "doses" -> {
                item { Text("Today", fontSize = 14.sp, fontWeight = FontWeight.Bold) }
                if (reminders.isEmpty()) item { Text("No doses today", color = Dim, fontSize = 12.sp) }
                reminders.forEach { r ->
                    r.doses.forEach { d ->
                        item {
                            Column(Modifier.fillMaxWidth().background(Card, androidx.compose.foundation.shape.RoundedCornerShape(14.dp)).padding(10.dp)) {
                                Text(r.name, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                                Text(d.slot + (r.foodRelation?.let { " · " + it.replace('_', ' ') } ?: ""), fontSize = 10.sp, color = Dim)
                                if (d.status == "pending") Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    CompactChip(onClick = {
                                        reminders = reminders.map { if (it.medicationId == r.medicationId) it.copy(doses = it.doses.map { x -> if (x.slot == d.slot) x.copy(status = "taken") else x }) else it }
                                        enqueue(JSONObject().put("kind", "dose").put("medicationId", r.medicationId).put("slot", d.slot).put("status", "taken").put("date", Api.todayKey()))
                                    }, label = { Text("Taken") }, colors = ChipDefaults.chipColors(backgroundColor = Good))
                                    CompactChip(onClick = {
                                        reminders = reminders.map { if (it.medicationId == r.medicationId) it.copy(doses = it.doses.map { x -> if (x.slot == d.slot) x.copy(status = "skipped") else x }) else it }
                                        enqueue(JSONObject().put("kind", "dose").put("medicationId", r.medicationId).put("slot", d.slot).put("status", "skipped").put("date", Api.todayKey()))
                                    }, label = { Text("Skip") }, colors = ChipDefaults.secondaryChipColors())
                                } else Text(if (d.status == "taken") "✓ Taken" else "Skipped", fontSize = 11.sp, color = if (d.status == "taken") Good else Dim)
                            }
                        }
                    }
                }
                item { CompactChip(onClick = { screen = "home" }, label = { Text("Back") }, colors = ChipDefaults.secondaryChipColors()) }
            }
            "water" -> {
                item {
                    // The rotary bezel / crown changes the amount in 50 ml steps.
                    Column(
                        Modifier.onRotaryScrollEvent { e -> amount = (amount + if (e.verticalScrollPixels > 0) 50 else -50).coerceIn(100, 1000); true }
                            .focusRequester(focus).focusable(),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text("$waterMl / $waterTarget ml", fontWeight = FontWeight.ExtraBold, fontSize = 16.sp)
                        LinearProgressIndicatorCompat(waterMl.toFloat() / waterTarget.coerceAtLeast(1))
                        Spacer(Modifier.height(6.dp))
                        Chip(onClick = { waterMl += amount; enqueue(JSONObject().put("kind", "water").put("amountMl", amount)) },
                            label = { Text("+ $amount ml") }, colors = ChipDefaults.chipColors(backgroundColor = Teal))
                        Text("Rotate to change", fontSize = 10.sp, color = Dim)
                    }
                }
                item { CompactChip(onClick = { screen = "home" }, label = { Text("Back") }, colors = ChipDefaults.secondaryChipColors()) }
            }
        }
    }
}

@Composable
private fun LinearProgressIndicatorCompat(fraction: Float) {
    Box(Modifier.width(110.dp).height(6.dp).background(Teal.copy(alpha = 0.22f), CircleShape)) {
        Box(Modifier.fillMaxHeight().fillMaxWidth(fraction.coerceIn(0f, 1f)).background(Teal, CircleShape))
    }
}
