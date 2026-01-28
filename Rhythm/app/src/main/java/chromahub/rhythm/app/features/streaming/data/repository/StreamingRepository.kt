package chromahub.rhythm.app.features.streaming.data.repository

import android.util.Log
import chromahub.rhythm.app.features.streaming.domain.model.StreamingSong
import chromahub.rhythm.app.network.NetworkClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/**
 * Repository for streaming functionality
 * Handles Spotify search (via Pathfinder API like Windows) and fetching stream URLs
 */
class StreamingRepository(
    private val authManager: SpotifyAuthManager
) {
    companion object {
        private const val TAG = "StreamingRepository"

        // Search query hash (same as Windows app)
        private const val SEARCH_HASH = "fcad5a3e0d5af727fb76966f06971c19cfa2275e6ff7671196753e008611873c"
    }

    /**
     * Search for tracks using Spotify Pathfinder API (like Windows app)
     */
    suspend fun searchTracks(query: String, limit: Int = 20): List<StreamingSong> = withContext(Dispatchers.IO) {
        if (query.isBlank()) {
            return@withContext emptyList()
        }

        try {
            val payload = JSONObject().apply {
                put("variables", JSONObject().apply {
                    put("searchTerm", query)
                    put("offset", 0)
                    put("limit", limit)
                    put("numberOfTopResults", 5)
                    put("includeAudiobooks", true)
                    put("includeArtistHasConcertsField", false)
                    put("includePreReleases", true)
                    put("includeAuthors", false)
                })
                put("operationName", "searchDesktop")
                put("extensions", JSONObject().apply {
                    put("persistedQuery", JSONObject().apply {
                        put("version", 1)
                        put("sha256Hash", SEARCH_HASH)
                    })
                })
            }

            val response = authManager.query(payload)
            if (response == null) {
                Log.e(TAG, "Search query failed")
                return@withContext emptyList()
            }

            parseSearchResults(response)
        } catch (e: Exception) {
            Log.e(TAG, "Error searching tracks", e)
            emptyList()
        }
    }

    /**
     * Parse search results from Pathfinder API response
     */
    private fun parseSearchResults(response: JSONObject): List<StreamingSong> {
        val results = mutableListOf<StreamingSong>()

        try {
            val data = response.optJSONObject("data") ?: return results
            val searchV2 = data.optJSONObject("searchV2") ?: return results
            val tracksResult = searchV2.optJSONObject("tracksV2") ?: return results
            val items = tracksResult.optJSONArray("items") ?: return results

            for (i in 0 until items.length()) {
                val item = items.optJSONObject(i) ?: continue
                val itemData = item.optJSONObject("item") ?: continue
                val track = parseTrack(itemData)
                if (track != null) {
                    results.add(track)
                }
            }

            Log.d(TAG, "Parsed ${results.size} tracks from search")
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing search results", e)
        }

        return results
    }

    /**
     * Parse a single track from the API response
     */
    private fun parseTrack(item: JSONObject): StreamingSong? {
        try {
            // Get track ID from URI (spotify:track:xxx)
            val uri = item.optString("uri", "")
            val spotifyId = uri.removePrefix("spotify:track:")
            if (spotifyId.isEmpty() || spotifyId == uri) {
                return null
            }

            val name = item.optString("name", "")
            if (name.isEmpty()) return null

            // Parse duration
            val contentRating = item.optJSONObject("contentRating")
            val durationMs = item.optJSONObject("duration")?.optLong("totalMilliseconds")
                ?: item.optLong("duration_ms", 0)

            // Parse artists
            val artists = mutableListOf<String>()
            val artistsData = item.optJSONObject("artists")
            val artistItems = artistsData?.optJSONArray("items") ?: JSONArray()
            for (j in 0 until artistItems.length()) {
                val artist = artistItems.optJSONObject(j)
                val profile = artist?.optJSONObject("profile")
                val artistName = profile?.optString("name") ?: artist?.optString("name", "")
                if (!artistName.isNullOrEmpty()) {
                    artists.add(artistName)
                }
            }

            // Parse album
            val albumData = item.optJSONObject("albumOfTrack")
            val albumName = albumData?.optString("name", "") ?: ""

            // Parse cover image
            val coverArt = albumData?.optJSONObject("coverArt")
            val sources = coverArt?.optJSONArray("sources")
            var albumArt: String? = null

            // Get largest image
            if (sources != null) {
                var maxWidth = 0
                for (j in 0 until sources.length()) {
                    val source = sources.optJSONObject(j)
                    val width = source?.optInt("width", 0) ?: 0
                    val url = source?.optString("url", "")
                    if (width > maxWidth && !url.isNullOrEmpty()) {
                        maxWidth = width
                        albumArt = url
                    }
                }
            }

            // Parse release date
            val releaseDate = albumData?.optJSONObject("date")?.let { date ->
                "${date.optInt("year", 0)}-${date.optInt("month", 1).toString().padStart(2, '0')}-${date.optInt("day", 1).toString().padStart(2, '0')}"
            }

            // Check explicit
            val isExplicit = contentRating?.optString("label") == "EXPLICIT"

            return StreamingSong(
                id = "spotify:$spotifyId",
                title = name,
                artist = artists.joinToString(", "),
                album = albumName,
                duration = durationMs,
                artworkUri = albumArt,
                spotifyId = spotifyId,
                releaseDate = releaseDate,
                explicit = isExplicit
            )
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing track", e)
            return null
        }
    }

    /**
     * Get stream URL for a track
     * Tries Tidal, Qobuz, and Amazon Music in order of preference
     */
    suspend fun getStreamUrl(song: StreamingSong): StreamingSong = withContext(Dispatchers.IO) {
        try {
            val streamingManager = NetworkClient.streamingManager
            if (streamingManager == null) {
                Log.e(TAG, "Streaming manager not available")
                return@withContext song
            }

            val preferredProvider = NetworkClient.getPreferredStreamingProvider()
            val preferredQuality = NetworkClient.getPreferredStreamingQuality()

            Log.d(TAG, "Getting stream URL for ${song.title} - provider: $preferredProvider, quality: $preferredQuality")

            val result = streamingManager.getStreamUrl(
                spotifyId = song.spotifyId,
                preferredProvider = preferredProvider,
                quality = preferredQuality
            )

            if (result != null) {
                Log.d(TAG, "Got stream URL from ${result.provider}: ${result.quality}")
                return@withContext song.copy(
                    streamUrl = result.streamUrl,
                    provider = result.provider,
                    quality = result.quality,
                    mimeType = result.mimeType,
                    bitDepth = result.bitDepth,
                    sampleRate = result.sampleRate,
                    isrc = result.trackInfo?.isrc ?: song.isrc
                )
            }

            Log.w(TAG, "No stream URL found for ${song.title}")
            song
        } catch (e: Exception) {
            Log.e(TAG, "Error getting stream URL", e)
            song
        }
    }

    /**
     * Check track availability across platforms
     */
    suspend fun checkAvailability(spotifyId: String): Map<String, Boolean> = withContext(Dispatchers.IO) {
        try {
            val streamingManager = NetworkClient.streamingManager
            if (streamingManager == null) {
                return@withContext emptyMap()
            }

            val availability = streamingManager.checkAvailability(spotifyId)
            mapOf(
                "tidal" to availability.tidalAvailable,
                "qobuz" to availability.qobuzAvailable,
                "amazon" to availability.amazonAvailable,
                "deezer" to availability.deezerAvailable
            )
        } catch (e: Exception) {
            Log.e(TAG, "Error checking availability", e)
            emptyMap()
        }
    }
}
