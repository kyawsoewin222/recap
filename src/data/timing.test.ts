import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSubtitleCues, estimateBurmeseSpeechSec, getClipPaceCheck, getSegmentTiming, getTightClipDuration, wrapBurmeseCueLines } from './timing.ts';

const clip = { id: 1, sourceStart: 0, sourceEnd: 20.28 };
test('actual speech determines duration without a cap; estimates never override speech', () => {
  assert.deepEqual(getSegmentTiming(clip, 20), { duration: 20.28, speed: 1 });
  assert.throws(() => getSegmentTiming({ ...clip, sourceEnd: 4 }, 20), /needs review/);
  assert.throws(() => getSegmentTiming(clip, NaN), /generate narration/);
  for (const speed of [0.85, 1.15]) assert.equal(getSegmentTiming({ ...clip, sourceEnd: 20.28 * speed }, 20).speed, speed);
});
test('Burmese phrases preserve text, graphemes and nonoverlapping speech bounds', () => {
  const text = 'စစ်ပြေငြိမ်းစာချုပ်မချုပ်ခင် ရန်သူတွေ ဖမ်းခေါ်သွားတဲ့ နယ်စပ်ပြည်သူထောင်ချီ ဘယ်ရောက်နေလဲဆိုတာကို လုရှောင်က စတင်မေးမြန်းလိုက်ပါတယ်။ ဒါကြောင့် ပြန်ကယ်ဖို့ ကြိုးစားပါတယ်။';
  const cues = buildSubtitleCues(text, 18);
  assert.ok(cues.length > 1);
  assert.equal(cues.map(c => c.burmese).join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
  const boundaries = new Set(Array.from(new Intl.Segmenter('my', { granularity: 'grapheme' }).segment(text.replace(/\s/g, '')), s => s.index));
  let consumed = 0;
  for (const [index, cue] of cues.entries()) {
    assert.ok(boundaries.has(consumed));
    consumed += cue.burmese.replace(/\s/g, '').length;
    assert.ok(cue.end > cue.start && cue.end <= 18);
    if (index) assert.equal(cue.start, cues[index - 1].end);
    assert.ok(cue.burmese.split('\n').length <= 2);
  }
  assert.equal(cues.at(-1)?.end, 18);
  assert.equal(buildSubtitleCues(text, 0.5).length, 1);
});

test('1.0x pace estimator flags overly long Burmese narration and excess silence gaps', () => {
  const shortLine = 'လုရှောင်က ပြည်သူတွေကို ချက်ချင်းကယ်ဖို့ မြင်းတပ်နဲ့ လိုက်သွားပါတယ်။';
  const longLine = 'စစ်ပြေငြိမ်းစာချုပ်မချုပ်ခင် ရန်သူတွေ ဖမ်းခေါ်သွားတဲ့ နယ်စပ်ပြည်သူထောင်ချီ ဘယ်ရောက်နေလဲဆိုတာကို လုရှောင်က စတင်မေးမြန်းလိုက်ပြီး တံတားပေါ်မှာ တားဆီးလိုက်ပါတယ်။';
  assert.ok(estimateBurmeseSpeechSec(shortLine) < 7);
  const tight = getTightClipDuration(shortLine);
  assert.ok(tight > estimateBurmeseSpeechSec(shortLine) && tight < estimateBurmeseSpeechSec(shortLine) + 1);
  assert.equal(getClipPaceCheck({ sourceStart: 0, sourceEnd: tight, burmeseScript: shortLine }).hasExcessGap, false);
  assert.equal(getClipPaceCheck({ sourceStart: 0, sourceEnd: 15, burmeseScript: shortLine }).hasExcessGap, true);
  assert.equal(getClipPaceCheck({ sourceStart: 0, sourceEnd: 4, burmeseScript: longLine }).status, 'long');
  const wrapped = wrapBurmeseCueLines(shortLine, 26);
  assert.ok(wrapped.split('\n').length <= 2);
  assert.equal(wrapped.replace(/\s/g, ''), shortLine.replace(/\s/g, ''));
});
