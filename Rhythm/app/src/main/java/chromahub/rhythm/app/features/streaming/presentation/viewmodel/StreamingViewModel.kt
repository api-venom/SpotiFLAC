package chromahub.rhythm.app.features.streaming.presentation.viewmodel

import android.app.Application
import android.content.Intent
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import chromahub.rhythm.app.features.streaming.data.repository.SpotifyAuthManager
import chromahub.rhythm.app.features.streaming.data.repository.StreamingRepository
import chromahub.rhythm.app.features.streaming.domain.model.StreamingSong
import chromahub.rhythm.app.network.AppleMusicApiService
import chromahub.rhythm.app.network.LRCLibApiService
import chromahub.rhythm.app.infrastructure.service.MediaPlaybackService
import chromahub.rhythm.app.shared.data.model.LyricsData
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

/**
 * ViewModel for streaming functionality
 * Handles search, stream URL fetching, and playback state
 */
class StreamingViewModel(application: Application) : AndroidViewModel(application) {
    companion object {
        private const val TAG = "StreamingViewModel"
        private const val SEARCH_DEBOUNCE_MS = 500L
        private const val LRCLIB_BASE_URL = "https://lrclib.net/"
        private const val APPLE_MUSIC_BASE_URL = "https://apic.musixmatch.com/"
    }

    private val authManager = SpotifyAuthManager()
    private val repository = StreamingRepository(authManager)

    // HTTP client for lyrics APIs
    private val okHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    // LRCLib API for line-synced lyrics
    private val lrcLibApi: LRCLibApiService = Retrofit.Builder()
        .baseUrl(LRCLIB_BASE_URL)
        .client(okHttpClient)
        .addConverterFactory(GsonConverterFactory.create())
        .build()
        .create(LRCLibApiService::class.java)

    // Apple Music API for word-by-word lyrics
    private val appleMusicApi: AppleMusicApiService = Retrofit.Builder()
        .baseUrl(APPLE_MUSIC_BASE_URL)
        .client(okHttpClient)
        .addConverterFactory(GsonConverterFactory.create())
        .build()
        .create(AppleMusicApiService::class.java)

    // Search state
    private val _searchQuery = MutableStateFlow("")
    val searchQuery: StateFlow<String> = _searchQuery.asStateFlow()

    private val _searchResults = MutableStateFlow<List<StreamingSong>>(emptyList())
    val searchResults: StateFlow<List<StreamingSong>> = _searchResults.asStateFlow()

    private val _isSearching = MutableStateFlow(false)
    val isSearching: StateFlow<Boolean> = _isSearching.asStateFlow()

    private val _searchError = MutableStateFlow<String?>(null)
    val searchError: StateFlow<String?> = _searchError.asStateFlow()

    // Current song state
    private val _currentSong = MutableStateFlow<StreamingSong?>(null)
    val currentSong: StateFlow<StreamingSong?> = _currentSong.asStateFlow()

    private val _isLoadingStream = MutableStateFlow(false)
    val isLoadingStream: StateFlow<Boolean> = _isLoadingStream.asStateFlow()

    // Lyrics state
    private val _currentLyrics = MutableStateFlow<LyricsData?>(null)
    val currentLyrics: StateFlow<LyricsData?> = _currentLyrics.asStateFlow()

    private val _isLoadingLyrics = MutableStateFlow(false)
    val isLoadingLyrics: StateFlow<Boolean> = _isLoadingLyrics.asStateFlow()

    private val _lyricsTimeOffset = MutableStateFlow(0)
    val lyricsTimeOffset: StateFlow<Int> = _lyricsTimeOffset.asStateFlow()

    // Queue
    private val _queue = MutableStateFlow<List<StreamingSong>>(emptyList())
    val queue: StateFlow<List<StreamingSong>> = _queue.asStateFlow()

    private val _currentIndex = MutableStateFlow(0)
    val currentIndex: StateFlow<Int> = _currentIndex.asStateFlow()

    // Search history
    private val _searchHistory = MutableStateFlow<List<String>>(emptyList())
    val searchHistory: StateFlow<List<String>> = _searchHistory.asStateFlow()

    private var searchJob: Job? = null
    private var lyricsJob: Job? = null

