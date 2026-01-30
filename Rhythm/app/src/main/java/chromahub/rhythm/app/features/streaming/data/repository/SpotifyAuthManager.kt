package chromahub.rhythm.app.features.streaming.data.repository

import android.util.Base64
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.math.floor

/**
 * Spotify Client with TOTP Authentication
 * Mirrors the Windows SpotiFLAC authentication flow
 */
class SpotifyAuthManager {
    companion object {
        private const val TAG = "SpotifyAuthManager"

        // TOTP secrets by version (same as Windows app)
        private val TOTP_SECRETS = mapOf(
            59 to byteArrayOf(123, 105, 79, 70, 110, 59, 52, 125, 60, 49, 80, 70, 89, 75, 80, 86, 63, 53, 123, 37, 117, 49, 52, 93, 77, 62, 47, 86, 48, 104, 68, 72),
            60 to byteArrayOf(79, 109, 69, 123, 90, 65, 46, 74, 94, 34, 58, 48, 70, 71, 92, 85, 122, 63, 91, 64, 87, 87),
            61 to byteArrayOf(44, 55, 47, 42, 70, 40, 34, 114, 76, 74, 50, 111, 120, 97, 75, 76, 94, 102, 43, 69, 49, 120, 118, 80, 64, 78)
        )
        private const val TOTP_VERSION = 61

        // Use Android mobile user agent (matches mobile-web-player product type)
        private const val USER_AGENT = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36"
    }

    private val cookieStore = mutableMapOf<String, MutableList<Cookie>>()

    private val cookieJar = object : CookieJar {
        override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
            cookieStore.getOrPut(url.host) { mutableListOf() }.apply {
                cookies.forEach { cookie ->
                    removeIf { it.name == cookie.name }
                    add(cookie)
                }
            }
        }

