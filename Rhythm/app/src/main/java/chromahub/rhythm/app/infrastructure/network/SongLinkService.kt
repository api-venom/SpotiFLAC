package chromahub.rhythm.app.network

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Service for SongLink integration
 * Converts Spotify track IDs to URLs for other platforms (Tidal, Qobuz, Amazon)
 */
class SongLinkService {
    companion object {
        private const val TAG = "SongLinkService"
        private const val API_URL = "https://api.song.link/v1-alpha.1/links"
        private const val SPOTIFY_BASE_URL = "https://open.spotify.com/track/"
        private const val DEEZER_API_URL = "https://api.deezer.com/track/"

        // Rate limiting
        private const val MIN_DELAY_MS = 7000L // 7 seconds between calls
        private const val RATE_LIMIT_DELAY_MS = 15000L // 15 seconds on 429
        private const val MAX_RETRIES = 3
    }

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val mutex = Mutex()
    private var lastCallTime = 0L

    /**
     * Get platform URLs from Spotify track ID
     */
    suspend fun getPlatformUrls(spotifyTrackId: String): PlatformUrls? = withContext(Dispatchers.IO) {
        mutex.withLock {
            // Rate limiting
            val timeSinceLastCall = System.currentTimeMillis() - lastCallTime
            if (timeSinceLastCall < MIN_DELAY_MS) {
                delay(MIN_DELAY_MS - timeSinceLastCall)
            }
            lastCallTime = System.currentTimeMillis()
        }

        try {
            val spotifyUrl = "$SPOTIFY_BASE_URL$spotifyTrackId"
            val url = "$API_URL?url=$spotifyUrl"
            Log.d(TAG, "Getting platform URLs for Spotify ID: $spotifyTrackId")

            var retries = 0
            while (retries < MAX_RETRIES) {
                val request = Request.Builder()
                    .url(url)
                    .get()
                    .build()

                val response = httpClient.newCall(request).execute()

                when {
                    response.isSuccessful -> {
                        val json = JSONObject(response.body()?.string() ?: "{}")
                        return@withContext parsePlatformUrls(json, spotifyTrackId)
                    }
                    response.code() == 429 -> {
                        Log.w(TAG, "Rate limited, waiting ${RATE_LIMIT_DELAY_MS}ms")
                        delay(RATE_LIMIT_DELAY_MS)
                        retries++
                    }
                    else -> {
                        Log.e(TAG, "SongLink API error: ${response.code()}")
                        return@withContext null
                    }
                }
            }

            null
        } catch (e: Exception) {
            Log.e(TAG, "Error getting platform URLs", e)
            null
        }
    }

    /**
     * Get ISRC from Deezer URL
     */
    suspend fun getIsrcFromDeezer(deezerUrl: String): String? = withContext(Dispatchers.IO) {
        try {
            // Extract track ID from Deezer URL
            val trackId = deezerUrl.split("/track/").getOrNull(1)?.split("?")?.firstOrNull()
                ?: return@withContext null

            val url = "$DEEZER_API_URL$trackId"
            Log.d(TAG, "Getting ISRC from Deezer: $trackId")

            val request = Request.Builder()
                .url(url)
                .get()
                .build()

            val response = httpClient.newCall(request).execute()

            if (response.isSuccessful) {
                val json = JSONObject(response.body()?.string() ?: "{}")
                val isrc = json.optString("isrc")
                if (isrc.isNotEmpty()) {
                    Log.d(TAG, "Got ISRC from Deezer: $isrc")
                    return@withContext isrc
                }
            }

            null
        } catch (e: Exception) {
            Log.e(TAG, "Error getting ISRC from Deezer", e)
            null
        }
    }

    /**
     * Check track availability across platforms
     */
    suspend fun checkAvailability(spotifyTrackId: String): TrackAvailability = withContext(Dispatchers.IO) {
        val urls = getPlatformUrls(spotifyTrackId)

        TrackAvailability(
            spotifyId = spotifyTrackId,
            tidalAvailable = urls?.tidalUrl != null,
            qobuzAvailable = urls?.qobuzUrl != null,
            amazonAvailable = urls?.amazonUrl != null,
            deezerAvailable = urls?.deezerUrl != null,
            tidalUrl = urls?.tidalUrl,
            qobuzUrl = urls?.qobuzUrl,
            amazonUrl = urls?.amazonUrl,
            deezerUrl = urls?.deezerUrl,
            isrc = urls?.isrc
        )
    }

