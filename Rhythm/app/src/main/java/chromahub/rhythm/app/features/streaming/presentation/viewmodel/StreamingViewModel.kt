package chromahub.rhythm.app.features.streaming.presentation.viewmodel

import android.app.Application
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import chromahub.rhythm.app.features.streaming.data.repository.SpotifyAuthManager
import chromahub.rhythm.app.features.streaming.data.repository.StreamingRepository
import chromahub.rhythm.app.features.streaming.domain.model.StreamingSong
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
        private const val TAG = "StreamingViewModel"
        private const val SEARCH_DEBOUNCE_MS = 500L
    }

    private val authManager = SpotifyAuthManager()
    private val repository = StreamingRepository(authManager)

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

    // Queue
    private val _queue = MutableStateFlow<List<StreamingSong>>(emptyList())
    val queue: StateFlow<List<StreamingSong>> = _queue.asStateFlow()

    private val _currentIndex = MutableStateFlow(0)
    val currentIndex: StateFlow<Int> = _currentIndex.asStateFlow()

    // Search history
    private val _searchHistory = MutableStateFlow<List<String>>(emptyList())
    val searchHistory: StateFlow<List<String>> = _searchHistory.asStateFlow()

    private var searchJob: Job? = null

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
     * Play a song - fetches stream URL and prepares for playback
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
}