    /**
     * Update search query with debounce
     */
    fun updateSearchQuery(query: String) {
        _searchQuery.value = query
        _searchError.value = null

        searchJob?.cancel()

        if (query.isBlank()) {
            _searchResults.value = emptyList()
            _isSearching.value = false
            return
        }

        searchJob = viewModelScope.launch {
            delay(SEARCH_DEBOUNCE_MS)
            performSearch(query)
        }
    }

    /**
     * Perform search immediately
     */
    fun search(query: String) {
        if (query.isBlank()) return

        _searchQuery.value = query
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            performSearch(query)
        }
    }

    private suspend fun performSearch(query: String) {
        _isSearching.value = true
        _searchError.value = null

        try {
            val results = repository.searchTracks(query)
            _searchResults.value = results

            if (results.isEmpty()) {
                _searchError.value = "No results found"
            } else {
                // Add to search history
                addToSearchHistory(query)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Search error", e)
            _searchError.value = "Search failed: ${e.message}"
        } finally {
            _isSearching.value = false
        }
    }

    /**
     * Play a song - fetches stream URL and starts playback
     */
    fun playSong(song: StreamingSong, playQueue: List<StreamingSong>? = null) {
        viewModelScope.launch {
            _isLoadingStream.value = true

            try {
                // Set the queue
                val songQueue = playQueue ?: listOf(song)
                _queue.value = songQueue
                _currentIndex.value = songQueue.indexOf(song).coerceAtLeast(0)

                // Fetch stream URL if not already available
                val songWithStream = if (song.hasStreamUrl()) {
                    song
                } else {
                    repository.getStreamUrl(song)
                }

                if (songWithStream.hasStreamUrl()) {
                    _currentSong.value = songWithStream
                    Log.d(TAG, "Ready to play: ${songWithStream.title} via ${songWithStream.provider}")

                    // Start playback through MediaPlaybackService
                    startPlayback(songWithStream)

                    // Fetch lyrics in parallel
                    fetchLyricsForSong(songWithStream)
                } else {
                    _searchError.value = "Could not get stream URL for ${song.title}"
                    Log.e(TAG, "No stream URL available for ${song.title}")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error playing song", e)
                _searchError.value = "Playback error: ${e.message}"
            } finally {
                _isLoadingStream.value = false
            }
        }
    }

    /**
     * Start playback through MediaPlaybackService
     */
    private fun startPlayback(song: StreamingSong) {
        val context = getApplication<Application>()
        val intent = Intent(context, MediaPlaybackService::class.java).apply {
            action = MediaPlaybackService.ACTION_PLAY_STREAMING
            putExtra(MediaPlaybackService.EXTRA_STREAM_URL, song.streamUrl)
            putExtra(MediaPlaybackService.EXTRA_SONG_TITLE, song.title)
            putExtra(MediaPlaybackService.EXTRA_SONG_ARTIST, song.artist)
            putExtra(MediaPlaybackService.EXTRA_SONG_ALBUM, song.album)
            putExtra(MediaPlaybackService.EXTRA_ARTWORK_URL, song.artworkUri)
            putExtra(MediaPlaybackService.EXTRA_SONG_ID, song.id)
            putExtra(MediaPlaybackService.EXTRA_SONG_DURATION, song.duration)
        }
        context.startService(intent)
        Log.d(TAG, "Started MediaPlaybackService for: ${song.title}")
    }

    /**
     * Play next song in queue
     */
    fun playNext() {
        val queue = _queue.value
        val currentIdx = _currentIndex.value

        if (currentIdx < queue.size - 1) {
            val nextSong = queue[currentIdx + 1]
            _currentIndex.value = currentIdx + 1
            playSong(nextSong, queue)
        }
    }

    /**
     * Play previous song in queue
     */
    fun playPrevious() {
        val queue = _queue.value
        val currentIdx = _currentIndex.value

        if (currentIdx > 0) {
            val prevSong = queue[currentIdx - 1]
            _currentIndex.value = currentIdx - 1
            playSong(prevSong, queue)
        }
    }

    /**
     * Add to search history
     */
    private fun addToSearchHistory(query: String) {
        val current = _searchHistory.value.toMutableList()
        current.remove(query)
        current.add(0, query)
        if (current.size > 10) {
            current.removeAt(current.lastIndex)
        }
        _searchHistory.value = current
    }

    /**
     * Clear search history
     */
    fun clearSearchHistory() {
        _searchHistory.value = emptyList()
    }

    /**
     * Clear current search
     */
    fun clearSearch() {
        _searchQuery.value = ""
        _searchResults.value = emptyList()
        _searchError.value = null
        searchJob?.cancel()
    }

    /**
     * Clear error
     */
    fun clearError() {
        _searchError.value = null
    }

    /**
     * Set lyrics time offset for manual sync adjustment
     */
    fun setLyricsTimeOffset(offset: Int) {
        _lyricsTimeOffset.value = offset
    }

    /**
     * Fetch lyrics for a streaming song
     */
    private fun fetchLyricsForSong(song: StreamingSong) {
        lyricsJob?.cancel()
        lyricsJob = viewModelScope.launch {
            _isLoadingLyrics.value = true
            _currentLyrics.value = null

            try {
                val lyrics = withContext(Dispatchers.IO) {
                    fetchLyricsFromApis(song.artist, song.title, song.duration.toInt() / 1000)
                }
                _currentLyrics.value = lyrics
                Log.d(TAG, "Lyrics fetched: ${lyrics?.hasLyrics() ?: false}")
            } catch (e: Exception) {
                Log.e(TAG, "Error fetching lyrics", e)
                _currentLyrics.value = null
            } finally {
                _isLoadingLyrics.value = false
            }
        }
    }

    /**
     * Fetch lyrics from available APIs
     * Tries Apple Music (word-by-word) first, then LRCLib (line-synced)
     */
    private suspend fun fetchLyricsFromApis(
        artist: String,
        title: String,
        durationSeconds: Int
    ): LyricsData? {
        var syncedLyrics: String? = null
        var plainLyrics: String? = null
        var wordByWordLyrics: String? = null

        // Try LRCLib first for synced lyrics
        try {
            val lrcResults = lrcLibApi.searchLyrics(
                trackName = title.cleanForSearch(),
                artistName = artist.cleanForSearch(),
                duration = durationSeconds
            )

            if (lrcResults.isNotEmpty()) {
                // Find best match by duration if provided
                val bestMatch = if (durationSeconds > 0) {
                    lrcResults.minByOrNull {
                        kotlin.math.abs((it.duration ?: 0.0) - durationSeconds)
                    }
                } else {
                    lrcResults.firstOrNull()
                }

                syncedLyrics = bestMatch?.syncedLyrics
                plainLyrics = bestMatch?.plainLyrics
                Log.d(TAG, "LRCLib found: synced=${syncedLyrics != null}, plain=${plainLyrics != null}")
            }
        } catch (e: Exception) {
            Log.e(TAG, "LRCLib search failed", e)
        }

        // Try Apple Music for word-by-word lyrics
        try {
            val searchQuery = "$artist $title"
            val appleMusicResults = appleMusicApi.searchSongs(searchQuery)

            if (appleMusicResults.isNotEmpty()) {
                // Find best match
                val bestMatch = appleMusicResults.firstOrNull { result ->
                    result.songName?.contains(title, ignoreCase = true) == true ||
                    title.contains(result.songName ?: "", ignoreCase = true)
                } ?: appleMusicResults.firstOrNull()

                bestMatch?.id?.let { trackId ->
                    val lyricsResponse = appleMusicApi.getLyrics(trackId)
                    if (lyricsResponse.content?.isNotEmpty() == true) {
                        // Convert to JSON string for storage
                        wordByWordLyrics = com.google.gson.Gson().toJson(lyricsResponse.content)
                        Log.d(TAG, "Apple Music word-by-word lyrics found")
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Apple Music lyrics fetch failed", e)
        }

        // Return combined lyrics data if any source succeeded
        return if (syncedLyrics != null || plainLyrics != null || wordByWordLyrics != null) {
            LyricsData(
                plainLyrics = plainLyrics,
                syncedLyrics = syncedLyrics,
                wordByWordLyrics = wordByWordLyrics
            )
        } else {
            null
        }
    }

    /**
     * Clean string for search - removes feat., ft., etc.
     */
    private fun String.cleanForSearch(): String {
        return this
            .replace(Regex("\\s*\\(feat\\..*?\\)", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\s*\\(ft\\..*?\\)", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\s*feat\\..*", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\s*ft\\..*", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\s*\\[.*?\\]"), "")
            .trim()
    }

    /**
     * Retry fetching lyrics for current song
     */
    fun retryFetchLyrics() {
        _currentSong.value?.let { song ->
            fetchLyricsForSong(song)
        }
    }
}
