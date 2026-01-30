package chromahub.rhythm.app.features.streaming.presentation.viewmodel

import android.app.Application
import android.content.Context
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
import org.json.JSONArray
import org.json.JSONObject

/**
 * ViewModel for streaming functionality
 * Handles search, stream URL fetching, and playback state
 */
class StreamingViewModel(application: Application) : AndroidViewModel(application) {
    companion object {
        private const val TAG = "StreamingVM"
        private const val SEARCH_DEBOUNCE_MS = 500L
        private const val PREFS_NAME = "streaming_prefs"
        private const val KEY_SEARCH_HISTORY = "search_history"
        private const val KEY_RECENTLY_PLAYED = "recently_played"
        private const val KEY_QUEUE = "queue"
        private const val KEY_QUEUE_INDEX = "queue_index"
        private const val KEY_SHUFFLE_MODE = "shuffle_mode"
        private const val KEY_REPEAT_MODE = "repeat_mode"
        private const val MAX_HISTORY_SIZE = 15
        private const val MAX_RECENTLY_PLAYED = 30
        private const val MAX_QUEUE_SIZE = 100
    }

    private val prefs = application.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
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

    // Shuffle mode
    private val _shuffleEnabled = MutableStateFlow(false)
    val shuffleEnabled: StateFlow<Boolean> = _shuffleEnabled.asStateFlow()

    // Repeat mode: 0 = off, 1 = repeat all, 2 = repeat one
    private val _repeatMode = MutableStateFlow(0)
    val repeatMode: StateFlow<Int> = _repeatMode.asStateFlow()

    // Original queue order (for un-shuffling)
    private var originalQueue: List<StreamingSong> = emptyList()

    // Search history (persistent)
    private val _searchHistory = MutableStateFlow<List<String>>(emptyList())
    val searchHistory: StateFlow<List<String>> = _searchHistory.asStateFlow()

    // Recently played songs (persistent)
    private val _recentlyPlayed = MutableStateFlow<List<StreamingSong>>(emptyList())
    val recentlyPlayed: StateFlow<List<StreamingSong>> = _recentlyPlayed.asStateFlow()

    private var searchJob: Job? = null
    private var lyricsJob: Job? = null

    init {
        // Load persistent data on init
        loadSearchHistory()
        loadRecentlyPlayed()
        loadQueue()
        loadPlaybackSettings()
    }

