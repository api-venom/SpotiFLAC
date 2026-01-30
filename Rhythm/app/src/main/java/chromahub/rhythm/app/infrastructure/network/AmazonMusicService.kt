package chromahub.rhythm.app.network

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Service for Amazon Music streaming integration
 * Uses HttpURLConnection for API requests
 */
class AmazonMusicService {
    companion object {
        private const val TAG = "AmazonMusicService"
        private const val AFKARXYZ_API = "https://amazon.afkarxyz.fun/convert"
        private const val CONNECT_TIMEOUT_MS = 60000
        private const val READ_TIMEOUT_MS = 60000
    }

    suspend fun getStreamUrl(amazonUrl: String): AmazonStreamResult? = withContext(Dispatchers.IO) {
        try {
            val normalizedUrl = normalizeAmazonUrl(amazonUrl)
            val apiUrl = "$AFKARXYZ_API?url=$normalizedUrl"

            val url = URL(apiUrl)
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = READ_TIMEOUT_MS
            }

            if (conn.responseCode == 200) {
                val body = conn.inputStream.bufferedReader().readText()
                val json = JSONObject(body)

                if (json.optBoolean("success", false)) {
                    val data = json.optJSONObject("data")
                    if (data != null) {
                        val directLink = data.optString("direct_link")
                        if (directLink.isNotEmpty()) {
                            return@withContext AmazonStreamResult(
                                url = directLink,
                                fileName = data.optString("file_name"),
                                fileSize = data.optLong("file_size", 0),
                                quality = "LOSSLESS",
                                mimeType = "audio/flac"
                            )
                        }
                    }
                }
            }

            Log.w(TAG, "No stream: ${conn.responseCode}")
            null
        } catch (e: Exception) {
            Log.e(TAG, "Error: ${e.message}")
            null
        }
    }

    private fun normalizeAmazonUrl(url: String): String {
        if (url.contains("trackAsin=")) {
            val parts = url.split("trackAsin=")
            if (parts.size > 1) {
                val trackAsin = parts[1].split("&").firstOrNull()
                if (!trackAsin.isNullOrEmpty()) {
                    return "https://music.amazon.com/tracks/$trackAsin?musicTerritory=US"
                }
            }
        }

        if (url.contains("/albums/") && url.contains("trackAsin=")) {
            val trackAsin = url.substringAfter("trackAsin=").split("&").firstOrNull()
            if (!trackAsin.isNullOrEmpty()) {
                return "https://music.amazon.com/tracks/$trackAsin?musicTerritory=US"
            }
        }

        return url
    }
}

data class AmazonStreamResult(
    val url: String,
    val fileName: String,
    val fileSize: Long,
    val quality: String,
    val mimeType: String
)