        override fun loadForRequest(url: HttpUrl): List<Cookie> {
            val cookies = mutableListOf<Cookie>()
            // Get cookies for exact host
            cookieStore[url.host]?.let { cookies.addAll(it) }
            // Also get cookies from open.spotify.com for any spotify.com subdomain
            if (url.host.endsWith(".spotify.com") || url.host == "spotify.com") {
                cookieStore["open.spotify.com"]?.forEach { cookie ->
                    // Add if not already present and cookie matches the domain
                    if (cookies.none { it.name == cookie.name } && cookie.matches(url)) {
                        cookies.add(cookie)
                    }
                }
            }
            return cookies
        }
    }

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .cookieJar(cookieJar)
        .followRedirects(true)
        .build()

    // Separate client without cookies for client token request
    private val plainHttpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .followRedirects(true)
        .protocols(listOf(okhttp3.Protocol.HTTP_1_1))
        .build()

    private val mutex = Mutex()

    // Cached tokens
    private var accessToken: String? = null
    private var clientToken: String? = null
    private var clientId: String? = null
    private var deviceId: String? = null
    private var clientVersion: String = "1.2.56.214.ga67c6d6c"
    private var tokenExpiryTime: Long = 0

    /**
     * Initialize the Spotify client - gets all necessary tokens
     */
    suspend fun initialize(): Boolean = withContext(Dispatchers.IO) {
        mutex.withLock {
            try {
                // Step 1: Get session info (clientVersion, cookies)
                if (!getSessionInfo()) {
                    Log.e(TAG, "Failed to get session info")
                    return@withContext false
                }

                // Step 2: Get access token using TOTP
                if (!getAccessToken()) {
                    Log.e(TAG, "Failed to get access token")
                    return@withContext false
                }

                // Step 3: Get client token
                if (!getClientToken()) {
                    Log.e(TAG, "Failed to get client token")
                    return@withContext false
                }

                Log.d(TAG, "Spotify client initialized successfully")
                true
            } catch (e: Exception) {
                Log.e(TAG, "Failed to initialize Spotify client", e)
                false
            }
        }
    }

    /**
     * Check if we have valid tokens
     */
    fun isInitialized(): Boolean {
        return accessToken != null &&
               clientToken != null &&
               System.currentTimeMillis() < tokenExpiryTime
    }

    /**
     * Get the bearer authorization header
     */
    fun getAuthorizationHeader(): String? {
        return accessToken?.let { "Bearer $it" }
    }

    /**
     * Get the client token header
     */
    fun getClientTokenHeader(): String? = clientToken

    /**
     * Get the client version
     */
    fun getClientVersion(): String = clientVersion

    /**
     * Generate TOTP code using the same algorithm as Windows app
     */
    private fun generateTOTP(): Pair<String, Int> {
        val secretList = TOTP_SECRETS[TOTP_VERSION] ?: throw IllegalStateException("No secret for version $TOTP_VERSION")

        // Transform secret: XOR each byte with ((index % 33) + 9)
        val transformed = secretList.mapIndexed { i, b ->
            (b.toInt() xor ((i % 33) + 9)).toByte()
        }.toByteArray()

        // Convert to string of integers
        val joined = transformed.map { it.toInt().and(0xFF) }.joinToString("")

        // Hex encode and decode
        val hexBytes = joined.toByteArray(Charsets.UTF_8)
        val hexStr = hexBytes.joinToString("") { String.format("%02x", it) }

        // Convert hex string to bytes
        val secretBytes = hexStr.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

        // Base32 encode (without padding)
        val base32Secret = base32Encode(secretBytes).trimEnd('=')

        // Generate TOTP code
        val totpCode = generateTOTPCode(base32Decode(base32Secret))

        return Pair(totpCode, TOTP_VERSION)
    }

    /**
     * Generate 6-digit TOTP code
     */
    private fun generateTOTPCode(secret: ByteArray): String {
        val counter = floor(System.currentTimeMillis() / 1000.0 / 30.0).toLong()
        val counterBytes = ByteArray(8)
        for (i in 7 downTo 0) {
            counterBytes[i] = (counter shr (8 * (7 - i))).toByte()
        }

        val mac = Mac.getInstance("HmacSHA1")
        mac.init(SecretKeySpec(secret, "HmacSHA1"))
        val hash = mac.doFinal(counterBytes)

        val offset = hash.last().toInt() and 0x0F
        val binary = ((hash[offset].toInt() and 0x7F) shl 24) or
                     ((hash[offset + 1].toInt() and 0xFF) shl 16) or
                     ((hash[offset + 2].toInt() and 0xFF) shl 8) or
                     (hash[offset + 3].toInt() and 0xFF)

        val otp = binary % 1000000
        return otp.toString().padStart(6, '0')
    }

    /**
     * Base32 encoding
     */
    private fun base32Encode(data: ByteArray): String {
        val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
        val result = StringBuilder()
        var buffer = 0
        var bitsLeft = 0

        for (byte in data) {
            buffer = (buffer shl 8) or (byte.toInt() and 0xFF)
            bitsLeft += 8
            while (bitsLeft >= 5) {
                bitsLeft -= 5
                result.append(alphabet[(buffer shr bitsLeft) and 0x1F])
            }
        }

        if (bitsLeft > 0) {
            result.append(alphabet[(buffer shl (5 - bitsLeft)) and 0x1F])
        }

        return result.toString()
    }

    /**
     * Base32 decoding
     */
    private fun base32Decode(data: String): ByteArray {
        val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
        val result = mutableListOf<Byte>()
        var buffer = 0
        var bitsLeft = 0

        for (char in data.uppercase()) {
            val value = alphabet.indexOf(char)
            if (value < 0) continue

            buffer = (buffer shl 5) or value
            bitsLeft += 5

            if (bitsLeft >= 8) {
                bitsLeft -= 8
                result.add((buffer shr bitsLeft).toByte())
            }
        }

        return result.toByteArray()
    }

    /**
     * Get session info from Spotify homepage
     */
    private fun getSessionInfo(): Boolean {
        try {
            val request = Request.Builder()
                .url("https://open.spotify.com")
                .addHeader("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8")
                .addHeader("Accept-Language", "en-US,en;q=0.9")
                .addHeader("User-Agent", USER_AGENT)
                .addHeader("sec-ch-ua", "\"Not(A:Brand\";v=\"8\", \"Chromium\";v=\"144\", \"Google Chrome\";v=\"144\"")
                .addHeader("sec-ch-ua-mobile", "?1")
                .addHeader("sec-ch-ua-platform", "\"Android\"")
                .addHeader("sec-fetch-dest", "document")
                .addHeader("sec-fetch-mode", "navigate")
                .addHeader("sec-fetch-site", "none")
                .addHeader("sec-fetch-user", "?1")
                .addHeader("upgrade-insecure-requests", "1")
                .get()
                .build()

            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    Log.e(TAG, "Session: ${response.code}")
                    return false
                }

                val body = response.body?.string() ?: ""

                // Extract client version from appServerConfig
                val regex = """<script id="appServerConfig" type="text/plain">([^<]+)</script>""".toRegex()
                val match = regex.find(body)
                if (match != null) {
                    try {
                        val decoded = String(Base64.decode(match.groupValues[1], Base64.DEFAULT))
                        val cfg = JSONObject(decoded)
                        clientVersion = cfg.optString("clientVersion", clientVersion)
                    } catch (e: Exception) {
                        // Use default version
                    }
                }

                // Extract device ID from sp_t cookie
                cookieStore["open.spotify.com"]?.find { it.name == "sp_t" }?.let {
                    deviceId = it.value
                }

                // If no sp_t cookie, generate a random device ID
                if (deviceId.isNullOrEmpty()) {
                    deviceId = java.util.UUID.randomUUID().toString()
                }

                Log.d(TAG, "Session OK, v=$clientVersion")
                return true
            }
        } catch (e: Exception) {
            Log.e(TAG, "Session error: ${e.message}")
            return false
        }
    }

    /**
     * Get access token using TOTP authentication
     */
    private fun getAccessToken(): Boolean {
        try {
            val (totpCode, version) = generateTOTP()

            // Use mobile-web-player like browser does on Android
            val url = "https://open.spotify.com/api/token?reason=init&productType=mobile-web-player&totp=$totpCode&totpVer=$version&totpServer=$totpCode"

            val request = Request.Builder()
                .url(url)
                .addHeader("Accept", "*/*")
                .addHeader("Accept-Language", "en-US,en;q=0.9")
                .addHeader("Referer", "https://open.spotify.com/")
                .addHeader("User-Agent", USER_AGENT)
                // Client Hints headers
                .addHeader("sec-ch-ua", "\"Not(A:Brand\";v=\"8\", \"Chromium\";v=\"144\", \"Google Chrome\";v=\"144\"")
                .addHeader("sec-ch-ua-mobile", "?1")
                .addHeader("sec-ch-ua-platform", "\"Android\"")
                .addHeader("sec-fetch-dest", "empty")
                .addHeader("sec-fetch-mode", "cors")
                .addHeader("sec-fetch-site", "same-origin")
                .get()
                .build()

            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    Log.e(TAG, "Token: ${response.code}")
                    return false
                }

                val responseBody = response.body?.string() ?: "{}"
                val json = JSONObject(responseBody)
                accessToken = json.optString("accessToken")
                clientId = json.optString("clientId")

                // Update device ID from cookie if available
                cookieStore["open.spotify.com"]?.find { it.name == "sp_t" }?.let {
                    deviceId = it.value
                }

                if (accessToken.isNullOrEmpty()) {
                    Log.e(TAG, "No accessToken")
                    return false
                }

                tokenExpiryTime = System.currentTimeMillis() + (3600 * 1000) // 1 hour
                Log.d(TAG, "Token OK")
                return true
            }
        } catch (e: Exception) {
            Log.e(TAG, "Token error: ${e.message}")
            return false
        }
    }

    /**
     * Get client token
     */
    private fun getClientToken(): Boolean {
        var connection: javax.net.ssl.HttpsURLConnection? = null
        try {
            // Generate deviceId if not available
            if (deviceId.isNullOrEmpty()) {
                deviceId = java.util.UUID.randomUUID().toString()
            }

            if (clientId.isNullOrEmpty()) {
                Log.e(TAG, "No clientId")
                return false
            }

            val payload = JSONObject().apply {
                put("client_data", JSONObject().apply {
                    put("client_version", clientVersion)
                    put("client_id", clientId)
                    put("js_sdk_data", JSONObject().apply {
                        put("device_brand", "unknown")
                        put("device_model", "unknown")
                        put("os", "android")
                        put("os_version", "13")
                        put("device_id", deviceId)
                        put("device_type", "smartphone")
                    })
                })
            }

            val payloadStr = payload.toString()

            // Use HttpURLConnection directly instead of OkHttp
            val url = java.net.URL("https://clienttoken.spotify.com/v1/clienttoken")
            connection = url.openConnection() as javax.net.ssl.HttpsURLConnection
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Origin", "https://open.spotify.com")
            connection.setRequestProperty("User-Agent", USER_AGENT)

            // Write payload
            connection.outputStream.use { os ->
                os.write(payloadStr.toByteArray(Charsets.UTF_8))
            }

            val responseCode = connection.responseCode

            if (responseCode != 200) {
                Log.e(TAG, "ClientToken: $responseCode")
                return false
            }

            val responseBody = connection.inputStream.bufferedReader().use { it.readText() }
            val json = JSONObject(responseBody)
            val responseType = json.optString("response_type")

            if (responseType != "RESPONSE_GRANTED_TOKEN_RESPONSE") {
                Log.e(TAG, "ClientToken invalid: $responseType")
                return false
            }

            val grantedToken = json.optJSONObject("granted_token")
            clientToken = grantedToken?.optString("token")

            if (clientToken.isNullOrEmpty()) {
                Log.e(TAG, "No clientToken")
                return false
            }

            Log.d(TAG, "ClientToken OK")
            return true
        } catch (e: Exception) {
            Log.e(TAG, "ClientToken error: ${e.message}")
            return false
        } finally {
            connection?.disconnect()
        }
    }

    /**
     * Make a query to the Spotify Pathfinder API
     */
    suspend fun query(payload: JSONObject): JSONObject? = withContext(Dispatchers.IO) {
        if (!isInitialized()) {
            if (!initialize()) {
                Log.e(TAG, "Init failed")
                return@withContext null
            }
        }

        try {
            // Match browser headers including Client Hints
            val request = Request.Builder()
                .url("https://api-partner.spotify.com/pathfinder/v2/query")
                .addHeader("Accept", "application/json")
                .addHeader("Accept-Language", "en-US,en;q=0.9")
                .addHeader("Authorization", "Bearer $accessToken")
                .addHeader("Client-Token", clientToken!!)
                .addHeader("Content-Type", "application/json;charset=UTF-8")
                .addHeader("Origin", "https://open.spotify.com")
                .addHeader("Referer", "https://open.spotify.com/")
                .addHeader("User-Agent", USER_AGENT)
                // Client Hints headers
                .addHeader("sec-ch-ua", "\"Not(A:Brand\";v=\"8\", \"Chromium\";v=\"144\", \"Google Chrome\";v=\"144\"")
                .addHeader("sec-ch-ua-mobile", "?1")
                .addHeader("sec-ch-ua-platform", "\"Android\"")
                .addHeader("sec-fetch-dest", "empty")
                .addHeader("sec-fetch-mode", "cors")
                .addHeader("sec-fetch-site", "same-site")
                .post(payload.toString().toRequestBody("application/json".toMediaType()))
                .build()

            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    Log.e(TAG, "Query: ${response.code}")
                    // If unauthorized, try to reinitialize
                    if (response.code == 401) {
                        accessToken = null
                        tokenExpiryTime = 0
                    }
                    return@withContext null
                }

                val responseBody = response.body?.string() ?: "{}"
                val result = JSONObject(responseBody)

                // Check for errors in response
                val errors = result.optJSONArray("errors")
                if (errors != null && errors.length() > 0) {
                    Log.e(TAG, "Query errors: ${errors.optJSONObject(0)?.optString("message")}")
                }

                result
            }
        } catch (e: Exception) {
            Log.e(TAG, "Query error: ${e.message}")
            null
        }
    }

    /**
     * Clear all cached tokens
     */
    fun clearTokens() {
        accessToken = null
        clientToken = null
        clientId = null
        deviceId = null
        tokenExpiryTime = 0
        cookieStore.clear()
    }
}