    /**
     * Load search history from SharedPreferences
     */
    private fun loadSearchHistory() {
        try {
            val historyJson = prefs.getString(KEY_SEARCH_HISTORY, null)
            if (historyJson != null) {
                val jsonArray = JSONArray(historyJson)
                val history = mutableListOf<String>()
                for (i in 0 until jsonArray.length()) {
                    history.add(jsonArray.getString(i))
                }
                _searchHistory.value = history
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error loading search history", e)
        }
    }

    /**
     * Save search history to SharedPreferences
     */
    private fun saveSearchHistory() {
        try {
            val jsonArray = JSONArray()
            _searchHistory.value.forEach { jsonArray.put(it) }
            prefs.edit().putString(KEY_SEARCH_HISTORY, jsonArray.toString()).apply()
        } catch (e: Exception) {
            Log.e(TAG, "Error saving search history", e)
        }
    }

    /**
     * Load recently played songs from SharedPreferences
     */
    private fun loadRecentlyPlayed() {
        try {
            val recentJson = prefs.getString(KEY_RECENTLY_PLAYED, null)
            if (recentJson != null) {
                val jsonArray = JSONArray(recentJson)
                val songs = mutableListOf<StreamingSong>()
                for (i in 0 until jsonArray.length()) {
                    val obj = jsonArray.getJSONObject(i)
                    songs.add(StreamingSong(
                        id = obj.getString("id"),
                        title = obj.getString("title"),
                        artist = obj.getString("artist"),
                        album = obj.optString("album", ""),
                        duration = obj.optLong("duration", 0L),
                        artworkUri = obj.optString("artworkUri", null),
                        spotifyId = obj.optString("spotifyId", ""),
                        provider = obj.optString("provider", null),
                        streamUrl = null // Don't persist stream URLs
                    ))
                }
                _recentlyPlayed.value = songs
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error loading recently played", e)
        }
    }

    /**
     * Save recently played songs to SharedPreferences
     */
    private fun saveRecentlyPlayed() {
        try {
            val jsonArray = JSONArray()
            _recentlyPlayed.value.take(MAX_RECENTLY_PLAYED).forEach { song ->
                val obj = JSONObject().apply {
                    put("id", song.id)
                    put("title", song.title)
                    put("artist", song.artist)
                    put("album", song.album)
                    put("duration", song.duration)
                    put("artworkUri", song.artworkUri ?: "")
                    put("spotifyId", song.spotifyId)
                    put("provider", song.provider ?: "")
                }
                jsonArray.put(obj)
            }
            prefs.edit().putString(KEY_RECENTLY_PLAYED, jsonArray.toString()).apply()
        } catch (e: Exception) {
            Log.e(TAG, "Error saving recently played", e)
        }
    }

    /**
     * Load queue from SharedPreferences
     */
    private fun loadQueue() {
        try {
            val queueJson = prefs.getString(KEY_QUEUE, null)
            val savedIndex = prefs.getInt(KEY_QUEUE_INDEX, 0)

            if (queueJson != null) {
                val jsonArray = JSONArray(queueJson)
                val songs = mutableListOf<StreamingSong>()
                for (i in 0 until jsonArray.length()) {
                    val obj = jsonArray.getJSONObject(i)
                    songs.add(StreamingSong(
                        id = obj.getString("id"),
                        title = obj.getString("title"),
                        artist = obj.getString("artist"),
                        album = obj.optString("album", ""),
                        duration = obj.optLong("duration", 0L),
                        artworkUri = obj.optString("artworkUri", null),
                        spotifyId = obj.optString("spotifyId", ""),
                        provider = obj.optString("provider", null),
                        streamUrl = null
                    ))
                }
                _queue.value = songs
                originalQueue = songs
                _currentIndex.value = savedIndex.coerceIn(0, songs.size.coerceAtLeast(1) - 1)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error loading queue", e)
        }
    }

    /**
     * Save queue to SharedPreferences
     */
    private fun saveQueue() {
        try {
            val jsonArray = JSONArray()
            _queue.value.take(MAX_QUEUE_SIZE).forEach { song ->
                val obj = JSONObject().apply {
                    put("id", song.id)
                    put("title", song.title)
                    put("artist", song.artist)
                    put("album", song.album)
                    put("duration", song.duration)
                    put("artworkUri", song.artworkUri ?: "")
                    put("spotifyId", song.spotifyId)
                    put("provider", song.provider ?: "")
                }
                jsonArray.put(obj)
            }
            prefs.edit()
                .putString(KEY_QUEUE, jsonArray.toString())
                .putInt(KEY_QUEUE_INDEX, _currentIndex.value)
                .apply()
        } catch (e: Exception) {
            Log.e(TAG, "Error saving queue", e)
        }
    }

    /**
     * Load playback settings (shuffle/repeat) from SharedPreferences
     */
    private fun loadPlaybackSettings() {
        _shuffleEnabled.value = prefs.getBoolean(KEY_SHUFFLE_MODE, false)
        _repeatMode.value = prefs.getInt(KEY_REPEAT_MODE, 0)
    }

    /**
     * Save playback settings to SharedPreferences
     */
    private fun savePlaybackSettings() {
        prefs.edit()
            .putBoolean(KEY_SHUFFLE_MODE, _shuffleEnabled.value)
            .putInt(KEY_REPEAT_MODE, _repeatMode.value)
            .apply()
    }

    /**
     * Add to search history
     */
    private fun addToSearchHistory(query: String) {
        val trimmedQuery = query.trim()
        if (trimmedQuery.length < 2) return

        val current = _searchHistory.value.toMutableList()
        current.remove(trimmedQuery) // Remove if exists to move to front
        current.add(0, trimmedQuery)
        if (current.size > MAX_HISTORY_SIZE) {
            current.removeAt(current.lastIndex)
        }
        _searchHistory.value = current
        saveSearchHistory()
    }

    /**
     * Add song to recently played
     */
    private fun addToRecentlyPlayed(song: StreamingSong) {
        val current = _recentlyPlayed.value.toMutableList()
        // Remove if already exists (by spotifyId)
        current.removeAll { it.spotifyId == song.spotifyId }
        // Add to front
        current.add(0, song.copy(streamUrl = null)) // Don't store stream URL
        if (current.size > MAX_RECENTLY_PLAYED) {
            current.removeAt(current.lastIndex)
        }
        _recentlyPlayed.value = current
        saveRecentlyPlayed()
    }

    /**
     * Remove item from search history
     */
    fun removeFromSearchHistory(query: String) {
        val current = _searchHistory.value.toMutableList()
        current.remove(query)
        _searchHistory.value = current
        saveSearchHistory()
    }

    /**
     * Clear all search history
     */
    fun clearSearchHistory() {
        _searchHistory.value = emptyList()
        prefs.edit().remove(KEY_SEARCH_HISTORY).apply()
    }

    /**
     * Clear recently played
     */
    fun clearRecentlyPlayed() {
        _recentlyPlayed.value = emptyList()
        prefs.edit().remove(KEY_RECENTLY_PLAYED).apply()
    }

    /**
     * Use a search history item
     */
    fun useSearchHistoryItem(query: String) {
        _searchQuery.value = query
        search(query)
    }

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
        } catch (e: CancellationException) {
            // Job cancelled (e.g., during navigation or new search) - don't log as error
            Log.d(TAG, "Search cancelled")
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
                // Set the queue if provided
                if (playQueue != null) {
                    _queue.value = playQueue
                    originalQueue = playQueue
                    _currentIndex.value = playQueue.indexOf(song).coerceAtLeast(0)
                    saveQueue()
                } else if (_queue.value.isEmpty()) {
                    // Create single-song queue if none exists
                    _queue.value = listOf(song)
                    originalQueue = listOf(song)
                    _currentIndex.value = 0
                    saveQueue()
                }

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

                    // Add to recently played
                    addToRecentlyPlayed(songWithStream)

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
     * Play next song in queue (respects repeat modes)
     */
    fun playNext() {
        val queue = _queue.value
        val currentIdx = _currentIndex.value

        if (queue.isEmpty()) return

        val nextIndex = when (_repeatMode.value) {
            2 -> currentIdx // Repeat one - stay on current song
            1 -> (currentIdx + 1) % queue.size // Repeat all - wrap around
            else -> if (currentIdx < queue.size - 1) currentIdx + 1 else return
        }

        val nextSong = queue[nextIndex]
        _currentIndex.value = nextIndex
        saveQueue()
        playSong(nextSong, queue)
    }

    /**
     * Play previous song in queue (respects repeat modes)
     */
    fun playPrevious() {
        val queue = _queue.value
        val currentIdx = _currentIndex.value

        if (queue.isEmpty()) return

        val prevIndex = when (_repeatMode.value) {
            2 -> currentIdx // Repeat one - stay on current song
            1 -> if (currentIdx > 0) currentIdx - 1 else queue.size - 1 // Repeat all - wrap around
            else -> if (currentIdx > 0) currentIdx - 1 else return
        }

        val prevSong = queue[prevIndex]
        _currentIndex.value = prevIndex
        saveQueue()
        playSong(prevSong, queue)
    }

    /**
     * Toggle shuffle mode
     */
    fun toggleShuffle() {
        val newShuffle = !_shuffleEnabled.value
        _shuffleEnabled.value = newShuffle

        if (newShuffle) {
            // Save original order and shuffle
            val currentSong = _currentSong.value
            originalQueue = _queue.value.toList()
            val shuffled = _queue.value.toMutableList()

            // Keep current song at the beginning
            if (currentSong != null) {
                shuffled.remove(currentSong)
                shuffled.shuffle()
                shuffled.add(0, currentSong)
                _currentIndex.value = 0
            } else {
                shuffled.shuffle()
            }
            _queue.value = shuffled
        } else {
            // Restore original order
            val currentSong = _currentSong.value
            _queue.value = originalQueue
            // Update index to point to current song in original queue
            if (currentSong != null) {
                val newIndex = originalQueue.indexOfFirst { it.spotifyId == currentSong.spotifyId }
                _currentIndex.value = newIndex.coerceAtLeast(0)
            }
        }

        saveQueue()
        savePlaybackSettings()
    }

    /**
     * Cycle through repeat modes: off -> all -> one -> off
     */
    fun toggleRepeat() {
        _repeatMode.value = (_repeatMode.value + 1) % 3
        savePlaybackSettings()
    }

    /**
     * Set specific repeat mode
     */
    fun setRepeatMode(mode: Int) {
        _repeatMode.value = mode.coerceIn(0, 2)
        savePlaybackSettings()
    }

    /**
     * Add a song to the end of the queue
     */
    fun addToQueue(song: StreamingSong) {
        val current = _queue.value.toMutableList()
        // Don't add duplicates
        if (current.none { it.spotifyId == song.spotifyId }) {
            current.add(song)
            _queue.value = current
            saveQueue()
        }
    }

    /**
     * Add a song to play next (after current song)
     */
    fun addToPlayNext(song: StreamingSong) {
        val current = _queue.value.toMutableList()
        val insertIndex = (_currentIndex.value + 1).coerceAtMost(current.size)

        // Remove if already exists
        val existingIndex = current.indexOfFirst { it.spotifyId == song.spotifyId }
        if (existingIndex >= 0) {
            current.removeAt(existingIndex)
            // Adjust current index if needed
            if (existingIndex < _currentIndex.value) {
                _currentIndex.value = _currentIndex.value - 1
            }
        }

        current.add(insertIndex.coerceAtMost(current.size), song)
        _queue.value = current
        saveQueue()
    }

    /**
     * Remove a song from the queue at a specific index
     */
    fun removeFromQueue(index: Int) {
        val current = _queue.value.toMutableList()
        if (index in current.indices && index != _currentIndex.value) {
            current.removeAt(index)
            // Adjust current index if needed
            if (index < _currentIndex.value) {
                _currentIndex.value = _currentIndex.value - 1
            }
            _queue.value = current
            saveQueue()
        }
    }

    /**
     * Move a song in the queue from one position to another
     */
    fun moveInQueue(fromIndex: Int, toIndex: Int) {
        val current = _queue.value.toMutableList()
        if (fromIndex in current.indices && toIndex in current.indices && fromIndex != toIndex) {
            val song = current.removeAt(fromIndex)
            current.add(toIndex, song)

            // Update current index if it was affected
            val currentIdx = _currentIndex.value
            val newCurrentIndex = when {
                fromIndex == currentIdx -> toIndex
                fromIndex < currentIdx && toIndex >= currentIdx -> currentIdx - 1
                fromIndex > currentIdx && toIndex <= currentIdx -> currentIdx + 1
                else -> currentIdx
            }
            _currentIndex.value = newCurrentIndex
            _queue.value = current
            saveQueue()
        }
    }

    /**
     * Clear the queue (except current song)
     */
    fun clearQueue() {
        val currentSong = _currentSong.value
        if (currentSong != null) {
            _queue.value = listOf(currentSong)
            _currentIndex.value = 0
        } else {
            _queue.value = emptyList()
            _currentIndex.value = 0
        }
        originalQueue = _queue.value
        saveQueue()
    }

    /**
     * Play a specific song in the queue by index
     */
    fun playFromQueue(index: Int) {
        val queue = _queue.value
        if (index in queue.indices) {
            _currentIndex.value = index
            playSong(queue[index], queue)
        }
    }

    /**
     * Check if there's a next song available
     */
    fun hasNext(): Boolean {
        val queue = _queue.value
        val currentIdx = _currentIndex.value
        return when (_repeatMode.value) {
            1 -> queue.isNotEmpty() // Repeat all - always has next
            2 -> true // Repeat one - current song is always next
            else -> currentIdx < queue.size - 1
        }
    }

    /**
     * Check if there's a previous song available
     */
    fun hasPrevious(): Boolean {
        val queue = _queue.value
        val currentIdx = _currentIndex.value
        return when (_repeatMode.value) {
            1 -> queue.isNotEmpty() // Repeat all - always has previous
            2 -> true // Repeat one - current song is always previous
            else -> currentIdx > 0
        }
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

    /**
     * Restore current song from MediaController metadata.
     * Used when app reopens and a streaming song is already playing.
     */
    fun restoreCurrentSong(
        mediaId: String,
        title: String,
        artist: String,
        album: String,
        artworkUri: String?,
        duration: Long,
        provider: String? = null
    ) {
        // Only restore if mediaId starts with "spotify:" and we don't have a current song
        if (!mediaId.startsWith("spotify:") || _currentSong.value != null) {
            return
        }

        val spotifyId = mediaId.removePrefix("spotify:")
        val restoredSong = StreamingSong(
            id = mediaId,
            title = title,
            artist = artist,
            album = album,
            duration = duration,
            artworkUri = artworkUri,
            spotifyId = spotifyId,
            provider = provider,
            streamUrl = "restored" // Mark as restored, not used for playback since it's already playing
        )

        _currentSong.value = restoredSong
        Log.d(TAG, "Restored current song from MediaController: $title")

        // Fetch lyrics for the restored song
        fetchLyricsForSong(restoredSong)
    }
}
