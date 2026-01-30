package chromahub.rhythm.app.features.streaming.presentation.viewmodel

import android.app.Application
import android.content.Intent
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import chromahub.rhythm.app.features.streaming.data.repository.LyricsService
import chromahub.rhythm.app.features.streaming.data.repository.SpotifyAuthManager
import chromahub.rhythm.app.features.streaming.data.repository.StreamingRepository
import chromahub.rhythm.app.features.streaming.domain.model.StreamingSong
import chromahub.rhythm.app.infrastructure.service.MediaPlaybackService
import chromahub.rhythm.app.shared.data.model.LyricsData
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * ViewModel for streaming functionality
 * Handles search, stream URL fetching, and playback state
 */
class StreamingViewModel(application: Application) : AndroidViewModel(application) {
    companion object {
        private const val TAG = "StreamingVM"
        private const val SEARCH_DEBOUNCE_MS = 500L
    }

    private val authManager = SpotifyAuthManager()
    private val repository = StreamingRepository(authManager)
    private val lyricsService = LyricsService()

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
     * Fetch lyrics for a streaming song using HttpURLConnection-based LyricsService
     */
    private fun fetchLyricsForSong(song: StreamingSong) {
        lyricsJob?.cancel()
        lyricsJob = viewModelScope.launch {
            _isLoadingLyrics.value = true
            _currentLyrics.value = null

            try {
                val lyrics = lyricsService.fetchLyrics(
                    artist = song.artist,
                    title = song.title,
                    album = song.album,
                    durationSeconds = (song.duration / 1000).toInt()
                )
                _currentLyrics.value = lyrics
                Log.d(TAG, "Lyrics: ${lyrics?.hasLyrics() == true}")
            } catch (e: CancellationException) {
                // Job cancelled, don't log as error - this is normal during navigation
                Log.d(TAG, "Lyrics fetch cancelled")
            } catch (e: Exception) {
                Log.e(TAG, "Lyrics error: ${e.message}")
                _currentLyrics.value = null
            } finally {
                _isLoadingLyrics.value = false
            }
        }
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
