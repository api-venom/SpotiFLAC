package chromahub.rhythm.app.features.local.presentation.components.lyrics

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.foundation.layout.Box
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import chromahub.rhythm.app.R
import chromahub.rhythm.app.util.AppleMusicLyricsParser
import chromahub.rhythm.app.util.WordByWordLyricLine
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlin.math.abs

/**
 * Represents either a lyrics line or a gap indicator
 */
sealed class LyricsItem {
    data class LyricLine(val line: WordByWordLyricLine, val index: Int) : LyricsItem()
    data class Gap(val duration: Long, val startTime: Long) : LyricsItem()
}

/**
 * Animation presets for word-by-word highlighting
 */
enum class WordAnimationPreset {
    DEFAULT,      // Standard fade and scale
    BOUNCE,       // Bouncy spring animation
    SLIDE,        // Slide-in from sides
    GLOW,         // Glowing highlight effect
    KARAOKE,      // Filling text effect (Apple Music style)
    MINIMAL       // Subtle color change only
}

/**
 * Composable for displaying word-by-word synchronized lyrics from Apple Music
 * Supports multiple animation presets including KARAOKE-style text filling
 *
 * @param wordByWordLyrics Raw JSON lyrics string from Apple Music API
 * @param currentPlaybackTime Current playback position in milliseconds
 * @param modifier Modifier for the composable
 * @param listState LazyListState for scroll control
 * @param onSeek Callback for seeking to a specific timestamp when tapping a line
 * @param syncOffset Manual offset to adjust lyrics timing in milliseconds
 * @param animationPreset Animation style for word highlighting
 * @param activeColor Color for active/highlighted words (karaoke fill color)
 * @param inactiveColor Color for inactive/upcoming words
 */
