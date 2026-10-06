package com.eyemyhealth.wear

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

// Same REST API as the phone app, called with the scoped watch token
// (server/src/middleware/auth.js limits what that token may reach).

class ApiException(val status: Int, message: String) : Exception(message)

data class Dose(val slot: String, val status: String)
data class Reminder(val medicationId: String, val name: String, val foodRelation: String?, val doses: List<Dose>)
data class PairStart(val pairingId: String, val code: String, val pollSecret: String, val expiresInSeconds: Int)

class Store(context: Context) {
    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        context, "watch_secure",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )
    var token: String?
        get() = prefs.getString("token", null)
        set(value) { prefs.edit().apply { if (value == null) remove("token") else putString("token", value) }.apply() }

    // Actions taken offline, replayed in order. Water keeps its id as the server-side idempotency key.
    fun queue(): JSONArray = JSONArray(prefs.getString("queue", "[]"))
    fun saveQueue(q: JSONArray) = prefs.edit().putString("queue", q.toString()).apply()
}

object Api {
    private val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
    fun todayKey(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

    private suspend fun call(method: String, path: String, token: String?, body: JSONObject? = null): JSONObject =
        withContext(Dispatchers.IO) {
            val conn = (URL(BuildConfig.API_BASE_URL + path).openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = 15000
                readTimeout = 15000
                if (token != null) setRequestProperty("Authorization", "Bearer $token")
                if (body != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                    outputStream.use { it.write(body.toString().toByteArray()) }
                }
            }
            try {
                val code = conn.responseCode
                val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.readText().orEmpty()
                val json = if (text.isBlank()) JSONObject() else runCatching { JSONObject(text) }.getOrDefault(JSONObject())
                if (code !in 200..299) throw ApiException(code, json.optString("error", "Request failed"))
                json
            } finally { conn.disconnect() }
        }

    suspend fun pairStart(deviceName: String): PairStart {
        val j = call("POST", "api/watch/pair/start", null, JSONObject().put("deviceName", deviceName).put("platform", "wearos"))
        return PairStart(j.getString("pairingId"), j.getString("code"), j.getString("pollSecret"), j.getInt("expiresInSeconds"))
    }

    /** Returns the token once the phone has approved, "expired" if it timed out, or null while pending. */
    suspend fun pairPoll(start: PairStart): String? {
        val j = call("POST", "api/watch/pair/poll", null, JSONObject().put("pairingId", start.pairingId).put("pollSecret", start.pollSecret))
        return when (j.optString("status")) {
            "approved" -> j.getString("token")
            "expired" -> "expired"
            else -> null
        }
    }

    suspend fun reminders(token: String): List<Reminder> {
        val arr = call("GET", "api/medications/reminders/today?date=${todayKey()}", token).getJSONArray("reminders")
        return (0 until arr.length()).map { arr.getJSONObject(it) }.filter { it.optBoolean("active") }.map { r ->
            val d = r.getJSONArray("doses")
            Reminder(r.getString("medicationId"), r.getString("name"), r.optString("foodRelation").ifBlank { null },
                (0 until d.length()).map { Dose(d.getJSONObject(it).getString("slot"), d.getJSONObject(it).getString("status")) })
        }
    }

    /** Returns (total ml today, ideal target ml). */
    suspend fun water(token: String): Pair<Int, Int> {
        val j = call("GET", "api/water/summary", token)
        return j.getInt("totalMl") to j.optJSONObject("target")?.optInt("ideal_ml", 2000).let { it ?: 2000 }
    }

    suspend fun send(token: String, action: JSONObject) {
        when (action.getString("kind")) {
            "water" -> call("POST", "api/water/entries", token, JSONObject()
                .put("amount_ml", action.getInt("amountMl")).put("client_entry_id", action.getString("id"))
                .put("logged_at", iso.format(Date(action.getLong("loggedAt")))))
            "weight" -> call("POST", "api/health-profile/weight", token, JSONObject().put("weightKg", action.getDouble("weightKg")))
            "dose" -> call("POST", "api/medications/${action.getString("medicationId")}/doses", token,
                JSONObject().put("slot", action.getString("slot")).put("status", action.getString("status")).put("date", action.getString("date")))
        }
    }
}
