package chromahub.rhythm.app.network

import android.util.Base64
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import javax.net.ssl.HttpsURLConnection

/**
 * Service for Tidal streaming integration
 * Uses HttpURLConnection for API requests
 */
class TidalService {
    companion object {
        private const val TAG = "TidalService"

        private const val TIDAL_CLIENT_ID = "6BDSRDPK9hQEBTgU"
        private const val TIDAL_CLIENT_SECRET = "xeuPmY7nbpZ9IIbLAcQ93shka1VNheUAqN6IcszjTG8="
        private const val TIDAL_AUTH_URL = "https://auth.tidal.com/v1/oauth2/token"
        private const val TIDAL_API_URL = "https://api.tidal.com/v1"

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

        const val QUALITY_HI_RES_LOSSLESS = "HI_RES_LOSSLESS"
        const val QUALITY_HI_RES = "HI_RES"
        const val QUALITY_LOSSLESS = "LOSSLESS"
        const val QUALITY_HIGH = "HIGH"

        private const val REQUEST_TIMEOUT_MS = 20000L
        private const val CONNECT_TIMEOUT_MS = 15000
        private const val READ_TIMEOUT_MS = 15000
    }

    private var cachedAccessToken: String? = null
    private var tokenExpiryTime: Long = 0

    private suspend fun getAccessToken(): String? = withContext(Dispatchers.IO) {
        try {
            if (cachedAccessToken != null && System.currentTimeMillis() < tokenExpiryTime) {
                return@withContext cachedAccessToken
            }

            val credentials = "$TIDAL_CLIENT_ID:$TIDAL_CLIENT_SECRET"
            val encodedCredentials = Base64.encodeToString(credentials.toByteArray(), Base64.NO_WRAP)

            val url = URL(TIDAL_AUTH_URL)
            val conn = (url.openConnection() as HttpsURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = READ_TIMEOUT_MS
                setRequestProperty("Authorization", "Basic $encodedCredentials")
                setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
            }

            conn.outputStream.use { os ->
                OutputStreamWriter(os).use { writer ->
                    writer.write("client_id=$TIDAL_CLIENT_ID&grant_type=client_credentials")
                }
            }

            if (conn.responseCode == 200) {
                val body = conn.inputStream.bufferedReader().readText()
                val json = JSONObject(body)
                val token = json.optString("access_token")
                val expiresIn = json.optInt("expires_in", 3600)

                if (token.isNotEmpty()) {
                    cachedAccessToken = token
                    tokenExpiryTime = System.currentTimeMillis() + (expiresIn - 60) * 1000
                    return@withContext token
                }
            }

            Log.e(TAG, "Auth: ${conn.responseCode}")
            null
        } catch (e: Exception) {
            Log.e(TAG, "Auth error: ${e.message}")
            null
        }
    }

    suspend fun getTrackInfo(trackId: Long): TidalTrack? = withContext(Dispatchers.IO) {
        try {
            val token = getAccessToken() ?: return@withContext null

            val url = URL("$TIDAL_API_URL/tracks/$trackId?countryCode=US")
            val conn = (url.openConnection() as HttpsURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = READ_TIMEOUT_MS
                setRequestProperty("Authorization", "Bearer $token")
            }

            if (conn.responseCode == 200) {
                val body = conn.inputStream.bufferedReader().readText()
                return@withContext parseTrackInfo(JSONObject(body))
            }

            Log.e(TAG, "TrackInfo: ${conn.responseCode}")
            null
        } catch (e: Exception) {
            Log.e(TAG, "TrackInfo error: ${e.message}")
            null
        }
    }

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
                return@withContext result
            }
        }

        Log.w(TAG, "No stream for $trackId")
        null
    }

    private suspend fun tryGetStreamUrl(trackId: Long, quality: String): StreamResult? = coroutineScope {
        val shuffledApis = PROXY_APIS.shuffled()

        val results = withTimeoutOrNull(REQUEST_TIMEOUT_MS) {
            shuffledApis.map { api ->
                async(Dispatchers.IO) {
                    tryApiEndpoint(api, trackId, quality)
                }
            }.awaitAll()
        } ?: emptyList()

        results.filterNotNull().firstOrNull()
    }

    private fun tryApiEndpoint(apiBase: String, trackId: Long, quality: String): StreamResult? {
        return try {
            val apiUrl = "$apiBase/track/?id=$trackId&quality=$quality"
            val url = URL(apiUrl)
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = READ_TIMEOUT_MS
            }

            if (conn.responseCode == 200) {
                val body = conn.inputStream.bufferedReader().readText()
                parseStreamResponse(body, quality)
            } else {
                null
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun parseStreamResponse(body: String, quality: String): StreamResult? {
        return try {
            // Try as JSONObject
            try {
                val json = JSONObject(body)

                val directUrl = json.optString("OriginalTrackUrl")
                if (directUrl.isNotEmpty()) {
                    return StreamResult(
                        url = directUrl,
                        quality = quality,
                        mimeType = getMimeTypeForQuality(quality),
                        isManifest = false
                    )
                }

                val data = json.optJSONObject("data")
                if (data != null) {
                    val manifest = data.optString("Manifest")
                    if (manifest.isNotEmpty()) {
                        return parseManifest(manifest, quality, data)
                    }
                }

                if (json.has("urls")) {
                    val urls = json.getJSONArray("urls")
                    if (urls.length() > 0) {
                        return StreamResult(
                            url = urls.getString(0),
                            quality = quality,
                            mimeType = json.optString("mimeType", getMimeTypeForQuality(quality)),
                            isManifest = false
                        )
                    }
                }

                val url = json.optString("url")
                if (url.isNotEmpty()) {
                    return StreamResult(
                        url = url,
                        quality = quality,
                        mimeType = getMimeTypeForQuality(quality),
                        isManifest = false
                    )
                }
            } catch (e: Exception) {
                // Not a JSON object
            }

            // Try as JSON array
            try {
                val jsonArray = org.json.JSONArray(body)
                for (i in 0 until jsonArray.length()) {
                    val item = jsonArray.getJSONObject(i)
                    val originalTrackUrl = item.optString("OriginalTrackUrl")
                    if (originalTrackUrl.isNotEmpty()) {
                        return StreamResult(
                            url = originalTrackUrl,
                            quality = quality,
                            mimeType = getMimeTypeForQuality(quality),
                            isManifest = false
                        )
                    }
                }
            } catch (e: Exception) {
                // Not a JSON array
            }

            null
        } catch (e: Exception) {
            null
        }
    }

    private fun parseManifest(manifestB64: String, quality: String, data: JSONObject): StreamResult? {
        return try {
            val manifestBytes = Base64.decode(manifestB64, Base64.DEFAULT)
            val manifestStr = String(manifestBytes)

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

            if (manifestStr.contains("<MPD") || manifestStr.contains("<?xml")) {
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
            null
        }
    }

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
            QUALITY_HI_RES_LOSSLESS, QUALITY_LOSSLESS, QUALITY_HI_RES -> "audio/flac"
            QUALITY_HIGH -> "audio/mp4"
            else -> "audio/mpeg"
        }
    }
}

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

data class StreamResult(
    val url: String,
    val quality: String,
    val mimeType: String,
    val bitDepth: Int = 16,
    val sampleRate: Int = 44100,
    val isManifest: Boolean = false
)