@Composable
fun WordByWordLyricsView(
    wordByWordLyrics: String,
    currentPlaybackTime: Long,
    modifier: Modifier = Modifier,
    listState: LazyListState = rememberLazyListState(),
    onSeek: ((Long) -> Unit)? = null,
    syncOffset: Long = 0L,
    animationPreset: WordAnimationPreset = WordAnimationPreset.DEFAULT,
    activeColor: Color? = null,
    inactiveColor: Color? = null
) {
    val context = LocalContext.current

    // Use theme colors as defaults
    val defaultActiveColor = MaterialTheme.colorScheme.primary
    val defaultInactiveColor = MaterialTheme.colorScheme.onSurface
    val effectiveActiveColor = activeColor ?: defaultActiveColor
    val effectiveInactiveColor = inactiveColor ?: defaultInactiveColor
    val adjustedPlaybackTime = currentPlaybackTime + syncOffset
    
    val parsedLyrics = remember(wordByWordLyrics) {
        AppleMusicLyricsParser.parseWordByWordLyrics(wordByWordLyrics)
    }

    // Create items list with gaps for instrumental sections
    val lyricsItems = remember(parsedLyrics) {
        val items = mutableListOf<LyricsItem>()
        parsedLyrics.forEachIndexed { index, line ->
            items.add(LyricsItem.LyricLine(line, index))
            
            // Check for gap to next line
            if (index < parsedLyrics.size - 1) {
                val nextLine = parsedLyrics[index + 1]
                val gapDuration = nextLine.lineTimestamp - line.lineEndtime
                if (gapDuration > 3000) { // 3 seconds threshold
                    items.add(LyricsItem.Gap(gapDuration, line.lineEndtime))
                }
            }
        }
        items
    }

    val coroutineScope = rememberCoroutineScope()
    
    // Find current line index (among lyric lines only) - using adjustedPlaybackTime for sync offset
    val currentLineIndex by remember(adjustedPlaybackTime, parsedLyrics) {
        derivedStateOf {
            parsedLyrics.indexOfLast { line ->
                adjustedPlaybackTime >= line.lineTimestamp && adjustedPlaybackTime <= line.lineEndtime
            }
        }
    }

    // Find current item index (including gaps) - using adjustedPlaybackTime for sync offset
    val currentItemIndex by remember(adjustedPlaybackTime, lyricsItems) {
        derivedStateOf {
            lyricsItems.indexOfFirst { item ->
                when (item) {
                    is LyricsItem.LyricLine -> 
                        adjustedPlaybackTime >= item.line.lineTimestamp && adjustedPlaybackTime <= item.line.lineEndtime
                    is LyricsItem.Gap -> 
                        adjustedPlaybackTime >= item.startTime && adjustedPlaybackTime < item.startTime + item.duration
                }
            }.takeIf { it >= 0 } ?: 0
        }
    }

    // Auto-scroll to current lyric line with elastic spring animation
    LaunchedEffect(currentLineIndex) {
        if (currentLineIndex >= 0 && parsedLyrics.isNotEmpty()) {
            // Find the corresponding item index in lyricsItems
            val targetItemIndex = lyricsItems.indexOfFirst { item ->
                item is LyricsItem.LyricLine && item.index == currentLineIndex
            }

            if (targetItemIndex >= 0) {
                val offset = listState.layoutInfo.viewportSize.height / 3

                coroutineScope.launch {
                    // Add staggering delay based on line position for elastic effect
                    val delayMs = when {
                        currentLineIndex == 0 -> 0L
                        currentLineIndex < 3 -> 50L
                        else -> 100L + (currentLineIndex * 20L).coerceAtMost(300L)
                    }

                    if (delayMs > 0) {
                        delay(delayMs)
                    }

                    // Use elastic spring animation for smooth, bouncy scrolling
                    listState.animateScrollToItem(
                        index = targetItemIndex,
                        scrollOffset = -offset
                    )
                }
            }
        }
    }

    if (parsedLyrics.isEmpty()) {
        Box(
            modifier = modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = context.getString(R.string.word_by_word_unavailable),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
                textAlign = TextAlign.Center
            )
        }
    } else {
        LazyColumn(
            state = listState,
            modifier = modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            contentPadding = PaddingValues(vertical = 30.dp)
        ) {
            itemsIndexed(lyricsItems) { itemIndex, item ->
                when (item) {
                    is LyricsItem.LyricLine -> {
                        val line = item.line
                        val index = item.index
                        val isCurrentLine = currentLineIndex == index
                        val isUpcomingLine = index > currentLineIndex
                        val linesAhead = index - currentLineIndex

                        // Animated scale for current line with elastic spring
                        val scale by animateFloatAsState(
                            targetValue = when {
                                isCurrentLine -> 1.08f
                                isUpcomingLine && linesAhead == 1 -> 1.02f
                                else -> 1f
                            },
                            animationSpec = spring<Float>(
                                dampingRatio = Spring.DampingRatioLowBouncy,
                                stiffness = Spring.StiffnessVeryLow
                            ),
                            label = "lineScale"
                        )

                        // Staggered opacity animation for upcoming lines with elastic effect
                        val opacity by animateFloatAsState(
                            targetValue = when {
                                isCurrentLine -> 1f
                                isUpcomingLine && linesAhead <= 4 -> 0.9f - (linesAhead * 0.1f)
                                else -> 0.3f
                            },
                            animationSpec = if (isUpcomingLine) {
                                spring<Float>(
                                    dampingRatio = Spring.DampingRatioLowBouncy,
                                    stiffness = Spring.StiffnessVeryLow,
                                    visibilityThreshold = 0.01f
                                )
                            } else {
                                spring<Float>(
                                    dampingRatio = Spring.DampingRatioMediumBouncy,
                                    stiffness = Spring.StiffnessLow
                                )
                            },
                            label = "lineOpacity"
                        )

                        // Staggered translation animation for upcoming lines with elastic bounce
                        val animatedTranslationY by animateFloatAsState(
                            targetValue = when {
                                isUpcomingLine && linesAhead <= 3 -> (linesAhead * 6f)
                                else -> 0f
                            },
                            animationSpec = spring<Float>(
                                dampingRatio = Spring.DampingRatioLowBouncy,
                                stiffness = Spring.StiffnessVeryLow
                            ),
                            label = "lineTranslation"
                        )

                        // Subtle rotation animation for elastic effect
                        val rotationZ by animateFloatAsState(
                            targetValue = if (isCurrentLine) 0.5f else 0f,
                            animationSpec = spring<Float>(
                                dampingRatio = Spring.DampingRatioLowBouncy,
                                stiffness = Spring.StiffnessVeryLow
                            ),
                            label = "lineRotation"
                        )

                        // Calculate distance-based alpha for better readability
                        val distanceFromCurrent = abs(index - currentLineIndex)

                        // Choose rendering based on animation preset
                        when (animationPreset) {
                            WordAnimationPreset.KARAOKE -> {
                                // KARAOKE style: Text fill animation
                                KaraokeLyricLine(
                                    line = line,
                                    isCurrentLine = isCurrentLine,
                                    adjustedPlaybackTime = adjustedPlaybackTime,
                                    activeColor = effectiveActiveColor,
                                    inactiveColor = effectiveInactiveColor.copy(
                                        alpha = when {
                                            isCurrentLine -> 0.6f
                                            distanceFromCurrent == 1 -> 0.5f
                                            distanceFromCurrent == 2 -> 0.4f
                                            else -> 0.3f
                                        }
                                    ),
                                    scale = scale,
                                    opacity = opacity,
                                    translationY = animatedTranslationY,
                                    onSeek = onSeek
                                )
                            }
                            else -> {
                                // DEFAULT and other presets: Use annotated string approach
                                val annotatedText = buildAnnotatedString {
                                    line.words.forEachIndexed { wordIndex, word ->
                                        val isWordActive = isCurrentLine &&
                                            adjustedPlaybackTime >= word.timestamp &&
                                            adjustedPlaybackTime <= word.endtime

                                        // Determine word color based on preset and custom colors
                                        val wordColor = when {
                                            animationPreset == WordAnimationPreset.MINIMAL -> {
                                                if (isWordActive) effectiveActiveColor
                                                else effectiveInactiveColor.copy(alpha = 0.7f)
                                            }
                                            isWordActive -> {
                                                // Use custom active color or voice-specific color
                                                if (activeColor != null) effectiveActiveColor
                                                else when (line.voiceTag) {
                                                    "v2" -> MaterialTheme.colorScheme.secondary
                                                    "v3" -> MaterialTheme.colorScheme.tertiary
                                                    else -> MaterialTheme.colorScheme.primary
                                                }
                                            }
                                            isCurrentLine -> {
                                                if (inactiveColor != null) effectiveInactiveColor.copy(alpha = 0.8f)
                                                else when (line.voiceTag) {
                                                    "v2" -> MaterialTheme.colorScheme.secondary.copy(alpha = 0.7f)
                                                    "v3" -> MaterialTheme.colorScheme.tertiary.copy(alpha = 0.7f)
                                                    else -> MaterialTheme.colorScheme.onSurface
                                                }
                                            }
                                            else -> {
                                                val wordAlpha = when {
                                                    distanceFromCurrent == 1 -> 0.75f
                                                    distanceFromCurrent == 2 -> 0.60f
                                                    distanceFromCurrent == 3 -> 0.45f
                                                    else -> 0.32f
                                                }
                                                effectiveInactiveColor.copy(alpha = wordAlpha)
                                            }
                                        }

                                        withStyle(
                                            SpanStyle(
                                                color = wordColor,
                                                fontWeight = if (isWordActive) FontWeight.Bold else
                                                    if (isCurrentLine) FontWeight.SemiBold else FontWeight.Normal
                                            )
                                        ) {
                                            if (wordIndex > 0 && !word.isPart) {
                                                append(" ")
                                            }
                                            append(word.text)
                                        }
                                    }
                                }

                                Text(
                                    text = annotatedText,
                                    style = MaterialTheme.typography.headlineSmall.copy(
                                        lineHeight = MaterialTheme.typography.headlineSmall.lineHeight * 1.4f
                                    ),
                                    textAlign = TextAlign.Center,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable {
                                            onSeek?.invoke(line.lineTimestamp)
                                        }
                                        .padding(vertical = 12.dp, horizontal = 16.dp)
                                        .graphicsLayer {
                                            scaleX = scale
                                            scaleY = scale
                                            alpha = opacity
                                            translationY = animatedTranslationY
                                        }
                                )
                            }
                        }
                    }
                    is LyricsItem.Gap -> {
                        // Visual indicator for instrumental gap
                        val isCurrentGap = currentPlaybackTime >= item.startTime && 
                            currentPlaybackTime < item.startTime + item.duration
                        
                        val gapHeight = (item.duration / 1000f).coerceIn(20f, 80f) // 20-80dp based on duration
                        
                        Spacer(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(gapHeight.dp)
                                .padding(horizontal = 32.dp)
                        )
                        
                        // Musical note icon or wave indicator
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 8.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            val iconScale by animateFloatAsState(
                                targetValue = if (isCurrentGap) 1.5f else 1f,
                                animationSpec = spring<Float>(
                                    dampingRatio = Spring.DampingRatioLowBouncy,
                                    stiffness = Spring.StiffnessVeryLow
                                ),
                                label = "iconScale"
                            )
                            
                            Text(
                                text = "♪",
                                style = MaterialTheme.typography.headlineMedium,
                                color = MaterialTheme.colorScheme.onSurface.copy(
                                    alpha = if (isCurrentGap) 0.8f else 0.3f
                                ),
                                modifier = Modifier.graphicsLayer {
                                    scaleX = iconScale
                                    scaleY = iconScale
                                }
                            )
                        }
                        
                        Spacer(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(gapHeight.dp)
                                .padding(horizontal = 32.dp)
                        )
                    }
                }
            }
        }
    }
}