    /**
     * Parse platform URLs from SongLink response
     */
    private fun parsePlatformUrls(json: JSONObject, spotifyId: String): PlatformUrls {
        val linksByPlatform = json.optJSONObject("linksByPlatform")
        val entitiesByUniqueId = json.optJSONObject("entitiesByUniqueId")

        // Extract URLs
        val tidalUrl = linksByPlatform?.optJSONObject("tidal")?.optString("url")
        val qobuzUrl = linksByPlatform?.optJSONObject("qobuz")?.optString("url")
        val amazonUrl = linksByPlatform?.optJSONObject("amazonMusic")?.optString("url")
        val deezerUrl = linksByPlatform?.optJSONObject("deezer")?.optString("url")
        val appleMusicUrl = linksByPlatform?.optJSONObject("appleMusic")?.optString("url")
        val youtubeMusicUrl = linksByPlatform?.optJSONObject("youtubeMusic")?.optString("url")

        // Extract track IDs
        val tidalId = extractTrackId(tidalUrl, "tidal.com/browse/track/", "tidal.com/track/")
        val qobuzId = extractTrackId(qobuzUrl, "open.qobuz.com/track/", "play.qobuz.com/track/")
        val amazonId = extractAmazonTrackId(amazonUrl)

        // Try to get ISRC from entities
        var isrc: String? = null
        if (entitiesByUniqueId != null) {
            val keys = entitiesByUniqueId.keys()
            while (keys.hasNext()) {
                val entity = entitiesByUniqueId.optJSONObject(keys.next())
                if (entity != null) {
                    val entityIsrc = entity.optString("isrc")
                    if (entityIsrc.isNotEmpty()) {
                        isrc = entityIsrc
                        break
                    }
                }
            }
        }

        return PlatformUrls(
            spotifyId = spotifyId,
            tidalUrl = tidalUrl?.takeIf { it.isNotEmpty() },
            tidalId = tidalId,
            qobuzUrl = qobuzUrl?.takeIf { it.isNotEmpty() },
            qobuzId = qobuzId,
            amazonUrl = amazonUrl?.takeIf { it.isNotEmpty() },
            amazonId = amazonId,
            deezerUrl = deezerUrl?.takeIf { it.isNotEmpty() },
            appleMusicUrl = appleMusicUrl?.takeIf { it.isNotEmpty() },
            youtubeMusicUrl = youtubeMusicUrl?.takeIf { it.isNotEmpty() },
            isrc = isrc
        )
    }

    /**
     * Extract track ID from URL
     */
    private fun extractTrackId(url: String?, vararg patterns: String): Long? {
        if (url.isNullOrEmpty()) return null

        for (pattern in patterns) {
            if (url.contains(pattern)) {
                val idStr = url.substringAfter(pattern).split("?").firstOrNull()?.split("/")?.firstOrNull()
                return idStr?.toLongOrNull()
            }
        }

        return null
    }

    /**
     * Extract Amazon track ID (ASIN format)
     */
    private fun extractAmazonTrackId(url: String?): String? {
        if (url.isNullOrEmpty()) return null

        // Try trackAsin parameter
        if (url.contains("trackAsin=")) {
            return url.substringAfter("trackAsin=").split("&").firstOrNull()
        }

        // Try /tracks/ path
        if (url.contains("/tracks/")) {
            return url.substringAfter("/tracks/").split("?").firstOrNull()
        }

        return null
    }
}

/**
 * Platform URLs data class
 */
data class PlatformUrls(
    val spotifyId: String,
    val tidalUrl: String?,
    val tidalId: Long?,
    val qobuzUrl: String?,
    val qobuzId: Long?,
    val amazonUrl: String?,
    val amazonId: String?,
    val deezerUrl: String?,
    val appleMusicUrl: String?,
    val youtubeMusicUrl: String?,
    val isrc: String?
)

/**
 * Track availability across platforms
 */
data class TrackAvailability(
    val spotifyId: String,
    val tidalAvailable: Boolean,
    val qobuzAvailable: Boolean,
    val amazonAvailable: Boolean,
    val deezerAvailable: Boolean,
    val tidalUrl: String?,
    val qobuzUrl: String?,
    val amazonUrl: String?,
    val deezerUrl: String?,
    val isrc: String?
)
