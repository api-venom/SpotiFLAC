package chromahub.rhythm.app.network

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Service for Qobuz streaming integration
 * Provides access to lossless FLAC streams via third-party proxy APIs
 */
class QobuzService {
    companion object {
        private const val TAG = "QobuzService"

        // Qobuz public app ID for API access
        private const val QOBUZ_APP_ID = "798273057"
        private const val QOBUZ_API_URL = "https://www.qobuz.com/api.json/0.2"

        // Third-party proxy APIs for streaming URLs
        private val STANDARD_APIS = listOf(
            "https://dab.yeet.su/api/stream?trackId=",
            "https://dabmusic.xyz/api/stream?trackId=",
            "https://qobuz.squid.wtf/api/download-music?track_id="
        )

        // Jumo-DL API (uses XOR encoding)
        private const val JUMO_API = "https://jumo-dl.pages.dev/file"

        // Quality format IDs
        const val QUALITY_CD = 6      // 16-bit, 44.1kHz (CD Quality)
        const val QUALITY_HIRES_96 = 7   // 24-bit, up to 96kHz
        const val QUALITY_HIRES_192 = 27 // 24-bit, up to 192kHz

        private const val REQUEST_TIMEOUT_MS = 20000L
    }

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    /**
     * Search for a track by ISRC
     */
    suspend fun searchByIsrc(isrc: String): QobuzTrack? = withContext(Dispatchers.IO) {
        try {
            val url = "$QOBUZ_API_URL/track/search?query=$isrc&limit=1&app_id=$QOBUZ_APP_ID"
            Log.d(TAG, "Searching Qobuz by ISRC: $isrc")

            val request = Request.Builder()
                .url(url)
                .get()
                .build()

            val response = httpClient.newCall(request).execute()

            if (response.isSuccessful) {
                val json = JSONObject(response.body?.string() ?: "{}")
                val tracks = json.optJSONObject("tracks")?.optJSONArray("items")

                if (tracks != null && tracks.length() > 0) {
                    return@withContext parseTrackInfo(tracks.getJSONObject(0))
                }
            }

            Log.d(TAG, "No Qobuz track found for ISRC: $isrc")
            null
        } catch (e: Exception) {
            Log.e(TAG, "Error searching Qobuz", e)
            null
        }
    }

    /**
     * Get streaming URL for a track with quality fallback
     */
    suspend fun getStreamUrl(trackId: Long, preferredQuality: Int = QUALITY_CD): StreamResult? = withContext(Dispatchers.IO) {
        val qualities = when (preferredQuality) {
            QUALITY_HIRES_192 -> listOf(QUALITY_HIRES_192, QUALITY_HIRES_96, QUALITY_CD)
            QUALITY_HIRES_96 -> listOf(QUALITY_HIRES_96, QUALITY_CD)
            else -> listOf(QUALITY_CD)
        }

        for (quality in qualities) {
            val result = tryGetStreamUrl(trackId, quality)
            if (result != null) {
                Log.d(TAG, "Got Qobuz stream URL for track $trackId at quality $quality")
                return@withContext result
            }
        }

        Log.w(TAG, "Failed to get Qobuz stream URL for track $trackId at any quality")
        null
    }

    /**
     * Try to get stream URL from proxy APIs in parallel
     */
    private suspend fun tryGetStreamUrl(trackId: Long, quality: Int): StreamResult? = coroutineScope {
        val allApis = mutableListOf<Pair<String, Boolean>>()

        // Add standard APIs (direct URL pattern)
        STANDARD_APIS.shuffled().forEach { api ->
            allApis.add(Pair("$api$trackId&quality=$quality", false))
        }

        // Add Jumo API
        listOf("us", "eu").forEach { region ->
            allApis.add(Pair("$JUMO_API?track_id=$trackId&format_id=$quality&region=$region", true))
        }

        // Try APIs in parallel with timeout
        val results = withTimeoutOrNull(REQUEST_TIMEOUT_MS) {
            allApis.map { (url, isJumo) ->
                async(Dispatchers.IO) {
                    tryApiEndpoint(url, quality, isJumo)
                }
            }.awaitAll()
        } ?: emptyList()

        // Return first successful result
        results.filterNotNull().firstOrNull()
    }

