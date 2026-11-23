import type { RecapClip } from './recapClips.ts';

const graphemes = new Intl.Segmenter('my', { granularity: 'grapheme' });
const words = new Intl.Segmenter('my', { granularity: 'word' });
const count = (text: string) => Array.from(graphemes.segment(text)).length;

export function countGraphemes(text: string): number {
  return count(text.replace(/\s+/g, ''));
}

/**
 * Estimates spoken Burmese duration at ~8.2 grapheme clusters/sec plus punctuation pauses.
 */
export function estimateBurmeseSpeechSec(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const graphemeCount = countGraphemes(trimmed);
  const punctuationMatches = trimmed.match(/[၊။!?,.;\n]/gu);
  const pauseCount = punctuationMatches ? punctuationMatches.length : 0;
  return Number((0.25 + graphemeCount / 8.2 + pauseCount * 0.15).toFixed(2));
}

/**
 * Computes a tight 1.0x clip duration matching Burmese speech + a natural ~0.55s pause between cues.
 */
export function getTightClipDuration(text: string, pauseBetweenCuesSec = 0.55): number {
  const speechSec = estimateBurmeseSpeechSec(text);
  if (speechSec <= 0) return 2.5;
  return Math.max(2.5, Number((speechSec + pauseBetweenCuesSec).toFixed(2)));
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
  gapSec: number;
  hasExcessGap: boolean;
  status: 'fit' | 'tight' | 'long';
}

export function getClipPaceCheck(
  clip: Pick<RecapClip, 'sourceStart' | 'sourceEnd' | 'burmeseScript'>
): ClipPaceCheck {
  const videoDuration = Math.max(0, Number((clip.sourceEnd - clip.sourceStart).toFixed(2)));
  const estimatedSpeechSec = estimateBurmeseSpeechSec(clip.burmeseScript);
  const graphemeCount = countGraphemes(clip.burmeseScript);
  const overflowSec = Number(Math.max(0, estimatedSpeechSec - videoDuration).toFixed(2));
  const gapSec = Number(Math.max(0, videoDuration - estimatedSpeechSec).toFixed(2));
  const hasExcessGap = gapSec > 1.8;
  const ratio = videoDuration > 0 ? estimatedSpeechSec / videoDuration : Infinity;
  const status = ratio > 1.02 ? 'long' : ratio > 0.88 ? 'tight' : 'fit';
  return {
    videoDuration,
    estimatedSpeechSec,
    graphemes: graphemeCount,
    overflowSec,
    gapSec,
    hasExcessGap,
    status,
  };
}
