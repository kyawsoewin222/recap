import type { RecapClip } from './recapClips.ts';

export function getSegmentTiming(clip: Pick<RecapClip, 'id' | 'sourceStart' | 'sourceEnd'>, audioDuration?: number) {
  if (typeof audioDuration !== 'number' || !Number.isFinite(audioDuration) || audioDuration <= 0) {
    throw new Error(`Segment ${clip.id}: generate narration and measure its duration before exporting.`);
  }
  const duration = Math.ceil((audioDuration + 0.25) * 25) / 25;
  const speed = (clip.sourceEnd - clip.sourceStart) / duration;
  if (!Number.isFinite(speed) || speed < 0.85 - 1e-9 || speed > 1.15 + 1e-9) {
    throw new Error(`Segment ${clip.id} needs review: ${audioDuration.toFixed(2)}s narration needs ${duration.toFixed(2)}s video; selected footage would play at ${speed.toFixed(2)}x. Choose more relevant footage or shorten repetition without losing meaning (allowed speed 0.85x–1.15x).`);
  }
  return { duration, speed };
}

const graphemes = new Intl.Segmenter('my', { granularity: 'grapheme' });
const words = new Intl.Segmenter('my', { granularity: 'word' });
const count = (text: string) => Array.from(graphemes.segment(text)).length;

export function countGraphemes(text: string): number {
  return count(text.replace(/\s+/g, ''));
}

/**
 * Estimates natural spoken Burmese narration duration (default Edge-TTS +0% pace).
 * Natural Burmese recap speech averages ~6.0 visible grapheme clusters/sec plus punctuation pauses.
 */
export function estimateBurmeseSpeechSec(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const graphemeCount = countGraphemes(trimmed);
  const punctuationMatches = trimmed.match(/[၊။!?,.;\n]/gu);
  const pauseCount = punctuationMatches ? punctuationMatches.length : 0;
  return Number((0.25 + graphemeCount / 6.0 + pauseCount * 0.22).toFixed(2));
}

export function wrapBurmeseCueLines(text: string, maxLineGraphemes = 28): string {
  const normalized = text.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!normalized) return '';
  if (count(normalized) <= maxLineGraphemes) return normalized;

  const units = Array.from(words.segment(normalized), (item) => item.segment);
  const total = count(normalized);
  const targetFirstLine = Math.min(maxLineGraphemes, Math.ceil(total / 2) + 2);
  let firstLine = '';
  let rest = '';
  for (const unit of units) {
    if (!rest && (!firstLine || count(firstLine + unit) <= targetFirstLine)) {
      firstLine += unit;
    } else {
      rest += unit;
    }
  }
  return firstLine.trim() && rest.trim()
    ? `${firstLine.trim()}\n${rest.trim()}`
    : normalized;
}

export interface ClipPaceCheck {
  videoDuration: number;
  estimatedSpeechSec: number;
  graphemes: number;
  overflowSec: number;
  status: 'fit' | 'tight' | 'long';
}

export function getClipPaceCheck(
  clip: Pick<RecapClip, 'sourceStart' | 'sourceEnd' | 'burmeseScript'>
): ClipPaceCheck {
  const videoDuration = Math.max(0, Number((clip.sourceEnd - clip.sourceStart).toFixed(2)));
  const estimatedSpeechSec = estimateBurmeseSpeechSec(clip.burmeseScript);
  const graphemeCount = countGraphemes(clip.burmeseScript);
  const overflowSec = Number(Math.max(0, estimatedSpeechSec - videoDuration).toFixed(2));
  const ratio = videoDuration > 0 ? estimatedSpeechSec / videoDuration : Infinity;
  const status = ratio > 1.05 ? 'long' : ratio > 0.88 ? 'tight' : 'fit';
  return {
    videoDuration,
    estimatedSpeechSec,
    graphemes: graphemeCount,
    overflowSec,
    status,
  };
}

export function buildSubtitleCues(text: string, audioDuration: number) {
  if (!text.trim() || !Number.isFinite(audioDuration) || audioDuration <= 0) return [];
  const phrases: string[] = [];
  let phrase = '';
  for (const { segment } of words.segment(text.trim())) {
    if (count(phrase + segment) > 42 && phrase.trim()) {
      phrases.push(phrase.trim());
      phrase = '';
    }
    phrase += segment;
    if (/[၊။!?\n]/u.test(segment) && count(phrase) >= 12) {
      phrases.push(phrase.trim());
      phrase = '';
    }
  }
  if (phrase.trim()) phrases.push(phrase.trim());
  // Avoid flashing cues when unusually short audio accompanies many phrases.
  while (phrases.length > Math.max(1, Math.floor(audioDuration))) {
    let shortest = 0;
    for (let i = 1; i < phrases.length - 1; i++) {
      if (count(phrases[i]) < count(phrases[shortest])) shortest = i;
    }
    phrases.splice(shortest, 2, phrases[shortest] + ' ' + phrases[shortest + 1]);
  }
  const weights = phrases.map((part) => Math.max(1, count(part)));
  const extra = Math.max(0, audioDuration - phrases.length);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = 0;
  return phrases.map((part, index) => {
    const start = cursor;
    cursor = index === phrases.length - 1 ? audioDuration : cursor + Math.min(1, audioDuration) + extra * weights[index] / totalWeight;
    // shortcut: proportional phrase timings are approximate; replace with speech alignment when supported.
    const units = Array.from(words.segment(part), (item) => item.segment);
    let firstLine = '';
    let rest = '';
    for (const unit of units) {
      if (!rest && count(firstLine + unit) <= 24) firstLine += unit;
      else rest += unit;
    }
    return { start, end: cursor, burmese: rest && firstLine ? `${firstLine.trim()}\n${rest.trim()}` : part };
  });
}
