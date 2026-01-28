package chromahub.rhythm.app.network

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext

/**
 * Unified Streaming Manager
 * Coordinates streaming from Tidal, Qobuz, and Amazon Music
 * Uses Spotify search for track matching via SongLink
 */
class StreamingManager(
    private val tidalService: TidalService = TidalService(),
    private val qobuzService: QobuzService = QobuzService(),
    private val amazonService: AmazonMusicService = AmazonMusicService(),
    private val songLinkService: SongLinkService = SongLinkService()
) {
    companion object {
        private const val TAG = "StreamingManager"

        // Streaming providers in priority order
        const val PROVIDER_AUTO = "auto"
        const val PROVIDER_TIDAL = "tidal"
        const val PROVIDER_QOBUZ = "qobuz"
        const val PROVIDER_AMAZON = "amazon"

        // Quality preferences
        const val QUALITY_LOSSLESS = "lossless"
        const val QUALITY_HIRES = "hires"
        const val QUALITY_HIGH = "high"
    }

    // Cache for track availability
    private val availabilityCache = mutableMapOf<String, TrackAvailability>()

    /**
     * Get stream URL for a Spotify track
     * @param spotifyId Spotify track ID
     * @param preferredProvider Provider preference (auto, tidal, qobuz, amazon)
     * @param quality Quality preference (lossless, hires, high)
     * @return UnifiedStreamResult with stream URL and metadata
     */
    suspend fun getStreamUrl(
        spotifyId: String,
        preferredProvider: String = PROVIDER_AUTO,
        quality: String = QUALITY_LOSSLESS
    ): UnifiedStreamResult? = withContext(Dispatchers.IO) {
        try {
            Log.d(TAG, "Getting stream for Spotify ID: $spotifyId, provider: $preferredProvider")

            // Get platform URLs from SongLink
            val platformUrls = availabilityCache[spotifyId]?.let {
                PlatformUrls(
                    spotifyId = it.spotifyId,
                    tidalUrl = it.tidalUrl,
                    tidalId = it.tidalUrl?.let { url -> extractTidalId(url) },
                    qobuzUrl = it.qobuzUrl,
                    qobuzId = it.qobuzUrl?.let { url -> extractQobuzId(url) },
                    amazonUrl = it.amazonUrl,
                    amazonId = it.amazonUrl?.let { url -> extractAmazonId(url) },
                    deezerUrl = it.deezerUrl,
                    appleMusicUrl = null,
                    youtubeMusicUrl = null,
                    isrc = it.isrc
                )
            } ?: songLinkService.getPlatformUrls(spotifyId)

            if (platformUrls == null) {
                Log.w(TAG, "Could not get platform URLs for Spotify ID: $spotifyId")
                return@withContext null
            }

            // Cache the availability
            availabilityCache[spotifyId] = TrackAvailability(
                spotifyId = spotifyId,
                tidalAvailable = platformUrls.tidalUrl != null,
                qobuzAvailable = platformUrls.qobuzUrl != null,
                amazonAvailable = platformUrls.amazonUrl != null,
                deezerAvailable = platformUrls.deezerUrl != null,
                tidalUrl = platformUrls.tidalUrl,
                qobuzUrl = platformUrls.qobuzUrl,
                amazonUrl = platformUrls.amazonUrl,
                deezerUrl = platformUrls.deezerUrl,
                isrc = platformUrls.isrc
            )

            // Determine provider order
            val providerOrder = when (preferredProvider) {
                PROVIDER_TIDAL -> listOf(PROVIDER_TIDAL, PROVIDER_QOBUZ, PROVIDER_AMAZON)
                PROVIDER_QOBUZ -> listOf(PROVIDER_QOBUZ, PROVIDER_TIDAL, PROVIDER_AMAZON)
                PROVIDER_AMAZON -> listOf(PROVIDER_AMAZON, PROVIDER_TIDAL, PROVIDER_QOBUZ)
                else -> listOf(PROVIDER_TIDAL, PROVIDER_AMAZON, PROVIDER_QOBUZ) // Auto priority
            }

            // Try each provider in order
            for (provider in providerOrder) {
                val result = tryProvider(provider, platformUrls, quality)
                if (result != null) {
                    Log.d(TAG, "Got stream from $provider for Spotify ID: $spotifyId")
                    return@withContext result
                }
            }

            Log.w(TAG, "No stream available for Spotify ID: $spotifyId")
            null
        } catch (e: Exception) {
            Log.e(TAG, "Error getting stream URL", e)
            null
        }
    }

    /**
     * Get stream URLs from multiple providers in parallel
     */
    suspend fun getStreamUrlsParallel(
        spotifyId: String,
        quality: String = QUALITY_LOSSLESS
    ): Map<String, UnifiedStreamResult> = coroutineScope {
        val platformUrls = songLinkService.getPlatformUrls(spotifyId) ?: return@coroutineScope emptyMap()

        val results = mutableMapOf<String, UnifiedStreamResult>()

        // Try all providers in parallel
        val tidalDeferred = async { tryProvider(PROVIDER_TIDAL, platformUrls, quality) }
        val qobuzDeferred = async { tryProvider(PROVIDER_QOBUZ, platformUrls, quality) }
        val amazonDeferred = async { tryProvider(PROVIDER_AMAZON, platformUrls, quality) }

        tidalDeferred.await()?.let { results[PROVIDER_TIDAL] = it }
        qobuzDeferred.await()?.let { results[PROVIDER_QOBUZ] = it }
        amazonDeferred.await()?.let { results[PROVIDER_AMAZON] = it }

        results
    }

    /**
     * Check track availability across platforms
     */
    suspend fun checkAvailability(spotifyId: String): TrackAvailability {
        return availabilityCache[spotifyId] ?: songLinkService.checkAvailability(spotifyId).also {
            availabilityCache[spotifyId] = it
        }
    }

    /**
     * Try a specific provider
     */
    private suspend fun tryProvider(
        provider: String,
        platformUrls: PlatformUrls,
        quality: String
    ): UnifiedStreamResult? {
        return when (provider) {
            PROVIDER_TIDAL -> tryTidal(platformUrls, quality)
            PROVIDER_QOBUZ -> tryQobuz(platformUrls, quality)
            PROVIDER_AMAZON -> tryAmazon(platformUrls)
            else -> null
        }
    }

    /**
     * Try Tidal provider
     */
    private suspend fun tryTidal(platformUrls: PlatformUrls, quality: String): UnifiedStreamResult? {
        val tidalId = platformUrls.tidalId ?: return null

        val tidalQuality = when (quality) {
            QUALITY_HIRES -> TidalService.QUALITY_HI_RES_LOSSLESS
            QUALITY_LOSSLESS -> TidalService.QUALITY_LOSSLESS
            else -> TidalService.QUALITY_HIGH
        }

        val streamResult = tidalService.getStreamUrl(tidalId, tidalQuality) ?: return null
        val trackInfo = tidalService.getTrackInfo(tidalId)

        return UnifiedStreamResult(
            streamUrl = streamResult.url,
            provider = PROVIDER_TIDAL,
            quality = streamResult.quality,
            mimeType = streamResult.mimeType,
            bitDepth = streamResult.bitDepth,
            sampleRate = streamResult.sampleRate,
            isManifest = streamResult.isManifest,
            trackInfo = trackInfo?.let {
                UnifiedTrackInfo(
                    id = it.id.toString(),
                    title = it.title,
                    artist = it.artist,
                    album = it.album,
                    coverUrl = it.coverUrl,
                    duration = it.duration,
                    isrc = it.isrc,
                    explicit = it.explicit
                )
            }
        )
    }

    /**
     * Try Qobuz provider
     */
    private suspend fun tryQobuz(platformUrls: PlatformUrls, quality: String): UnifiedStreamResult? {
        // First try by track ID
        val qobuzId = platformUrls.qobuzId

        // If no ID, try to search by ISRC
        val trackInfo = if (qobuzId != null) {
            null // We'll get track info separately if needed
        } else if (platformUrls.isrc != null) {
            qobuzService.searchByIsrc(platformUrls.isrc)
        } else if (platformUrls.deezerUrl != null) {
            // Try to get ISRC from Deezer
            val isrc = songLinkService.getIsrcFromDeezer(platformUrls.deezerUrl)
            if (isrc != null) {
                qobuzService.searchByIsrc(isrc)
            } else null
        } else null

        val trackId = qobuzId ?: trackInfo?.id ?: return null

        val qobuzQuality = when (quality) {
            QUALITY_HIRES -> QobuzService.QUALITY_HIRES_192
            QUALITY_LOSSLESS -> QobuzService.QUALITY_CD
            else -> QobuzService.QUALITY_CD
        }

        val streamResult = qobuzService.getStreamUrl(trackId, qobuzQuality) ?: return null

        return UnifiedStreamResult(
            streamUrl = streamResult.url,
            provider = PROVIDER_QOBUZ,
            quality = streamResult.quality,
            mimeType = streamResult.mimeType,
            bitDepth = streamResult.bitDepth,
            sampleRate = streamResult.sampleRate,
            isManifest = streamResult.isManifest,
            trackInfo = trackInfo?.let {
                UnifiedTrackInfo(
                    id = it.id.toString(),
                    title = it.title,
                    artist = it.artist,
                    album = it.album,
                    coverUrl = it.coverUrl,
                    duration = it.duration,
                    isrc = it.isrc,
                    explicit = false
                )
            }
        )
    }

    /**
     * Try Amazon provider
     */
    private suspend fun tryAmazon(platformUrls: PlatformUrls): UnifiedStreamResult? {
        val amazonUrl = platformUrls.amazonUrl ?: return null

        val streamResult = amazonService.getStreamUrl(amazonUrl) ?: return null

        return UnifiedStreamResult(
            streamUrl = streamResult.url,
            provider = PROVIDER_AMAZON,
            quality = streamResult.quality,
            mimeType = streamResult.mimeType,
            bitDepth = 16,
            sampleRate = 44100,
            isManifest = false,
            trackInfo = null // Amazon doesn't provide detailed track info via this API
        )
    }

    /**
     * Extract Tidal track ID from URL
     */
    private fun extractTidalId(url: String): Long? {
        val patterns = listOf("tidal.com/browse/track/", "tidal.com/track/")
        for (pattern in patterns) {
            if (url.contains(pattern)) {
                return url.substringAfter(pattern).split("?").firstOrNull()?.toLongOrNull()
            }
        }
        return null
    }

    /**
     * Extract Qobuz track ID from URL
     */
    private fun extractQobuzId(url: String): Long? {
        val patterns = listOf("open.qobuz.com/track/", "play.qobuz.com/track/")
        for (pattern in patterns) {
            if (url.contains(pattern)) {
                return url.substringAfter(pattern).split("?").firstOrNull()?.toLongOrNull()
            }
        }
        return null
    }

    /**
     * Extract Amazon track ID from URL
     */
    private fun extractAmazonId(url: String): String? {
        if (url.contains("trackAsin=")) {
            return url.substringAfter("trackAsin=").split("&").firstOrNull()
        }
        if (url.contains("/tracks/")) {
            return url.substringAfter("/tracks/").split("?").firstOrNull()
        }
        return null
    }

    /**
     * Clear the availability cache
     */
    fun clearCache() {
        availabilityCache.clear()
    }
}

/**
 * Unified stream result from any provider
 */
data class UnifiedStreamResult(
    val streamUrl: String,
    val provider: String,
    val quality: String,
    val mimeType: String,
    val bitDepth: Int = 16,
    val sampleRate: Int = 44100,
    val isManifest: Boolean = false,
    val trackInfo: UnifiedTrackInfo? = null
)

/**
 * Unified track info from any provider
 */
data class UnifiedTrackInfo(
    val id: String,
    val title: String,
    val artist: String,
    val album: String,
    val coverUrl: String?,
    val duration: Int,
    val isrc: String,
    val explicit: Boolean
)
