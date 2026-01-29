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

        private const val USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"
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
            return cookieStore[url.host] ?: emptyList()
        }
    }

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .cookieJar(cookieJar)
        .followRedirects(true)
        .build()

    // Separate client without cookies for client token request (like Go app)
    private val plainHttpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .followRedirects(true)
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
            Log.d(TAG, "Starting getSessionInfo...")
            // Match Windows Go app exactly - only User-Agent header
            val request = Request.Builder()
                .url("https://open.spotify.com")
                .addHeader("User-Agent", USER_AGENT)
                .get()
                .build()

            val response = httpClient.newCall(request).execute()

            Log.d(TAG, "Session info response code: ${response.code}")

            if (!response.isSuccessful) {
                Log.e(TAG, "Session info request failed: ${response.code}")
                return false
            }

            val body = response.body?.string() ?: ""
            Log.d(TAG, "Session info body length: ${body.length}")

            // Extract client version from appServerConfig
            val regex = """<script id="appServerConfig" type="text/plain">([^<]+)</script>""".toRegex()
            val match = regex.find(body)
            if (match != null) {
                try {
                    val decoded = String(Base64.decode(match.groupValues[1], Base64.DEFAULT))
                    val cfg = JSONObject(decoded)
                    clientVersion = cfg.optString("clientVersion", clientVersion)
                    Log.d(TAG, "Got client version: $clientVersion")
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to parse client version", e)
                }
            } else {
                Log.w(TAG, "Could not find appServerConfig in response, using default clientVersion: $clientVersion")
            }

            // Extract device ID from sp_t cookie
            val storedCookies = cookieStore["open.spotify.com"]
            Log.d(TAG, "Stored cookies for open.spotify.com: ${storedCookies?.map { it.name } ?: "none"}")

            storedCookies?.find { it.name == "sp_t" }?.let {
                deviceId = it.value
                Log.d(TAG, "Got device ID from cookie: ${deviceId?.take(10)}...")
            }

            // If no sp_t cookie, generate a random device ID (like Windows app fallback)
            if (deviceId.isNullOrEmpty()) {
                deviceId = java.util.UUID.randomUUID().toString()
                Log.d(TAG, "Generated random device ID: ${deviceId?.take(10)}...")
            }

            return true
        } catch (e: Exception) {
            Log.e(TAG, "Error getting session info", e)
            return false
        }
    }

    /**
     * Get access token using TOTP authentication
     */
    private fun getAccessToken(): Boolean {
        try {
            Log.d(TAG, "Starting getAccessToken...")
            val (totpCode, version) = generateTOTP()
            Log.d(TAG, "Generated TOTP: $totpCode, version: $version")

            // Use mobile-web-player like browser does on Android
            val url = "https://open.spotify.com/api/token?reason=init&productType=mobile-web-player&totp=$totpCode&totpVer=$version&totpServer=$totpCode"

            val request = Request.Builder()
                .url(url)
                .addHeader("User-Agent", USER_AGENT)
                .addHeader("Accept", "*/*")
                .addHeader("Referer", "https://open.spotify.com/")
                .get()
                .build()

            val response = httpClient.newCall(request).execute()

            Log.d(TAG, "Access token response code: ${response.code}")

            if (!response.isSuccessful) {
                val errorBody = response.body?.string()
                Log.e(TAG, "Access token request failed: ${response.code}, body: ${errorBody?.take(200)}")
                return false
            }

            val responseBody = response.body?.string() ?: "{}"
            Log.d(TAG, "Access token response length: ${responseBody.length}")
            val json = JSONObject(responseBody)
            accessToken = json.optString("accessToken")
            clientId = json.optString("clientId")

            Log.d(TAG, "Parsed accessToken: ${if (accessToken.isNullOrEmpty()) "EMPTY" else "${accessToken?.take(10)}..."}")
            Log.d(TAG, "Parsed clientId: $clientId")

            // Update device ID from cookie if available
            cookieStore["open.spotify.com"]?.find { it.name == "sp_t" }?.let {
                deviceId = it.value
                Log.d(TAG, "Updated device ID from cookie after token request")
            }

            if (accessToken.isNullOrEmpty()) {
                Log.e(TAG, "No access token in response. Full response: ${responseBody.take(500)}")
                return false
            }

            tokenExpiryTime = System.currentTimeMillis() + (3600 * 1000) // 1 hour
            Log.d(TAG, "Got access token successfully, expires at: $tokenExpiryTime")
            return true
        } catch (e: Exception) {
            Log.e(TAG, "Error getting access token", e)
            return false
        }
    }

    /**
     * Get client token
     */
    private fun getClientToken(): Boolean {
        try {
            Log.d(TAG, "Starting getClientToken...")
            Log.d(TAG, "clientId: ${clientId?.take(10)}..., deviceId: ${deviceId?.take(10)}..., clientVersion: $clientVersion")

            // Generate deviceId if not available
            if (deviceId.isNullOrEmpty()) {
                deviceId = java.util.UUID.randomUUID().toString()
                Log.d(TAG, "Generated fallback device ID: ${deviceId?.take(10)}...")
            }

            if (clientId.isNullOrEmpty()) {
                Log.e(TAG, "Missing clientId for client token request")
                return false
            }

            val payload = JSONObject().apply {
                put("client_data", JSONObject().apply {
                    put("client_version", clientVersion)
                    put("client_id", clientId)
                    put("js_sdk_data", JSONObject().apply {
                        put("device_brand", "unknown")
                        put("device_model", "unknown")
                        put("os", "windows")
                        put("os_version", "NT 10.0")
                        put("device_id", deviceId)
                        put("device_type", "computer")
                    })
                })
            }

            Log.d(TAG, "Client token payload: ${payload.toString()}")

            // Add Origin header like browser does
            val request = Request.Builder()
                .url("https://clienttoken.spotify.com/v1/clienttoken")
                .addHeader("Content-Type", "application/json")
                .addHeader("Accept", "application/json")
                .addHeader("User-Agent", USER_AGENT)
                .addHeader("Origin", "https://open.spotify.com")
                .addHeader("Referer", "https://open.spotify.com/")
                .post(payload.toString().toRequestBody("application/json".toMediaType()))
                .build()

            // Use plain client (no cookies needed for different domain)
            val response = plainHttpClient.newCall(request).execute()

            Log.d(TAG, "Client token response code: ${response.code}")

            if (!response.isSuccessful) {
                val errorBody = response.body?.string()
                Log.e(TAG, "Client token request failed: ${response.code}, body: ${errorBody}")
                return false
            }

            val responseBody = response.body?.string() ?: "{}"
            Log.d(TAG, "Client token response: ${responseBody.take(200)}")
            val json = JSONObject(responseBody)
            val responseType = json.optString("response_type")

            Log.d(TAG, "Client token response_type: $responseType")

            if (responseType != "RESPONSE_GRANTED_TOKEN_RESPONSE") {
                Log.e(TAG, "Invalid client token response type: $responseType. Full response: ${responseBody.take(500)}")
                return false
            }

            val grantedToken = json.optJSONObject("granted_token")
            clientToken = grantedToken?.optString("token")

            if (clientToken.isNullOrEmpty()) {
                Log.e(TAG, "No client token in response. Full response: ${responseBody.take(500)}")
                return false
            }

            Log.d(TAG, "Got client token: ${clientToken?.take(10)}...")
            return true
        } catch (e: Exception) {
            Log.e(TAG, "Error getting client token", e)
            return false
        }
    }

    /**
     * Make a query to the Spotify Pathfinder API
     */
    suspend fun query(payload: JSONObject): JSONObject? = withContext(Dispatchers.IO) {
        if (!isInitialized()) {
            Log.d(TAG, "Not initialized, attempting to initialize...")
            if (!initialize()) {
                Log.e(TAG, "Failed to initialize, cannot query")
                return@withContext null
            }
        }

        try {
            Log.d(TAG, "Sending query to Pathfinder API: ${payload.optString("operationName")}")
            // Match browser headers
            val request = Request.Builder()
                .url("https://api-partner.spotify.com/pathfinder/v2/query")
                .addHeader("Accept", "application/json")
                .addHeader("Accept-Language", "en")
                .addHeader("Authorization", "Bearer $accessToken")
                .addHeader("Client-Token", clientToken!!)
                .addHeader("Content-Type", "application/json;charset=UTF-8")
                .addHeader("Origin", "https://open.spotify.com")
                .addHeader("Referer", "https://open.spotify.com/")
                .addHeader("User-Agent", USER_AGENT)
                .post(payload.toString().toRequestBody("application/json".toMediaType()))
                .build()

            val response = httpClient.newCall(request).execute()

            Log.d(TAG, "Query response code: ${response.code}")

            if (!response.isSuccessful) {
                val errorBody = response.body?.string()
                Log.e(TAG, "Query failed: ${response.code}. Error body: ${errorBody?.take(500)}")
                // If unauthorized, try to reinitialize
                if (response.code == 401) {
                    Log.d(TAG, "Got 401, clearing tokens for re-auth")
                    accessToken = null
                    tokenExpiryTime = 0
                }
                return@withContext null
            }

            val responseBody = response.body?.string() ?: "{}"
            Log.d(TAG, "Query response length: ${responseBody.length}")

            val result = JSONObject(responseBody)

            // Check for errors in response
            val errors = result.optJSONArray("errors")
            if (errors != null && errors.length() > 0) {
                val firstError = errors.optJSONObject(0)
                val errorMessage = firstError?.optString("message")
                Log.e(TAG, "Query returned errors: $errorMessage")
            }

            result
        } catch (e: Exception) {
            Log.e(TAG, "Error making query", e)
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
