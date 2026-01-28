package chromahub.rhythm.app.network

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Service for Amazon Music streaming integration
 * Uses AfkarXYZ proxy for stream URL resolution
 */
class AmazonMusicService {
    companion object {
        private const val TAG = "AmazonMusicService"
        private const val AFKARXYZ_API = "https://amazon.afkarxyz.fun/convert"
    }

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(60, TimeUnit.SECONDS) // Amazon can be slow
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    /**
     * Get streaming URL from Amazon Music URL
     */
    suspend fun getStreamUrl(amazonUrl: String): AmazonStreamResult? = withContext(Dispatchers.IO) {
        try {
            // Normalize the Amazon URL to track format
            val normalizedUrl = normalizeAmazonUrl(amazonUrl)
            Log.d(TAG, "Getting stream URL for: $normalizedUrl")

            val url = "$AFKARXYZ_API?url=$normalizedUrl"

            val request = Request.Builder()
                .url(url)
                .get()
                .build()

            val response = httpClient.newCall(request).execute()

            if (response.isSuccessful) {
                val json = JSONObject(response.body?.string() ?: "{}")

                if (json.optBoolean("success", false)) {
                    val data = json.optJSONObject("data")
                    if (data != null) {
                        val directLink = data.optString("direct_link")
                        if (directLink.isNotEmpty()) {
                            Log.d(TAG, "Got Amazon stream URL")
                            return@withContext AmazonStreamResult(
                                url = directLink,
                                fileName = data.optString("file_name"),
                                fileSize = data.optLong("file_size", 0),
                                quality = "LOSSLESS", // Amazon HD is typically FLAC
                                mimeType = "audio/flac"
                            )
                        }
                    }
                }

                Log.w(TAG, "Amazon API returned unsuccessful response")
            } else {
                Log.e(TAG, "Amazon API error: ${response.code}")
            }

            null
        } catch (e: Exception) {
            Log.e(TAG, "Error getting Amazon stream URL", e)
            null
        }
    }

    /**
     * Normalize Amazon URL to track format
     */
    private fun normalizeAmazonUrl(url: String): String {
        // Handle trackAsin parameter format
        if (url.contains("trackAsin=")) {
            val parts = url.split("trackAsin=")
            if (parts.size > 1) {
                val trackAsin = parts[1].split("&").firstOrNull()
                if (!trackAsin.isNullOrEmpty()) {
                    return "https://music.amazon.com/tracks/$trackAsin?musicTerritory=US"
                }
            }
        }

        // Handle /albums/ format with trackAsin
        if (url.contains("/albums/") && url.contains("trackAsin=")) {
            val trackAsin = url.substringAfter("trackAsin=").split("&").firstOrNull()
            if (!trackAsin.isNullOrEmpty()) {
                return "https://music.amazon.com/tracks/$trackAsin?musicTerritory=US"
            }
        }

        // Already in /tracks/ format
        if (url.contains("/tracks/")) {
            return url
        }

        return url
    }
}

/**
 * Amazon stream result data class
 */
data class AmazonStreamResult(
    val url: String,
    val fileName: String,
    val fileSize: Long,
    val quality: String,
    val mimeType: String
)
