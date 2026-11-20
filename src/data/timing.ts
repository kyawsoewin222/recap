import type { RecapClip } from './recapClips';

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
