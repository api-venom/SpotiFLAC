export type LrcLineKind = "lyric" | "ellipsis";

export type LrcTimelineLine = {
  t: number;
  text: string; // raw text for lyric lines, "" for ellipsis
  kind: LrcLineKind;
};

type ParsedTimedLine = {
  t: number;
  text: string;
};

function isMetadataTagLine(raw: string) {
  // [ti:], [ar:], [al:], [by:], [offset:], etc.
  return /^\[[a-z]{2,6}:[^\]]*\]\s*$/i.test(raw.trim());
}

function parseTimestampToSeconds(minStr: string, secStr: string, fracStr?: string) {
  const min = Number(minStr);
  const sec = Number(secStr);
  const frac = fracStr ? Number(fracStr.padEnd(3, "0")) : 0;
  if (!Number.isFinite(min) || !Number.isFinite(sec) || !Number.isFinite(frac)) return null;
  return min * 60 + sec + frac / 1000;
}

export function isBeatOnlyText(text: string) {
  const t = (text || "").trim();
  if (t === "") return true;

  // Only dots / mid-dots / ellipses
  if (/^[.·•…]+$/.test(t)) return true;

  // Only music note glyphs
  if (/^[\s♪♫♬♩]+$/.test(t)) return true;

  // Only dashes/underscores
  if (/^[-_—–\s]+$/.test(t)) return true;

  return false;
}

export function parseLRC(content: string): ParsedTimedLine[] {
  const lines = (content || "").split(/\r?\n/);
  const out: ParsedTimedLine[] = [];

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (isMetadataTagLine(line)) continue;

    // Support multiple timestamps on a single line: [mm:ss.xx][mm:ss.xx]text
    const tsMatches = [...line.matchAll(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
    if (tsMatches.length === 0) continue;

    const text = line.replace(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g, "").trim();

    for (const m of tsMatches) {
      const t = parseTimestampToSeconds(m[1], m[2], m[3]);
      if (t === null) continue;
      out.push({ t, text });
    }
  }

  out.sort((a, b) => a.t - b.t);
  return out;
}

export type BuildTimelineOptions = {
  // How long a lyric line is considered “active” before we treat the remainder as a gap.
  maxLyricHoldSec?: number;
  // Only insert a gap marker if the span to the next timestamp is at least this long.
  gapMinSec?: number;
};

export function buildLrcTimeline(content: string, opts?: BuildTimelineOptions): LrcTimelineLine[] {
  const maxLyricHoldSec = opts?.maxLyricHoldSec ?? 3.0;
  const gapMinSec = opts?.gapMinSec ?? 5.0;

  const parsed = parseLRC(content);
  if (parsed.length === 0) return [];

  const base: LrcTimelineLine[] = parsed.map((l) => {
    const beat = isBeatOnlyText(l.text);
    return {
      t: l.t,
      text: beat ? "" : l.text,
      kind: beat ? "ellipsis" : "lyric",
    };
  });

  const timeline: LrcTimelineLine[] = [];
  for (let i = 0; i < base.length; i++) {
    const curr = base[i];
    timeline.push(curr);

    const next = base[i + 1];
    if (!next) continue;

    // If there is a long gap between timestamps, insert a virtual ellipsis marker.
    // This prevents “holding” the previous lyric line for the entire gap.
    const gap = next.t - curr.t;
    if (gap < gapMinSec) continue;

    // Only insert a gap marker after a brief hold; for existing ellipsis lines, insert immediately.
    const insertAt = curr.kind === "ellipsis" ? curr.t + 0.25 : curr.t + maxLyricHoldSec;
    if (insertAt > curr.t && insertAt < next.t - 0.15) {
      timeline.push({ t: insertAt, text: "", kind: "ellipsis" });
    }
  }

  timeline.sort((a, b) => a.t - b.t);
  return timeline;
}

export function findActiveIndex(lines: LrcTimelineLine[], positionSec: number, leadSec: number = 0.1) {
  if (!lines.length) return -1;
  let idx = -1;
  const t = positionSec + leadSec;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].t <= t) {
      idx = i;
    } else {
      break;
    }
  }
  return idx;
}

export function getLineProgress(lines: LrcTimelineLine[], activeIndex: number, positionSec: number) {
  const result: Record<number, number> = {};
  if (activeIndex < 0 || !lines[activeIndex]) return result;

  const curr = lines[activeIndex];
  const next = lines[activeIndex + 1];
  if (!curr) return result;

  // No fill for ellipsis lines.
  if (curr.kind === "ellipsis") return result;

  const startTime = curr.t;
  const endTime = next ? next.t : startTime + 3;
  const elapsed = positionSec - startTime;
  const duration = endTime - startTime;
  result[activeIndex] = duration > 0 ? Math.min(1, Math.max(0, elapsed / duration)) : 1;

  // Small pre-fill on next line if it's a lyric.
  if (next && next.kind === "lyric") {
    const nextDuration = next.t - startTime;
    result[activeIndex + 1] = nextDuration > 0 ? Math.min(0.3, Math.max(0, elapsed / nextDuration)) : 0;
  }

  return result;
}

export function formatEllipsisDots(dotCount: number) {
  // dotCount should be 0..3
  const n = Math.max(0, Math.min(3, dotCount));
  return ".".repeat(n);
}
