import { buildSubtitleCues } from './timing.ts';

type Boundary = { type: string; offset: number; duration: number; text: string };
const graphemes = new Intl.Segmenter('my', { granularity: 'grapheme' });
const length = (text: string) => Array.from(graphemes.segment(text)).length;
const punctuation = /^[\p{P}\p{Z}\s]*$/u;

// Only verified provider boundaries qualify as alignment; otherwise expose the approximate fallback.
export function alignedSubtitleCues(text: string, duration: number, boundaries: Boundary[] = []) {
  const fallback = () => ({ subtitleCues: buildSubtitleCues(text, duration), subtitleTiming: 'approximate' as const });
  const legal = new Set(Array.from(graphemes.segment(text), item => item.index));
  legal.add(text.length);
  const spans: { start: number; end: number; index: number }[] = [];
  let cursor = 0;
  let previousEnd = 0;
  for (const event of boundaries) {
    if (!['WordBoundary', 'SentenceBoundary'].includes(event.type) || !event.text) continue;
    const index = text.indexOf(event.text, cursor);
    const start = event.offset / 1e7;
    const end = start + event.duration / 1e7;
    if (index < cursor || !punctuation.test(text.slice(cursor, index)) ||
        !legal.has(index) || !legal.has(index + event.text.length) ||
        !Number.isFinite(start) || !Number.isFinite(end) || start < previousEnd || end <= start || end > duration) return fallback();
    spans.push({ start, end, index });
    cursor = index + event.text.length;
    previousEnd = end;
  }
  if (!spans.length || !punctuation.test(text.slice(cursor))) return fallback();
  const cues: { start: number; end: number; burmese: string }[] = [];
  let first = 0;
  for (let i = 0; i < spans.length; i++) {
    const nextIndex = spans[i + 1]?.index ?? text.length;
    const phrase = text.slice(first === 0 ? 0 : spans[first].index, nextIndex).trim();
    if (i < spans.length - 1 && length(phrase) < 36 && !/[၊။!?]$/u.test(phrase)) continue;
    if (spans[i].end - spans[first].start < 1 && i < spans.length - 1) continue;
    // Oversized provider sentences cannot be split into accurate phrase timings.
    if (length(phrase) > 64) return fallback();
    cues.push({ start: spans[first].start, end: spans[i].end, burmese: phrase });
    first = i + 1;
  }
  if (cues.length > 1 && cues.at(-1)!.end - cues.at(-1)!.start < 1) {
    const last = cues.pop()!;
    const prior = cues.at(-1)!;
    prior.end = last.end;
    prior.burmese += ' ' + last.burmese;
  }
  for (const cue of cues) {
    let line = '';
    let rest = '';
    for (const { segment } of new Intl.Segmenter('my', { granularity: 'word' }).segment(cue.burmese)) {
      if (!rest && length(line + segment) <= 24) line += segment;
      else rest += segment;
    }
    if (line && rest) cue.burmese = `${line.trim()}\n${rest.trim()}`;
  }
  return { subtitleCues: cues, subtitleTiming: 'aligned' as const };
}