/**
 * Karaoke-style lyric line with progressive text fill animation
 * Renders text with a gradient fill that progresses word-by-word based on timestamps
 */
@Composable
private fun KaraokeLyricLine(
    line: WordByWordLyricLine,
    isCurrentLine: Boolean,
    adjustedPlaybackTime: Long,
    activeColor: Color,
    inactiveColor: Color,
    scale: Float,
    opacity: Float,
    translationY: Float,
    onSeek: ((Long) -> Unit)?
) {
    // Build full text string for the line
    val fullText = remember(line) {
        buildString {
            line.words.forEachIndexed { index, word ->
                if (index > 0 && !word.isPart) {
                    append(" ")
                }
                append(word.text)
            }
        }
    }

    // Calculate fill progress for karaoke effect
    val fillProgress by remember(adjustedPlaybackTime, line, isCurrentLine) {
        derivedStateOf {
            if (!isCurrentLine) {
                // If line has passed, show fully filled; if upcoming, show unfilled
                if (adjustedPlaybackTime > line.lineEndtime) 1f else 0f
            } else {
                // Calculate per-character progress
                var charIndex = 0
                var filledChars = 0f
                var totalChars = 0

                line.words.forEachIndexed { wordIndex, word ->
                    if (wordIndex > 0 && !word.isPart) {
                        totalChars++
                        charIndex++
                        // Space is filled if we're past the previous word
                        if (adjustedPlaybackTime >= word.timestamp) {
                            filledChars++
                        }
                    }

                    val wordLength = word.text.length
                    totalChars += wordLength

                    when {
                        adjustedPlaybackTime >= word.endtime -> {
                            // Word fully sung
                            filledChars += wordLength
                        }
                        adjustedPlaybackTime >= word.timestamp -> {
                            // Word currently being sung - interpolate fill
                            val wordDuration = (word.endtime - word.timestamp).coerceAtLeast(1L)
                            val elapsed = adjustedPlaybackTime - word.timestamp
                            val wordProgress = (elapsed.toFloat() / wordDuration).coerceIn(0f, 1f)
                            filledChars += wordLength * wordProgress
                        }
                        // Word not yet sung - no fill
                    }

                    charIndex += wordLength
                }

                if (totalChars > 0) filledChars / totalChars else 0f
            }
        }
    }

    // Smooth animation for fill progress
    val animatedFillProgress by animateFloatAsState(
        targetValue = fillProgress,
        animationSpec = tween(
            durationMillis = 50,
            easing = LinearEasing
        ),
        label = "karaokeFill"
    )

    // Store text layout result for gradient calculation
    var textLayoutResult by remember { mutableStateOf<TextLayoutResult?>(null) }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onSeek?.invoke(line.lineTimestamp) }
            .padding(vertical = 12.dp, horizontal = 16.dp)
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
                alpha = opacity
                this.translationY = translationY
                compositingStrategy = CompositingStrategy.Offscreen
            }
            .drawWithContent {
                // Draw background text (unfilled)
                drawContent()

                // Draw filled overlay using gradient mask
                textLayoutResult?.let { layout ->
                    val fillWidth = size.width * animatedFillProgress

                    // Draw active color clipped to fill progress
                    drawRect(
                        brush = Brush.horizontalGradient(
                            colors = listOf(activeColor, activeColor),
                            startX = 0f,
                            endX = fillWidth
                        ),
                        size = Size(fillWidth, size.height),
                        blendMode = BlendMode.SrcAtop
                    )
                }
            },
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = fullText,
            style = MaterialTheme.typography.headlineSmall.copy(
                lineHeight = MaterialTheme.typography.headlineSmall.lineHeight * 1.4f
            ),
            fontWeight = if (isCurrentLine) FontWeight.SemiBold else FontWeight.Normal,
            color = inactiveColor,
            textAlign = TextAlign.Center,
            onTextLayout = { textLayoutResult = it }
        )
    }
}
