import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alignedSubtitleCues } from './alignment.ts';

const text = 'လုရှောင်က စာချုပ်မချုပ်ခင် ဖမ်းခေါ်ခံရတဲ့ ပြည်သူထောင်ချီ ဘယ်မှာလဲလို့ မေးလိုက်ပါတယ်။';
const words = text.split(' ');
const boundaries = words.map((word, i) => ({ type: 'WordBoundary', offset: (0.2 + i * 0.8) * 1e7, duration: 0.7 * 1e7, text: word }));
test('provider boundaries preserve text and silence instead of spreading cues over the audio', () => {
  const result = alignedSubtitleCues(text, 6, boundaries);
  assert.equal(result.subtitleTiming, 'aligned');
  assert.ok(result.subtitleCues.length > 0);
  assert.equal(result.subtitleCues[0].start, 0.2);
  assert.ok(result.subtitleCues.at(-1)!.end < 6);
  assert.equal(result.subtitleCues.map(c => c.burmese).join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
  for (let i = 1; i < result.subtitleCues.length; i++) assert.ok(result.subtitleCues[i].start >= result.subtitleCues[i - 1].end);
});
test('missing, mismatched or overlapping provider timing is explicitly approximate', () => {
  assert.equal(alignedSubtitleCues(text, 6).subtitleTiming, 'approximate');
  assert.equal(alignedSubtitleCues(text, 6, boundaries.slice(1)).subtitleTiming, 'approximate');
  assert.equal(alignedSubtitleCues(text, 6, boundaries.map(b => ({ ...b, offset: 0 }))).subtitleTiming, 'approximate');
});
