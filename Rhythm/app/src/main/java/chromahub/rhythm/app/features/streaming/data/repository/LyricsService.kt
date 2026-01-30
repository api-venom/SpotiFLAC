package chromahub.rhythm.app.features.streaming.data.repository

import android.util.Log
import chromahub.rhythm.app.shared.data.model.LyricsData
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlin.math.abs

/**
 * Lyrics service using HttpURLConnection for fetching lyrics
 * Supports LRCLib for synced/plain lyrics
 */
class LyricsService {
    companion object {
        private const val TAG = "LyricsService"
        private const val LRCLIB_BASE = "https://lrclib.net/api"
        private const val CONNECT_TIMEOUT = 10000
        private const val READ_TIMEOUT = 10000
    }

    /**
     * Fetch lyrics from LRCLib API
     */
    suspend fun fetchLyrics(
        artist: String,
        title: String,
        album: String? = null,
        durationSeconds: Int = 0
    ): LyricsData? = withContext(Dispatchers.IO) {
        try {
            // Clean search terms
            val cleanArtist = artist.cleanForSearch()
            val cleanTitle = title.cleanForSearch()

            // Build search URL
            val params = buildString {
                append("track_name=").append(URLEncoder.encode(cleanTitle, "UTF-8"))
                append("&artist_name=").append(URLEncoder.encode(cleanArtist, "UTF-8"))
                album?.takeIf { it.isNotBlank() }?.let {
                    append("&album_name=").append(URLEncoder.encode(it.cleanForSearch(), "UTF-8"))
                }
                if (durationSeconds > 0) {
                    append("&duration=").append(durationSeconds)
                }
            }

            val searchUrl = "$LRCLIB_BASE/search?$params"
            Log.d(TAG, "LRCLib search: $searchUrl")

            val response = httpGet(searchUrl)
            if (response == null) {
                Log.w(TAG, "LRCLib: No response")
                return@withContext null
            }

            val results = JSONArray(response)
            if (results.length() == 0) {
                Log.d(TAG, "LRCLib: No results")
                return@withContext null
            }

            // Find best match by duration
            var bestMatch: JSONObject? = null
            var minDurationDiff = Int.MAX_VALUE

            for (i in 0 until results.length()) {
                val item = results.getJSONObject(i)
                val itemDuration = item.optDouble("duration", 0.0).toInt()

                if (durationSeconds > 0) {
                    val diff = abs(itemDuration - durationSeconds)
                    if (diff < minDurationDiff) {
                        minDurationDiff = diff
                        bestMatch = item
                    }
                } else {
                    // No duration provided, use first result
                    bestMatch = item
                    break
                }
            }

            if (bestMatch == null) {
                bestMatch = results.getJSONObject(0)
            }

            val syncedLyrics = bestMatch.optString("syncedLyrics").takeIf { it.isNotBlank() }
            val plainLyrics = bestMatch.optString("plainLyrics").takeIf { it.isNotBlank() }

            Log.d(TAG, "LRCLib found: synced=${syncedLyrics != null}, plain=${plainLyrics != null}")

            if (syncedLyrics != null || plainLyrics != null) {
                LyricsData(
                    plainLyrics = plainLyrics,
                    syncedLyrics = syncedLyrics,
                    wordByWordLyrics = null
                )
            } else {
                null
            }
        } catch (e: Exception) {
            Log.e(TAG, "LRCLib error: ${e.message}")
            null
        }
    }

    /**
     * Get lyrics by exact match (more precise)
     */
    suspend fun getLyricsExact(
        artist: String,
        title: String,
        album: String,
        durationSeconds: Int
    ): LyricsData? = withContext(Dispatchers.IO) {
        try {
            val cleanArtist = artist.cleanForSearch()
            val cleanTitle = title.cleanForSearch()
            val cleanAlbum = album.cleanForSearch()

            val params = buildString {
                append("track_name=").append(URLEncoder.encode(cleanTitle, "UTF-8"))
                append("&artist_name=").append(URLEncoder.encode(cleanArtist, "UTF-8"))
                append("&album_name=").append(URLEncoder.encode(cleanAlbum, "UTF-8"))
                append("&duration=").append(durationSeconds)
            }

            val url = "$LRCLIB_BASE/get?$params"
            val response = httpGet(url)

            if (response == null) {
                return@withContext null
            }

            val json = JSONObject(response)
            val syncedLyrics = json.optString("syncedLyrics").takeIf { it.isNotBlank() }
            val plainLyrics = json.optString("plainLyrics").takeIf { it.isNotBlank() }

            if (syncedLyrics != null || plainLyrics != null) {
                LyricsData(
                    plainLyrics = plainLyrics,
                    syncedLyrics = syncedLyrics,
                    wordByWordLyrics = null
                )
            } else {
                null
            }
        } catch (e: Exception) {
            Log.e(TAG, "LRCLib exact match error: ${e.message}")
            null
        }
    }

    /**
     * HTTP GET request using HttpURLConnection with proper resource cleanup
     */
    private fun httpGet(urlString: String): String? {
        var conn: HttpURLConnection? = null
        return try {
            val url = URL(urlString)
            conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.connectTimeout = CONNECT_TIMEOUT
            conn.readTimeout = READ_TIMEOUT
            conn.setRequestProperty("User-Agent", "Rhythm/1.0")
            conn.setRequestProperty("Accept", "application/json")

            if (conn.responseCode == 200) {
                conn.inputStream.bufferedReader().use { it.readText() }
            } else {
                Log.w(TAG, "HTTP ${conn.responseCode}")
                null
            }
        } catch (e: Exception) {
            Log.e(TAG, "HTTP error: ${e.message}")
            null
        } finally {
            conn?.disconnect()
        }
    }

    /**
     * Clean string for lyrics search
     */
    private fun String.cleanForSearch(): String {
        return this
            .replace(Regex("\\s*\\(feat\\..*?\\)", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\s*\\(ft\\..*?\\)", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\s*feat\\..*", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\s*ft\\..*", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\s*\\[.*?\\]"), "")
            .replace(Regex("\\s*\\(.*?Remaster.*?\\)", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\s*\\(.*?Version.*?\\)", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\s*-\\s*Single", RegexOption.IGNORE_CASE), "")
            .trim()
    }
}
