package chromahub.rhythm.app.features.streaming.domain.model

import chromahub.rhythm.app.core.domain.model.PlayableItem
import chromahub.rhythm.app.core.domain.model.SourceType

/**
 * Represents a song from streaming services (Tidal, Qobuz, Amazon)
 * Implements PlayableItem to integrate with the existing player
 */
data class StreamingSong(
    override val id: String,
    override val title: String,
    override val artist: String,
    override val album: String,
    override val duration: Long,
    override val artworkUri: String?,
    val spotifyId: String,
    val streamUrl: String? = null,
    val provider: String? = null,
    val quality: String? = null,
    val mimeType: String = "audio/flac",
    val bitDepth: Int = 16,
    val sampleRate: Int = 44100,
    val isrc: String? = null,
    val releaseDate: String? = null,
    val explicit: Boolean = false,
    val popularity: Int = 0
) : PlayableItem {

    override val sourceType: SourceType
        get() = when (provider?.lowercase()) {
            "tidal" -> SourceType.TIDAL
            "qobuz" -> SourceType.QOBUZ
            "amazon" -> SourceType.AMAZON_MUSIC
            else -> SourceType.SPOTIFY
        }

    override fun getPlaybackUri(): String {
        return streamUrl ?: ""
    }

    fun hasStreamUrl(): Boolean = !streamUrl.isNullOrEmpty()

    fun getQualityDisplay(): String {
        return when {
            quality?.contains("HI_RES", ignoreCase = true) == true -> "Hi-Res ${bitDepth}-bit/${sampleRate/1000}kHz"
            quality?.contains("LOSSLESS", ignoreCase = true) == true -> "FLAC ${bitDepth}-bit"
            quality?.contains("CD", ignoreCase = true) == true -> "CD Quality"
            else -> quality ?: "High Quality"
        }
    }

    companion object {
        fun fromSpotifyTrack(
            spotifyId: String,
            name: String,
            artists: String,
            album: String,
            albumArt: String?,
            durationMs: Long,
            releaseDate: String? = null,
            explicit: Boolean = false,
            popularity: Int = 0
        ): StreamingSong {
            return StreamingSong(
                id = "spotify:$spotifyId",
                title = name,
                artist = artists,
                album = album,
                duration = durationMs,
                artworkUri = albumArt,
                spotifyId = spotifyId,
                releaseDate = releaseDate,
                explicit = explicit,
                popularity = popularity
            )
        }
    }
}
