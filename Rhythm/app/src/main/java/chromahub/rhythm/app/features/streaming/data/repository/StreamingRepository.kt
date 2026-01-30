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

        // Query hashes (same as Windows app)
        private const val SEARCH_HASH = "fcad5a3e0d5af727fb76966f06971c19cfa2275e6ff7671196753e008611873c"
        private const val TRACK_HASH = "612585ae06ba435ad26369870deaae23b5c8800a256cd8a57e08eddc25a37294"
        private const val ALBUM_HASH = "b9bfabef66ed756e5e13f68a942deb60bd4125ec1f1be8cc42769dc0259b4b10"
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
                Log.e(TAG, "Search failed")
                return@withContext emptyList()
            }

            val results = parseSearchResults(response)
            Log.d(TAG, "Search: ${results.size} results")
            results
        } catch (e: Exception) {
            Log.e(TAG, "Search error: ${e.message}")
            emptyList()
        }
    }

    /**
     * Parse search results from Pathfinder API response
     */
    private fun parseSearchResults(response: JSONObject): List<StreamingSong> {
        val results = mutableListOf<StreamingSong>()

        try {
            val items = response
                .optJSONObject("data")
                ?.optJSONObject("searchV2")
                ?.optJSONObject("tracksV2")
                ?.optJSONArray("items") ?: return results

            for (i in 0 until items.length()) {
                val item = items.optJSONObject(i) ?: continue
                val itemData = item.optJSONObject("item")?.optJSONObject("data") ?: continue
                val track = parseTrack(itemData)
                if (track != null) {
                    results.add(track)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Parse error: ${e.message}")
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
            return null
        }
    }

    /**
     * Get stream URL for a track
     */
    suspend fun getStreamUrl(song: StreamingSong): StreamingSong = withContext(Dispatchers.IO) {
        try {
            val streamingManager = NetworkClient.streamingManager ?: return@withContext song

            val result = streamingManager.getStreamUrl(
                spotifyId = song.spotifyId,
                preferredProvider = NetworkClient.getPreferredStreamingProvider(),
                quality = NetworkClient.getPreferredStreamingQuality()
            )

            if (result != null) {
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

            Log.w(TAG, "No stream: ${song.title}")
            song
        } catch (e: Exception) {
            Log.e(TAG, "Stream error: ${e.message}")
            song
        }
    }

    /**
     * Check track availability across platforms
     */
    suspend fun checkAvailability(spotifyId: String): Map<String, Boolean> = withContext(Dispatchers.IO) {
        try {
            val streamingManager = NetworkClient.streamingManager ?: return@withContext emptyMap()
            val availability = streamingManager.checkAvailability(spotifyId)
            mapOf(
                "tidal" to availability.tidalAvailable,
                "qobuz" to availability.qobuzAvailable,
                "amazon" to availability.amazonAvailable,
                "deezer" to availability.deezerAvailable
            )
        } catch (e: Exception) {
            emptyMap()
        }
    }

    /**
     * Fetch full track metadata
     */
    suspend fun fetchTrackMetadata(spotifyId: String): StreamingSong? = withContext(Dispatchers.IO) {
        try {
            val payload = JSONObject().apply {
                put("variables", JSONObject().apply {
                    put("uri", "spotify:track:$spotifyId")
                })
                put("operationName", "getTrack")
                put("extensions", JSONObject().apply {
                    put("persistedQuery", JSONObject().apply {
                        put("version", 1)
                        put("sha256Hash", TRACK_HASH)
                    })
                })
            }

            val response = authManager.query(payload) ?: return@withContext null
            parseTrackUnion(response, spotifyId)
        } catch (e: Exception) {
            Log.e(TAG, "Metadata error: ${e.message}")
            null
        }
    }

    /**
     * Parse trackUnion response
     */
    private suspend fun parseTrackUnion(response: JSONObject, spotifyId: String): StreamingSong? {
        try {
            val data = response.optJSONObject("data") ?: return null
            val trackUnion = data.optJSONObject("trackUnion") ?: return null

            val name = trackUnion.optString("name", "")
            if (name.isEmpty()) return null

            // Parse duration
            val durationMs = trackUnion.optJSONObject("duration")?.optLong("totalMilliseconds")
                ?: trackUnion.optLong("duration_ms", 0)

            // Parse artists (try multiple locations like Windows app)
            val artists = mutableListOf<String>()

            // Try artists.items
            val artistsData = trackUnion.optJSONObject("artists")
            val artistItems = artistsData?.optJSONArray("items") ?: JSONArray()
            for (i in 0 until artistItems.length()) {
                val artist = artistItems.optJSONObject(i)
                val profile = artist?.optJSONObject("profile")
                val artistName = profile?.optString("name") ?: artist?.optString("name", "")
                if (!artistName.isNullOrEmpty()) {
                    artists.add(artistName)
                }
            }

            // Fallback: try firstArtist and otherArtists
            if (artists.isEmpty()) {
                val firstArtistItems = trackUnion.optJSONObject("firstArtist")?.optJSONArray("items") ?: JSONArray()
                for (i in 0 until firstArtistItems.length()) {
                    val artist = firstArtistItems.optJSONObject(i)
                    val profile = artist?.optJSONObject("profile")
                    val artistName = profile?.optString("name", "") ?: ""
                    if (artistName.isNotEmpty()) {
                        artists.add(artistName)
                    }
                }

                val otherArtistItems = trackUnion.optJSONObject("otherArtists")?.optJSONArray("items") ?: JSONArray()
                for (i in 0 until otherArtistItems.length()) {
                    val artist = otherArtistItems.optJSONObject(i)
                    val profile = artist?.optJSONObject("profile")
                    val artistName = profile?.optString("name", "") ?: ""
                    if (artistName.isNotEmpty()) {
                        artists.add(artistName)
                    }
                }
            }

            // Parse album
            val albumOfTrack = trackUnion.optJSONObject("albumOfTrack")
            val albumName = albumOfTrack?.optString("name", "") ?: ""
            val albumId = albumOfTrack?.optString("uri", "")?.removePrefix("spotify:album:") ?: ""

            // Parse cover image
            var albumArt: String? = null
            val coverArt = albumOfTrack?.optJSONObject("coverArt")
            val sources = coverArt?.optJSONArray("sources")
            if (sources != null) {
                var maxWidth = 0
                for (i in 0 until sources.length()) {
                    val source = sources.optJSONObject(i)
                    val width = source?.optInt("width", 0) ?: 0
                    val url = source?.optString("url", "")
                    if (width > maxWidth && !url.isNullOrEmpty()) {
                        maxWidth = width
                        albumArt = url
                    }
                }
            }

            // Parse release date from album
            val releaseDate = albumOfTrack?.optJSONObject("date")?.let { date ->
                val year = date.optInt("year", 0)
                val month = date.optInt("month", 1)
                val day = date.optInt("day", 1)
                if (year > 0) "$year-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}" else null
            }

            // Parse explicit
            val contentRating = trackUnion.optJSONObject("contentRating")
            val isExplicit = contentRating?.optString("label") == "EXPLICIT"

            // Parse track number
            val trackNumber = trackUnion.optInt("trackNumber", 0)
            val discNumber = trackUnion.optInt("discNumber", 1)

            // Parse playcount
            val playcount = trackUnion.optString("playcount", "0").toLongOrNull() ?: 0

            return StreamingSong(
                id = "spotify:$spotifyId",
                title = name,
                artist = artists.joinToString(", "),
                album = albumName,
                duration = durationMs,
                artworkUri = albumArt,
                spotifyId = spotifyId,
                releaseDate = releaseDate,
                explicit = isExplicit,
                popularity = (playcount / 1000000).toInt().coerceIn(0, 100) // Rough popularity
            )
        } catch (e: Exception) {
            return null
        }
    }
}
