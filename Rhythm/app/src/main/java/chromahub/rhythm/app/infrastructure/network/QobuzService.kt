package chromahub.rhythm.app.network

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Service for Qobuz streaming integration
 * Uses HttpURLConnection for API requests
 */
class QobuzService {
    companion object {
        private const val TAG = "QobuzService"

        private const val QOBUZ_APP_ID = "798273057"
        private const val QOBUZ_API_URL = "https://www.qobuz.com/api.json/0.2"

        private val STANDARD_APIS = listOf(
            "https://dab.yeet.su/api/stream?trackId=",
            "https://dabmusic.xyz/api/stream?trackId=",
            "https://qobuz.squid.wtf/api/download-music?track_id="
        )

        private const val JUMO_API = "https://jumo-dl.pages.dev/file"

        const val QUALITY_CD = 6
        const val QUALITY_HIRES_96 = 7
        const val QUALITY_HIRES_192 = 27

        private const val REQUEST_TIMEOUT_MS = 20000L
        private const val CONNECT_TIMEOUT_MS = 15000
        private const val READ_TIMEOUT_MS = 15000
    }

    suspend fun searchByIsrc(isrc: String): QobuzTrack? = withContext(Dispatchers.IO) {
        try {
            val apiUrl = "$QOBUZ_API_URL/track/search?query=$isrc&limit=1&app_id=$QOBUZ_APP_ID"
            val url = URL(apiUrl)
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = READ_TIMEOUT_MS
            }

            if (conn.responseCode == 200) {
                val body = conn.inputStream.bufferedReader().readText()
                val json = JSONObject(body)
                val tracks = json.optJSONObject("tracks")?.optJSONArray("items")

                if (tracks != null && tracks.length() > 0) {
                    return@withContext parseTrackInfo(tracks.getJSONObject(0))
                }
            }

            Log.d(TAG, "No track for ISRC: $isrc")
            null
        } catch (e: Exception) {
            Log.e(TAG, "Search error: ${e.message}")
            null
        }
    }

    suspend fun getStreamUrl(trackId: Long, preferredQuality: Int = QUALITY_CD): StreamResult? = withContext(Dispatchers.IO) {
        val qualities = when (preferredQuality) {
            QUALITY_HIRES_192 -> listOf(QUALITY_HIRES_192, QUALITY_HIRES_96, QUALITY_CD)
            QUALITY_HIRES_96 -> listOf(QUALITY_HIRES_96, QUALITY_CD)
            else -> listOf(QUALITY_CD)
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

    private suspend fun tryGetStreamUrl(trackId: Long, quality: Int): StreamResult? = coroutineScope {
        val allApis = mutableListOf<Pair<String, Boolean>>()

        STANDARD_APIS.shuffled().forEach { api ->
            allApis.add(Pair("$api$trackId&quality=$quality", false))
        }

        listOf("us", "eu").forEach { region ->
            allApis.add(Pair("$JUMO_API?track_id=$trackId&format_id=$quality&region=$region", true))
        }

        val results = withTimeoutOrNull(REQUEST_TIMEOUT_MS) {
            allApis.map { (url, isJumo) ->
                async(Dispatchers.IO) {
                    tryApiEndpoint(url, quality, isJumo)
                }
            }.awaitAll()
        } ?: emptyList()

        results.filterNotNull().firstOrNull()
    }

    private fun tryApiEndpoint(apiUrl: String, quality: Int, isJumo: Boolean): StreamResult? {
        return try {
            val url = URL(apiUrl)
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = READ_TIMEOUT_MS
            }

            if (conn.responseCode == 200) {
                val body = conn.inputStream.readBytes()
                val responseStr = if (isJumo) decodeXOR(body) else String(body)
                parseStreamResponse(responseStr, quality)
            } else {
                null
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun decodeXOR(data: ByteArray): String {
        val text = String(data)
        val result = StringBuilder()

        for ((i, char) in text.withIndex()) {
            val key = ((i * 17) % 128).toChar()
            result.append((char.code xor 253 xor key.code).toChar())
        }

        return result.toString()
    }

    private fun parseStreamResponse(body: String, quality: Int): StreamResult? {
        return try {
            val json = JSONObject(body)

            val bitDepth = if (quality >= QUALITY_HIRES_96) 24 else 16
            val sampleRate = when (quality) {
                QUALITY_HIRES_192 -> 192000
                QUALITY_HIRES_96 -> 96000
                else -> 44100
            }

            val url = json.optString("url")
            if (url.isNotEmpty()) {
                return StreamResult(
                    url = url,
                    quality = getQualityName(quality),
                    mimeType = "audio/flac",
                    bitDepth = bitDepth,
                    sampleRate = sampleRate,
                    isManifest = false
                )
            }

            val data = json.optJSONObject("data")
            if (data != null) {
                val dataUrl = data.optString("url")
                if (dataUrl.isNotEmpty()) {
                    return StreamResult(
                        url = dataUrl,
                        quality = getQualityName(quality),
                        mimeType = "audio/flac",
                        bitDepth = bitDepth,
                        sampleRate = sampleRate,
                        isManifest = false
                    )
                }
            }

            val link = json.optString("link")
            if (link.isNotEmpty()) {
                return StreamResult(
                    url = link,
                    quality = getQualityName(quality),
                    mimeType = "audio/flac",
                    bitDepth = bitDepth,
                    sampleRate = sampleRate,
                    isManifest = false
                )
            }

            val directLink = json.optString("direct_link")
            if (directLink.isNotEmpty()) {
                return StreamResult(
                    url = directLink,
                    quality = getQualityName(quality),
                    mimeType = "audio/flac",
                    bitDepth = bitDepth,
                    sampleRate = sampleRate,
                    isManifest = false
                )
            }

            null
        } catch (e: Exception) {
            null
        }
    }

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
}

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
