package chromahub.rhythm.app.network

import android.util.Base64
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Service for Tidal streaming integration
 * Provides access to lossless FLAC streams via third-party proxy APIs
 */
class TidalService {
    companion object {
        private const val TAG = "TidalService"

        // Tidal OAuth credentials (base64 decoded)
        private const val TIDAL_CLIENT_ID = "6BDSRDPK9hQEBTgU"
        private const val TIDAL_CLIENT_SECRET = "xeuPmY7nbpZ9IIbLAcQ93shka1VNheUAqN6IcszjTG8="
        private const val TIDAL_AUTH_URL = "https://auth.tidal.com/v1/oauth2/token"
        private const val TIDAL_API_URL = "https://api.tidal.com/v1"

        // Third-party proxy APIs for streaming URLs
        private val PROXY_APIS = listOf(
            "https://vogel.qqdl.site",
            "https://maus.qqdl.site",
            "https://hund.qqdl.site",
            "https://katze.qqdl.site",
            "https://wolf.qqdl.site",
            "https://tidal.kinoplus.online",
            "https://tidal-api.binimum.org",
            "https://triton.squid.wtf"
        )

        // Quality constants
        const val QUALITY_HI_RES_LOSSLESS = "HI_RES_LOSSLESS" // 24-bit FLAC
        const val QUALITY_HI_RES = "HI_RES" // 24-bit
        const val QUALITY_LOSSLESS = "LOSSLESS" // 16-bit FLAC, 44.1kHz
        const val QUALITY_HIGH = "HIGH" // AAC 320kbps

        private const val REQUEST_TIMEOUT_MS = 20000L
    }

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    private var cachedAccessToken: String? = null
    private var tokenExpiryTime: Long = 0

    /**
     * Get Tidal access token using client credentials
     */
    private suspend fun getAccessToken(): String? = withContext(Dispatchers.IO) {
        try {
            // Check cached token
            if (cachedAccessToken != null && System.currentTimeMillis() < tokenExpiryTime) {
                return@withContext cachedAccessToken
            }

            val credentials = "$TIDAL_CLIENT_ID:$TIDAL_CLIENT_SECRET"
            val encodedCredentials = Base64.encodeToString(credentials.toByteArray(), Base64.NO_WRAP)

            val request = Request.Builder()
                .url(TIDAL_AUTH_URL)
                .addHeader("Authorization", "Basic $encodedCredentials")
                .addHeader("Content-Type", "application/x-www-form-urlencoded")
                .post("client_id=$TIDAL_CLIENT_ID&grant_type=client_credentials"
                    .toRequestBody("application/x-www-form-urlencoded".toMediaType()))
                .build()

            val response = httpClient.newCall(request).execute()

            if (response.isSuccessful) {
                val json = JSONObject(response.body?.string() ?: "{}")
                val token = json.optString("access_token")
                val expiresIn = json.optInt("expires_in", 3600)

                if (token.isNotEmpty()) {
                    cachedAccessToken = token
                    tokenExpiryTime = System.currentTimeMillis() + (expiresIn - 60) * 1000
                    Log.d(TAG, "Got Tidal access token")
                    return@withContext token
                }
            }

            Log.e(TAG, "Failed to get Tidal access token: ${response.code}")
            null
        } catch (e: Exception) {
            Log.e(TAG, "Error getting Tidal access token", e)
            null
        }
    }

    /**
     * Get track info from official Tidal API
     */
    suspend fun getTrackInfo(trackId: Long): TidalTrack? = withContext(Dispatchers.IO) {
        try {
            val token = getAccessToken() ?: return@withContext null

            val request = Request.Builder()
                .url("$TIDAL_API_URL/tracks/$trackId?countryCode=US")
                .addHeader("Authorization", "Bearer $token")
                .get()
                .build()

            val response = httpClient.newCall(request).execute()

            if (response.isSuccessful) {
                val json = JSONObject(response.body?.string() ?: "{}")
                return@withContext parseTrackInfo(json)
            }

            Log.e(TAG, "Failed to get track info: ${response.code}")
            null
        } catch (e: Exception) {
            Log.e(TAG, "Error getting track info", e)
            null
        }
    }

    /**
     * Get streaming URL for a track with quality fallback
     */
    suspend fun getStreamUrl(trackId: Long, preferredQuality: String = QUALITY_LOSSLESS): StreamResult? = withContext(Dispatchers.IO) {
        val qualities = when (preferredQuality) {
            QUALITY_HI_RES_LOSSLESS -> listOf(QUALITY_HI_RES_LOSSLESS, QUALITY_LOSSLESS, QUALITY_HIGH)
            QUALITY_HI_RES -> listOf(QUALITY_HI_RES, QUALITY_LOSSLESS, QUALITY_HIGH)
            QUALITY_LOSSLESS -> listOf(QUALITY_LOSSLESS, QUALITY_HIGH)
            else -> listOf(QUALITY_HIGH)
        }

        for (quality in qualities) {
            val result = tryGetStreamUrl(trackId, quality)
            if (result != null) {
                Log.d(TAG, "Got stream URL for track $trackId at quality $quality")
                return@withContext result
            }
        }

        Log.w(TAG, "Failed to get stream URL for track $trackId at any quality")
        null
    }

    /**
     * Try to get stream URL from proxy APIs in parallel
     */
    private suspend fun tryGetStreamUrl(trackId: Long, quality: String): StreamResult? = coroutineScope {
        val shuffledApis = PROXY_APIS.shuffled()

        // Try APIs in parallel with timeout
        val results = withTimeoutOrNull(REQUEST_TIMEOUT_MS) {
            shuffledApis.map { api ->
                async(Dispatchers.IO) {
                    tryApiEndpoint(api, trackId, quality)
                }
            }.awaitAll()
        } ?: emptyList()

        // Return first successful result
        results.filterNotNull().firstOrNull()
    }

