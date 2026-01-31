package chromahub.rhythm.app.features.streaming.presentation.screens

import android.graphics.Bitmap
import android.graphics.drawable.BitmapDrawable
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Lyrics
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.RepeatOne
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.graphics.drawable.toBitmap
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.palette.graphics.Palette
import coil.ImageLoader
import coil.compose.AsyncImage
import coil.request.ImageRequest
import coil.request.SuccessResult
import chromahub.rhythm.app.features.local.presentation.components.lyrics.SyncedLyricsView
import chromahub.rhythm.app.features.local.presentation.components.lyrics.WordByWordLyricsView
import chromahub.rhythm.app.features.streaming.presentation.viewmodel.StreamingViewModel
import chromahub.rhythm.app.util.LyricsParser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlin.math.abs
import kotlin.math.sin

/**
 * Data class to hold extracted colors from album art
 */
data class AlbumColors(
    val dominantColor: Color = Color(0xFF1A1A2E),
    val vibrantColor: Color = Color(0xFF4A148C),
    val mutedColor: Color = Color(0xFF2D2D44),
    val darkVibrantColor: Color = Color(0xFF1A1A2E),
    val lightVibrantColor: Color = Color(0xFF7C4DFF),
    val darkMutedColor: Color = Color(0xFF16213E)
)

/**
 * Extract colors from album artwork using Palette API
 */
suspend fun extractColorsFromBitmap(bitmap: Bitmap): AlbumColors {
    return withContext(Dispatchers.Default) {
        try {
            val palette = Palette.from(bitmap).generate()

            val defaultDark = Color(0xFF1A1A2E)
            val defaultVibrant = Color(0xFF4A148C)

            AlbumColors(
                dominantColor = palette.getDominantColor(defaultDark.hashCode()).let { Color(it) },
                vibrantColor = palette.getVibrantColor(defaultVibrant.hashCode()).let { Color(it) },
                mutedColor = palette.getMutedColor(defaultDark.hashCode()).let { Color(it) },
                darkVibrantColor = palette.getDarkVibrantColor(defaultDark.hashCode()).let { Color(it) },
                lightVibrantColor = palette.getLightVibrantColor(defaultVibrant.hashCode()).let { Color(it) },
                darkMutedColor = palette.getDarkMutedColor(defaultDark.hashCode()).let { Color(it) }
            )
        } catch (e: Exception) {
            AlbumColors()
        }
    }
}

/**
 * Enhanced Streaming Player Screen
 * Full-screen player with dynamic gradients from album art
 * Premium animations and lyrics display with word-by-word fill effects
 */
