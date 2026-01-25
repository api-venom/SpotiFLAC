// Word-level lyrics types and utilities
// Provides syllable/word-level timing for true karaoke-style sync

export interface WordLyricsSyllable {
  time: number;     // Start time in milliseconds
  duration: number; // Duration in milliseconds
  text: string;     // Word/syllable text
  isBackground?: boolean; // Background vocal flag
}

export interface WordLyricsLine {
  time: number;     // Line start time in ms
  duration: number; // Line duration in ms
  text: string;     // Full line text
  syllabus: WordLyricsSyllable[]; // Word-by-word timing
  element?: {
    key?: string;
    songPart?: string;
    singer?: string;
  };
}

export interface WordLyricsMetadata {
  source?: string;
  title?: string;
  language?: string;
  totalDuration?: string;
}

export interface WordLyricsResponse {
  KpoeTools?: string;
  type: string; // "Word" for word-level, "Line" for line-level
  metadata: WordLyricsMetadata;
  lyrics: WordLyricsLine[];
  error?: string;
}

// Timeline types for rendering
export interface WordTimelineWord {
  text: string;
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface WordTimelineLine {
  text: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  words: WordTimelineWord[];
  isEllipsis?: boolean; // True for instrumental pause markers
}

export interface WordTimeline {
  type: "word" | "line";
  source?: string;
  lines: WordTimelineLine[];
}

/**
 * Build a word timeline from WordLyricsResponse
 * Includes detection of instrumental pauses/gaps and inserts ellipsis markers
 */
export function buildWordTimeline(response: WordLyricsResponse): WordTimeline {
  const rawLines: WordTimelineLine[] = [];

  // Minimum gap duration (in ms) to consider as an instrumental pause
  const GAP_MIN_MS = 2000; // 2 seconds (lowered from 3s)
  // How long a lyric line is considered "active" before we treat remaining time as a gap
  const MAX_LYRIC_HOLD_MS = 2000; // 2 seconds
  // Minimum time for intro gap before first lyrics
  const INTRO_GAP_MIN_MS = 3000; // 3 seconds

  for (const line of response.lyrics) {
    // Skip empty lines
    if (!line.text || line.text.trim() === "") continue;

    const words: WordTimelineWord[] = [];

    if (line.syllabus && line.syllabus.length > 0) {
      // Word-level timing available
      // Filter out background vocals and sort by time
      const mainVocals = line.syllabus
        .filter(syl => !syl.isBackground)
        .sort((a, b) => a.time - b.time);

      for (const syl of mainVocals) {
        words.push({
          text: syl.text,
          startMs: syl.time,
          endMs: syl.time + syl.duration,
          durationMs: syl.duration,
        });
      }
    }

    // If no words after filtering, treat whole line as one word
    if (words.length === 0) {
      words.push({
        text: line.text,
        startMs: line.time,
        endMs: line.time + line.duration,
        durationMs: line.duration,
      });
    }

    // Build the display text from main vocals only (no background)
    const displayText = words.map(w => w.text).join("");

    rawLines.push({
      text: displayText || line.text,
      startMs: line.time,
      endMs: line.time + line.duration,
      durationMs: line.duration,
      words,
      isEllipsis: false,
    });
  }

  // Now detect gaps between lines and insert ellipsis markers
  const lines: WordTimelineLine[] = [];

  // Check for intro gap (before first lyrics line)
  // Show dots from near the start of the song until the first lyrics line
  if (rawLines.length > 0 && rawLines[0].startMs >= INTRO_GAP_MIN_MS) {
    const introEnd = rawLines[0].startMs - 300; // End 300ms before first line
    // Start early in the song - at 1 second or 2 seconds before first line if it's short
    const introStart = Math.min(1000, Math.max(500, rawLines[0].startMs - 2000));

    lines.push({
      text: "...",
      startMs: introStart,
      endMs: introEnd,
      durationMs: introEnd - introStart,
      words: [{
        text: "...",
        startMs: introStart,
        endMs: introEnd,
        durationMs: introEnd - introStart,
      }],
      isEllipsis: true,
    });
  }

  for (let i = 0; i < rawLines.length; i++) {
    const curr = rawLines[i];
    lines.push(curr);

    const next = rawLines[i + 1];
    if (!next) continue;

    // Calculate gap between current line end and next line start
    const gap = next.startMs - curr.endMs;

    if (gap >= GAP_MIN_MS) {
      // Insert an ellipsis marker after the current line's natural duration
      const ellipsisStartMs = curr.endMs + Math.min(MAX_LYRIC_HOLD_MS, gap * 0.2);
      const ellipsisEndMs = next.startMs - 200; // End slightly before next line

      if (ellipsisStartMs < ellipsisEndMs) {
        lines.push({
          text: "...",
          startMs: ellipsisStartMs,
          endMs: ellipsisEndMs,
          durationMs: ellipsisEndMs - ellipsisStartMs,
          words: [{
            text: "...",
            startMs: ellipsisStartMs,
            endMs: ellipsisEndMs,
            durationMs: ellipsisEndMs - ellipsisStartMs,
          }],
          isEllipsis: true,
        });
      }
    }
  }

  // Sort by start time to ensure correct order
  lines.sort((a, b) => a.startMs - b.startMs);

  // Debug: count ellipsis lines
  const ellipsisCount = lines.filter(l => l.isEllipsis).length;
  console.log(`[WordLyrics] Built timeline: ${lines.length} total lines, ${ellipsisCount} ellipsis markers`);
  if (ellipsisCount > 0) {
    const ellipsisLines = lines.filter(l => l.isEllipsis);
    ellipsisLines.forEach((e, i) => {
      console.log(`  Ellipsis ${i + 1}: ${e.startMs}ms - ${e.endMs}ms (${(e.durationMs / 1000).toFixed(1)}s)`);
    });
  }

  return {
    type: response.type === "Word" ? "word" : "line",
    source: response.metadata?.source,
    lines,
  };
}

/**
 * Find the active line index based on current position
 */
export function findActiveLineIndex(timeline: WordTimeline, positionMs: number): number {
  if (!timeline.lines.length) return -1;

  let idx = -1;
  for (let i = 0; i < timeline.lines.length; i++) {
    if (timeline.lines[i].startMs <= positionMs) {
      idx = i;
    } else {
      break;
    }
  }
  return idx;
}

/**
 * Find the active word index within a line
 */
export function findActiveWordIndex(line: WordTimelineLine, positionMs: number): number {
  if (!line.words.length) return -1;

  let idx = -1;
  for (let i = 0; i < line.words.length; i++) {
    if (line.words[i].startMs <= positionMs) {
      idx = i;
    } else {
      break;
    }
  }
  return idx;
}

/**
 * Calculate word-level fill progress
 * Uses TIME-BASED progress for accurate visual sync
 * The fill percentage matches the elapsed time within the line
 */
export function getWordProgress(
  line: WordTimelineLine,
  positionMs: number
): { wordIndex: number; wordProgress: number; lineProgress: number } {
  const activeWordIdx = findActiveWordIndex(line, positionMs);

  if (activeWordIdx < 0) {
    return { wordIndex: -1, wordProgress: 0, lineProgress: 0 };
  }

  const word = line.words[activeWordIdx];
  const elapsed = positionMs - word.startMs;
  const wordProgress = Math.min(1, Math.max(0, elapsed / word.durationMs));

  // Calculate character-based line progress for overall fill visualization
  // This is used when rendering line-level fill (not per-word)
  let completedWordWidth = 0;
  for (let i = 0; i < activeWordIdx; i++) {
    completedWordWidth += line.words[i].text.length;
  }
  completedWordWidth += word.text.length * wordProgress;

  const totalWidth = line.words.reduce((sum, w) => sum + w.text.length, 0);
  const lineProgress = totalWidth > 0 ? completedWordWidth / totalWidth : 0;

  return {
    wordIndex: activeWordIdx,
    wordProgress,
    lineProgress: Math.min(1, Math.max(0, lineProgress)),
  };
}

/**
 * Check if we have word-level timing (vs just line-level)
 */
export function hasWordLevelTiming(timeline: WordTimeline): boolean {
  if (timeline.type !== "word") return false;

  // Check if at least some lines have word-level timing
  return timeline.lines.some(line => line.words.length > 1);
}