    /**
     * Try a single API endpoint
     */
    private fun tryApiEndpoint(url: String, quality: Int, isJumo: Boolean): StreamResult? {
        return try {
            Log.d(TAG, "Trying Qobuz API: $url")

            val request = Request.Builder()
                .url(url)
                .get()
                .build()

            val response = httpClient.newCall(request).execute()

            if (response.isSuccessful) {
                val body = response.body?.bytes() ?: return null

                val responseStr = if (isJumo) {
                    decodeXOR(body)
                } else {
                    String(body)
                }

                parseStreamResponse(responseStr, quality)
            } else {
                Log.d(TAG, "Qobuz API returned ${response.code}: $url")
                null
            }
        } catch (e: Exception) {
            Log.d(TAG, "Qobuz API error for $url: ${e.message}")
            null
        }
    }

    /**
     * Decode XOR-encoded response from Jumo API
     */
    private fun decodeXOR(data: ByteArray): String {
        val text = String(data)
        val result = StringBuilder()

        for ((i, char) in text.withIndex()) {
            val key = ((i * 17) % 128).toChar()
            result.append((char.code xor 253 xor key.code).toChar())
        }

        return result.toString()
    }

    /**
     * Parse stream response
     */
    private fun parseStreamResponse(body: String, quality: Int): StreamResult? {
        return try {
            val json = JSONObject(body)

            // Try standard URL field
            val url = json.optString("url")
            if (url.isNotEmpty()) {
                return StreamResult(
                    url = url,
                    quality = getQualityName(quality),
                    mimeType = getMimeTypeForQuality(quality),
                    bitDepth = if (quality >= QUALITY_HIRES_96) 24 else 16,
                    sampleRate = when (quality) {
                        QUALITY_HIRES_192 -> 192000
                        QUALITY_HIRES_96 -> 96000
                        else -> 44100
                    },
                    isManifest = false
                )
            }

            // Try direct_link field
            val directLink = json.optString("direct_link")
            if (directLink.isNotEmpty()) {
                return StreamResult(
                    url = directLink,
                    quality = getQualityName(quality),
                    mimeType = getMimeTypeForQuality(quality),
                    bitDepth = if (quality >= QUALITY_HIRES_96) 24 else 16,
                    sampleRate = 44100,
                    isManifest = false
                )
            }

            null
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing Qobuz stream response", e)
            null
        }
    }

    /**
     * Parse track info from JSON
     */
    private fun parseTrackInfo(json: JSONObject): QobuzTrack {
        val album = json.optJSONObject("album")
        val performer = json.optJSONObject("performer")
        val albumArtist = album?.optJSONObject("artist")
        val albumImage = album?.optJSONObject("image")

        return QobuzTrack(
            id = json.optLong("id"),
            title = json.optString("title"),
            version = json.optString("version"),
            artist = performer?.optString("name") ?: "",
            artistId = performer?.optLong("id") ?: 0,
            album = album?.optString("title") ?: "",
            albumId = album?.optString("id") ?: "",
            albumArtist = albumArtist?.optString("name") ?: "",
            coverUrl = albumImage?.optString("large") ?: albumImage?.optString("small"),
            duration = json.optInt("duration"),
            trackNumber = json.optInt("track_number"),
            discNumber = json.optInt("media_number"),
            isrc = json.optString("isrc"),
            hires = json.optBoolean("hires"),
            hiresStreamable = json.optBoolean("hires_streamable"),
            maxBitDepth = json.optInt("maximum_bit_depth"),
            maxSampleRate = json.optDouble("maximum_sampling_rate"),
            releaseDate = json.optString("release_date_original"),
            copyright = json.optString("copyright"),
            label = album?.optJSONObject("label")?.optString("name") ?: ""
        )
    }

    private fun getQualityName(quality: Int): String {
        return when (quality) {
            QUALITY_HIRES_192 -> "HI_RES_192"
            QUALITY_HIRES_96 -> "HI_RES_96"
            QUALITY_CD -> "CD_QUALITY"
            else -> "UNKNOWN"
        }
    }

    private fun getMimeTypeForQuality(quality: Int): String {
        return "audio/flac" // Qobuz always serves FLAC
    }
}

/**
 * Qobuz track info data class
 */
data class QobuzTrack(
    val id: Long,
    val title: String,
    val version: String,
    val artist: String,
    val artistId: Long,
    val album: String,
    val albumId: String,
    val albumArtist: String,
    val coverUrl: String?,
    val duration: Int,
    val trackNumber: Int,
    val discNumber: Int,
    val isrc: String,
    val hires: Boolean,
    val hiresStreamable: Boolean,
    val maxBitDepth: Int,
    val maxSampleRate: Double,
    val releaseDate: String?,
    val copyright: String,
    val label: String
)