@Composable
fun StreamingPlayerScreen(
    mediaController: MediaController?,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: StreamingViewModel
) {
    val haptic = LocalHapticFeedback.current
    val context = LocalContext.current

    val currentSong by viewModel.currentSong.collectAsState()
    val currentLyrics by viewModel.currentLyrics.collectAsState()
    val isLoadingLyrics by viewModel.isLoadingLyrics.collectAsState()
    val lyricsTimeOffset by viewModel.lyricsTimeOffset.collectAsState()
    val shuffleEnabled by viewModel.shuffleEnabled.collectAsState()
    val repeatMode by viewModel.repeatMode.collectAsState()

    var showLyrics by remember { mutableStateOf(true) }
    var isPlaying by remember { mutableStateOf(false) }
    var currentPosition by remember { mutableLongStateOf(0L) }
    var duration by remember { mutableLongStateOf(0L) }
    var sliderPosition by remember { mutableStateOf<Float?>(null) }

    // Dynamic colors from album art
    var albumColors by remember { mutableStateOf(AlbumColors()) }

    // Swipe gesture states
    var verticalDrag by remember { mutableFloatStateOf(0f) }
    var horizontalDrag by remember { mutableFloatStateOf(0f) }

    // Album art animation states
    var albumArtScale by remember { mutableFloatStateOf(1f) }
    val animatedAlbumScale by animateFloatAsState(
        targetValue = albumArtScale,
        animationSpec = spring(
            dampingRatio = Spring.DampingRatioMediumBouncy,
            stiffness = Spring.StiffnessLow
        ),
        label = "albumScale"
    )

    // Play button animation
    var playButtonPressed by remember { mutableStateOf(false) }
    val playButtonScale by animateFloatAsState(
        targetValue = if (playButtonPressed) 0.9f else 1f,
        animationSpec = spring(
            dampingRatio = Spring.DampingRatioMediumBouncy,
            stiffness = Spring.StiffnessMedium
        ),
        label = "playButtonScale"
    )

    val playButtonCorner by animateDpAsState(
        targetValue = if (isPlaying) 28.dp else 50.dp,
        animationSpec = spring(
            dampingRatio = Spring.DampingRatioNoBouncy,
            stiffness = Spring.StiffnessMedium
        ),
        label = "playButtonCorner"
    )

    val lyricsListState = rememberLazyListState()

    // Animated gradient transition
    val infiniteTransition = rememberInfiniteTransition(label = "gradientAnim")
    val gradientOffset by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(8000, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "gradientOffset"
    )

    // Extract colors from album art when song changes
    LaunchedEffect(currentSong?.artworkUri) {
        currentSong?.artworkUri?.let { uri ->
            try {
                val loader = ImageLoader(context)
                val request = ImageRequest.Builder(context)
                    .data(uri)
                    .allowHardware(false)
                    .build()

                val result = loader.execute(request)
                if (result is SuccessResult) {
                    val bitmap = result.drawable.toBitmap()
                    albumColors = extractColorsFromBitmap(bitmap)
                }
            } catch (e: Exception) {
                // Use default colors
            }
        }
    }

    // Animate album art on song change
    LaunchedEffect(currentSong?.id) {
        albumArtScale = 0.85f
        delay(50)
        albumArtScale = 1f
    }

    // Update playback state from MediaController
    LaunchedEffect(mediaController) {
        mediaController?.let { controller ->
            while (true) {
                isPlaying = controller.isPlaying
                currentPosition = controller.currentPosition
                duration = controller.duration.coerceAtLeast(1L)
                delay(50) // Smoother updates
            }
        }
    }

    // Player event listener
    DisposableEffect(mediaController) {
        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(playing: Boolean) {
                isPlaying = playing
            }
        }
        mediaController?.addListener(listener)
        onDispose {
            mediaController?.removeListener(listener)
        }
    }

    val song = currentSong ?: return

    // Calculate progress
    val progress = if (duration > 0) {
        (sliderPosition ?: (currentPosition.toFloat() / duration)).coerceIn(0f, 1f)
    } else 0f

    // Create animated gradient colors
    val animatedGradientColors = listOf(
        albumColors.darkVibrantColor.copy(alpha = 0.9f + gradientOffset * 0.1f),
        albumColors.darkMutedColor.copy(alpha = 0.85f),
        albumColors.mutedColor.copy(alpha = 0.7f - gradientOffset * 0.2f),
        MaterialTheme.colorScheme.surface.copy(alpha = 0.95f)
    )

    Box(
        modifier = modifier
            .fillMaxSize()
    ) {
        // Animated gradient background layer
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        colors = animatedGradientColors,
                        startY = 0f,
                        endY = Float.POSITIVE_INFINITY
                    )
                )
        )

        // Floating color orbs for extra visual appeal
        Canvas(
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer { alpha = 0.4f }
        ) {
            val orbSize = size.minDimension * 0.6f

            // Top-left orb
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(
                        albumColors.vibrantColor.copy(alpha = 0.3f),
                        Color.Transparent
                    ),
                    center = Offset(
                        x = size.width * (0.2f + gradientOffset * 0.1f),
                        y = size.height * (0.15f + sin(gradientOffset * Math.PI.toFloat()) * 0.05f)
                    ),
                    radius = orbSize
                ),
                center = Offset(
                    x = size.width * (0.2f + gradientOffset * 0.1f),
                    y = size.height * (0.15f + sin(gradientOffset * Math.PI.toFloat()) * 0.05f)
                ),
                radius = orbSize
            )

            // Bottom-right orb
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(
                        albumColors.lightVibrantColor.copy(alpha = 0.25f),
                        Color.Transparent
                    ),
                    center = Offset(
                        x = size.width * (0.8f - gradientOffset * 0.1f),
                        y = size.height * (0.7f + sin((1f - gradientOffset) * Math.PI.toFloat()) * 0.05f)
                    ),
                    radius = orbSize * 0.8f
                ),
                center = Offset(
                    x = size.width * (0.8f - gradientOffset * 0.1f),
                    y = size.height * (0.7f + sin((1f - gradientOffset) * Math.PI.toFloat()) * 0.05f)
                ),
                radius = orbSize * 0.8f
            )

            // Center accent orb
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(
                        albumColors.dominantColor.copy(alpha = 0.2f),
                        Color.Transparent
                    ),
                    center = Offset(
                        x = size.width * 0.5f,
                        y = size.height * (0.4f + gradientOffset * 0.1f)
                    ),
                    radius = orbSize * 0.5f
                ),
                center = Offset(
                    x = size.width * 0.5f,
                    y = size.height * (0.4f + gradientOffset * 0.1f)
                ),
                radius = orbSize * 0.5f
            )
        }

        // Main content
        Column(
            modifier = Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.statusBars)
                .windowInsetsPadding(WindowInsets.navigationBars)
                .pointerInput(Unit) {
                    detectVerticalDragGestures(
                        onDragEnd = {
                            if (verticalDrag > 150) {
                                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                onDismiss()
                            }
                            verticalDrag = 0f
                        },
                        onDragCancel = { verticalDrag = 0f },
                        onVerticalDrag = { _, dragAmount ->
                            if (dragAmount > 0) {
                                verticalDrag += dragAmount
                            }
                        }
                    )
                }
                .graphicsLayer {
                    translationY = (verticalDrag * 0.5f).coerceAtMost(100f)
                    alpha = 1f - (verticalDrag / 500f).coerceIn(0f, 0.3f)
                }
                .padding(horizontal = 24.dp)
        ) {
            // Header with drag indicator
            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                // Drag indicator
                Surface(
                    modifier = Modifier
                        .padding(top = 8.dp)
                        .width(40.dp)
                        .height(4.dp),
                    shape = RoundedCornerShape(2.dp),
                    color = Color.White.copy(alpha = 0.3f)
                ) {}

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(
                        onClick = {
                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                            onDismiss()
                        }
                    ) {
                        Icon(
                            imageVector = Icons.Default.KeyboardArrowDown,
                            contentDescription = "Minimize",
                            tint = Color.White,
                            modifier = Modifier.size(28.dp)
                        )
                    }

                    // Provider badge
                    song.provider?.let { provider ->
                        Surface(
                            color = Color.White.copy(alpha = 0.15f),
                            shape = RoundedCornerShape(12.dp)
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    imageVector = Icons.Default.MusicNote,
                                    contentDescription = null,
                                    modifier = Modifier.size(14.dp),
                                    tint = Color.White
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Text(
                                    text = provider.uppercase(),
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.SemiBold,
                                    color = Color.White
                                )
                                song.quality?.let { quality ->
                                    Text(
                                        text = " • $quality",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = Color.White.copy(alpha = 0.7f)
                                    )
                                }
                            }
                        }
                    }

                    IconButton(
                        onClick = {
                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                            showLyrics = !showLyrics
                        }
                    ) {
                        Icon(
                            imageVector = Icons.Default.Lyrics,
                            contentDescription = "Toggle Lyrics",
                            tint = if (showLyrics) albumColors.lightVibrantColor
                            else Color.White.copy(alpha = 0.6f),
                            modifier = Modifier.size(24.dp)
                        )
                    }
                }
            }

            // Content area - Album art or Lyrics
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
            ) {
                Crossfade(
                    targetState = showLyrics,
                    animationSpec = tween(300),
                    label = "contentCrossfade"
                ) { isLyricsShown ->
                    if (!isLyricsShown) {
                        // Album Art View
                        Column(
                            modifier = Modifier.fillMaxSize(),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center
                        ) {
                            Card(
                                modifier = Modifier
                                    .fillMaxWidth(0.85f)
                                    .aspectRatio(1f)
                                    .scale(animatedAlbumScale)
                                    .pointerInput(Unit) {
                                        detectHorizontalDragGestures(
                                            onDragEnd = {
                                                if (abs(horizontalDrag) > 100) {
                                                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                                    if (horizontalDrag > 0) {
                                                        viewModel.playPrevious()
                                                    } else {
                                                        viewModel.playNext()
                                                    }
                                                }
                                                horizontalDrag = 0f
                                            },
                                            onDragCancel = { horizontalDrag = 0f },
                                            onHorizontalDrag = { _, dragAmount ->
                                                horizontalDrag += dragAmount
                                            }
                                        )
                                    }
                                    .graphicsLayer {
                                        rotationZ = (horizontalDrag / 50f).coerceIn(-5f, 5f)
                                        translationX = horizontalDrag * 0.3f
                                    },
                                shape = RoundedCornerShape(24.dp),
                                elevation = CardDefaults.cardElevation(defaultElevation = 24.dp)
                            ) {
                                AsyncImage(
                                    model = ImageRequest.Builder(context)
                                        .data(song.artworkUri)
                                        .crossfade(true)
                                        .build(),
                                    contentDescription = song.album,
                                    contentScale = ContentScale.Crop,
                                    modifier = Modifier.fillMaxSize()
                                )
                            }
                        }
                    } else {
                        // Lyrics View
                        Box(
                            modifier = Modifier.fillMaxSize(),
                            contentAlignment = Alignment.Center
                        ) {
                            when {
                                isLoadingLyrics -> {
                                    Column(
                                        horizontalAlignment = Alignment.CenterHorizontally
                                    ) {
                                        // Animated loading dots
                                        LoadingDotsAnimation(color = Color.White)
                                        Spacer(modifier = Modifier.height(16.dp))
                                        Text(
                                            text = "Finding lyrics...",
                                            style = MaterialTheme.typography.bodyMedium,
                                            color = Color.White.copy(alpha = 0.7f)
                                        )
                                    }
                                }

                                currentLyrics != null -> {
                                    val lyrics = currentLyrics!!
                                    val adjustedTime = currentPosition + lyricsTimeOffset

                                    // Check for word-by-word lyrics first
                                    val wordByWordJson = lyrics.getWordByWordLyricsOrNull()
                                    if (wordByWordJson != null) {
                                        WordByWordLyricsView(
                                            wordByWordLyrics = wordByWordJson,
                                            currentPlaybackTime = adjustedTime,
                                            listState = lyricsListState,
                                            onSeek = { timestamp ->
                                                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                                mediaController?.seekTo(timestamp)
                                            },
                                            syncOffset = lyricsTimeOffset.toLong(),
                                            modifier = Modifier.fillMaxSize()
                                        )
                                    } else {
                                        // Check for synced lyrics
                                        val syncedLyrics = lyrics.syncedLyrics
                                        val plainLyrics = lyrics.plainLyrics

                                        if (syncedLyrics != null && LyricsParser.isValidLrcFormat(syncedLyrics)) {
                                            SyncedLyricsView(
                                                lyrics = syncedLyrics,
                                                currentPlaybackTime = adjustedTime,
                                                listState = lyricsListState,
                                                onSeek = { timestamp ->
                                                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                                    mediaController?.seekTo(timestamp)
                                                },
                                                syncOffset = lyricsTimeOffset.toLong(),
                                                modifier = Modifier.fillMaxSize()
                                            )
                                        } else if (plainLyrics != null) {
                                            // Plain lyrics display
                                            Text(
                                                text = plainLyrics,
                                                style = MaterialTheme.typography.bodyLarge,
                                                color = Color.White,
                                                textAlign = TextAlign.Center,
                                                lineHeight = 28.sp,
                                                modifier = Modifier.padding(16.dp)
                                            )
                                        } else {
                                            NoLyricsMessage(
                                                onRetry = { viewModel.retryFetchLyrics() },
                                                accentColor = albumColors.lightVibrantColor
                                            )
                                        }
                                    }
                                }

                                else -> {
                                    NoLyricsMessage(
                                        onRetry = { viewModel.retryFetchLyrics() },
                                        accentColor = albumColors.lightVibrantColor
                                    )
                                }
                            }
                        }
                    }
                }
            }

            // Song Info with animated text
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 20.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                AnimatedContent(
                    targetState = song.title,
                    transitionSpec = {
                        (fadeIn(tween(200)) + slideInVertically { -it / 4 }) togetherWith
                                (fadeOut(tween(200)) + slideOutVertically { it / 4 })
                    },
                    label = "titleAnim"
                ) { title ->
                    Text(
                        text = title,
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        color = Color.White
                    )
                }

                Spacer(modifier = Modifier.height(6.dp))

                AnimatedContent(
                    targetState = song.artist,
                    transitionSpec = {
                        (fadeIn(tween(200)) + slideInVertically { -it / 4 }) togetherWith
                                (fadeOut(tween(200)) + slideOutVertically { it / 4 })
                    },
                    label = "artistAnim"
                ) { artist ->
                    Text(
                        text = artist,
                        style = MaterialTheme.typography.bodyLarge,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        color = Color.White.copy(alpha = 0.7f)
                    )
                }

                if (song.album.isNotBlank()) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = song.album,
                        style = MaterialTheme.typography.bodyMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        color = Color.White.copy(alpha = 0.5f)
                    )
                }
            }

            // Progress bar with time
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 12.dp)
            ) {
                Slider(
                    value = progress,
                    onValueChange = {
                        sliderPosition = it
                        haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                    },
                    onValueChangeFinished = {
                        sliderPosition?.let { position ->
                            mediaController?.seekTo((position * duration).toLong())
                        }
                        sliderPosition = null
                    },
                    colors = SliderDefaults.colors(
                        thumbColor = albumColors.lightVibrantColor,
                        activeTrackColor = albumColors.lightVibrantColor,
                        inactiveTrackColor = Color.White.copy(alpha = 0.2f)
                    ),
                    modifier = Modifier.fillMaxWidth()
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        text = formatTime(
                            if (sliderPosition != null) (sliderPosition!! * duration).toLong()
                            else currentPosition
                        ),
                        style = MaterialTheme.typography.labelMedium,
                        color = Color.White.copy(alpha = 0.7f)
                    )
                    Text(
                        text = formatTime(duration),
                        style = MaterialTheme.typography.labelMedium,
                        color = Color.White.copy(alpha = 0.7f)
                    )
                }
            }

            // Shuffle and Repeat controls
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 8.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(
                    onClick = {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        viewModel.toggleShuffle()
                    }
                ) {
                    Icon(
                        imageVector = Icons.Default.Shuffle,
                        contentDescription = "Shuffle",
                        modifier = Modifier.size(24.dp),
                        tint = if (shuffleEnabled) albumColors.lightVibrantColor
                        else Color.White.copy(alpha = 0.5f)
                    )
                }

                Spacer(modifier = Modifier.weight(1f))

                IconButton(
                    onClick = {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        viewModel.toggleRepeat()
                    }
                ) {
                    Icon(
                        imageVector = when (repeatMode) {
                            2 -> Icons.Default.RepeatOne
                            else -> Icons.Default.Repeat
                        },
                        contentDescription = "Repeat",
                        modifier = Modifier.size(24.dp),
                        tint = if (repeatMode > 0) albumColors.lightVibrantColor
                        else Color.White.copy(alpha = 0.5f)
                    )
                }
            }

            // Animated playback controls
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(80.dp)
                    .padding(bottom = 24.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Previous button
                FilledTonalIconButton(
                    onClick = {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        viewModel.playPrevious()
                    },
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .clip(CircleShape),
                    colors = IconButtonDefaults.filledTonalIconButtonColors(
                        containerColor = Color.White.copy(alpha = 0.15f)
                    )
                ) {
                    Icon(
                        imageVector = Icons.Default.SkipPrevious,
                        contentDescription = "Previous",
                        modifier = Modifier.size(32.dp),
                        tint = Color.White
                    )
                }

                // Play/Pause button
                FilledIconButton(
                    onClick = {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        playButtonPressed = true
                        if (isPlaying) {
                            mediaController?.pause()
                        } else {
                            mediaController?.play()
                        }
                    },
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .scale(playButtonScale)
                        .clip(RoundedCornerShape(playButtonCorner)),
                    shape = RoundedCornerShape(playButtonCorner),
                    colors = IconButtonDefaults.filledIconButtonColors(
                        containerColor = albumColors.lightVibrantColor
                    )
                ) {
                    Crossfade(
                        targetState = isPlaying,
                        animationSpec = tween(200, easing = FastOutSlowInEasing),
                        label = "playPauseIcon"
                    ) { playing ->
                        Icon(
                            imageVector = if (playing) Icons.Default.Pause else Icons.Default.PlayArrow,
                            contentDescription = if (playing) "Pause" else "Play",
                            modifier = Modifier.size(36.dp),
                            tint = Color.White
                        )
                    }
                }

                // Next button
                FilledTonalIconButton(
                    onClick = {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        viewModel.playNext()
                    },
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .clip(CircleShape),
                    colors = IconButtonDefaults.filledTonalIconButtonColors(
                        containerColor = Color.White.copy(alpha = 0.15f)
                    )
                ) {
                    Icon(
                        imageVector = Icons.Default.SkipNext,
                        contentDescription = "Next",
                        modifier = Modifier.size(32.dp),
                        tint = Color.White
                    )
                }
            }
        }
    }

    // Reset play button scale after press
    LaunchedEffect(playButtonPressed) {
        if (playButtonPressed) {
            delay(100)
            playButtonPressed = false
        }
    }
}