    /**
     * Try a single API endpoint
     */
    private fun tryApiEndpoint(apiBase: String, trackId: Long, quality: String): StreamResult? {
        return try {
            val url = "$apiBase/track/?id=$trackId&quality=$quality"
            Log.d(TAG, "Trying API: $url")

            val request = Request.Builder()
                .url(url)
                .get()
                .build()

            val response = httpClient.newCall(request).execute()

            if (response.isSuccessful) {
                val body = response.body?.string() ?: return null
                parseStreamResponse(body, quality)
            } else {
                Log.d(TAG, "API returned ${response.code}: $apiBase")
                null
            }
        } catch (e: Exception) {
            Log.d(TAG, "API error for $apiBase: ${e.message}")
            null
        }
    }

    /**
     * Parse stream response (handles both V1 and V2 formats)
     */
    private fun parseStreamResponse(body: String, quality: String): StreamResult? {
        return try {
            val json = JSONObject(body)

            // Try V1 format (direct URL)
            val directUrl = json.optString("OriginalTrackUrl")
            if (directUrl.isNotEmpty()) {
                return StreamResult(
                    url = directUrl,
                    quality = quality,
                    mimeType = getMimeTypeForQuality(quality),
                    isManifest = false
                )
            }

            // Try V2 format (manifest)
            val data = json.optJSONObject("data")
            if (data != null) {
                val manifest = data.optString("Manifest")
                if (manifest.isNotEmpty()) {
                    return parseManifest(manifest, quality, data)
                }
            }

            // Try URLs array
            if (json.has("urls")) {
                val urls = json.getJSONArray("urls")
                if (urls.length() > 0) {
                    return StreamResult(
                        url = urls.getString(0),
                        quality = quality,
                        mimeType = getMimeTypeForQuality(quality),
                        isManifest = false
                    )
                }
            }

            null
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing stream response", e)
            null
        }
    }

    /**
     * Parse base64 encoded manifest
     */
    private fun parseManifest(manifestB64: String, quality: String, data: JSONObject): StreamResult? {
        return try {
            val manifestBytes = Base64.decode(manifestB64, Base64.DEFAULT)
            val manifestStr = String(manifestBytes)

            // Check if it's JSON (BTS format)
            if (manifestStr.startsWith("{")) {
                val manifestJson = JSONObject(manifestStr)
                val urls = manifestJson.optJSONArray("urls")
                if (urls != null && urls.length() > 0) {
                    return StreamResult(
                        url = urls.getString(0),
                        quality = quality,
                        mimeType = manifestJson.optString("mimeType", getMimeTypeForQuality(quality)),
                        bitDepth = data.optInt("bitDepth", 16),
                        sampleRate = data.optInt("sampleRate", 44100),
                        isManifest = false
                    )
                }
            }

            // Check if it's DASH/MPD format
            if (manifestStr.contains("<MPD") || manifestStr.contains("<?xml")) {
                // For DASH, return the manifest itself
                return StreamResult(
                    url = manifestStr,
                    quality = quality,
                    mimeType = "application/dash+xml",
                    bitDepth = data.optInt("bitDepth", 16),
                    sampleRate = data.optInt("sampleRate", 44100),
                    isManifest = true
                )
            }

            null
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing manifest", e)
            null
        }
    }

    /**
     * Parse track info from JSON
     */
    private fun parseTrackInfo(json: JSONObject): TidalTrack {
        val album = json.optJSONObject("album")
        val artists = json.optJSONArray("artists")
        val artistNames = mutableListOf<String>()

        if (artists != null) {
            for (i in 0 until artists.length()) {
                artistNames.add(artists.getJSONObject(i).optString("name"))
            }
        }

        return TidalTrack(
            id = json.optLong("id"),
            title = json.optString("title"),
            artist = artistNames.joinToString(", "),
            artistNames = artistNames,
            album = album?.optString("title") ?: "",
            albumId = album?.optString("id") ?: "",
            coverUrl = album?.optString("cover")?.let {
                "https://resources.tidal.com/images/${it.replace("-", "/")}/1280x1280.jpg"
            },
            duration = json.optInt("duration"),
            trackNumber = json.optInt("trackNumber"),
            isrc = json.optString("isrc"),
            audioQuality = json.optString("audioQuality"),
            explicit = json.optBoolean("explicit"),
            releaseDate = album?.optString("releaseDate")
        )
    }

    private fun getMimeTypeForQuality(quality: String): String {
        return when (quality) {
            QUALITY_HI_RES_LOSSLESS, QUALITY_LOSSLESS -> "audio/flac"
            QUALITY_HI_RES -> "audio/flac"
            QUALITY_HIGH -> "audio/mp4"
            else -> "audio/mpeg"
        }
    }
}

/**
 * Tidal track info data class
 */
data class TidalTrack(
    val id: Long,
    val title: String,
    val artist: String,
    val artistNames: List<String>,
    val album: String,
    val albumId: String,
    val coverUrl: String?,
    val duration: Int,
    val trackNumber: Int,
    val isrc: String,
    val audioQuality: String,
    val explicit: Boolean,
    val releaseDate: String?
)

/**
 * Stream result containing URL and quality info
 */
data class StreamResult(
    val url: String,
    val quality: String,
    val mimeType: String,
    val bitDepth: Int = 16,
    val sampleRate: Int = 44100,
    val isManifest: Boolean = false
)