/**
 * Animated loading dots (musical style)
 */
@Composable
private fun LoadingDotsAnimation(
    color: Color,
    modifier: Modifier = Modifier
) {
    val infiniteTransition = rememberInfiniteTransition(label = "dotsAnim")

    val dot1Alpha by infiniteTransition.animateFloat(
        initialValue = 0.3f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(600, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "dot1"
    )

    val dot2Alpha by infiniteTransition.animateFloat(
        initialValue = 0.3f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(600, delayMillis = 200, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "dot2"
    )

    val dot3Alpha by infiniteTransition.animateFloat(
        initialValue = 0.3f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(600, delayMillis = 400, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "dot3"
    )

    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(12.dp)
                .clip(CircleShape)
                .background(color.copy(alpha = dot1Alpha))
        )
        Box(
            modifier = Modifier
                .size(12.dp)
                .clip(CircleShape)
                .background(color.copy(alpha = dot2Alpha))
        )
        Box(
            modifier = Modifier
                .size(12.dp)
                .clip(CircleShape)
                .background(color.copy(alpha = dot3Alpha))
        )
    }
}

@Composable
private fun NoLyricsMessage(
    onRetry: () -> Unit,
    accentColor: Color
) {
    val haptic = LocalHapticFeedback.current

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.padding(32.dp)
    ) {
        Icon(
            imageVector = Icons.Default.Lyrics,
            contentDescription = null,
            modifier = Modifier.size(56.dp),
            tint = Color.White.copy(alpha = 0.4f)
        )
        Spacer(modifier = Modifier.height(20.dp))
        Text(
            text = "No lyrics available",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Medium,
            color = Color.White.copy(alpha = 0.7f)
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "Tap to search again",
            style = MaterialTheme.typography.bodyMedium,
            color = accentColor,
            modifier = Modifier.clickable {
                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                onRetry()
            }
        )
    }
}

private fun formatTime(timeMs: Long): String {
    if (timeMs < 0) return "0:00"
    val totalSeconds = (timeMs / 1000).toInt()
    val hours = totalSeconds / 3600
    val minutes = (totalSeconds % 3600) / 60
    val seconds = totalSeconds % 60

    return if (hours > 0) {
        String.format("%d:%02d:%02d", hours, minutes, seconds)
    } else {
        String.format("%d:%02d", minutes, seconds)
    }
}
