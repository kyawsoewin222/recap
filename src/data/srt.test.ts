import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSrtFromClips, parseSrt } from './srt.ts';

const sample = '1\n00:00:00,000 --> 00:00:04,000\nငါ အေးချမ်းနေတယ်။\nဒုတိယစာကြောင်း\n\n2\n00:00:10,000 --> 00:00:14,000\nငါ စိတ်အေးနေတယ်။';

test('preserves narration lines and the pause between cue windows', () => {
  const clips = parseSrt('\uFEFF' + sample.replaceAll('\n', '\r\n'), 14);
  assert.deepEqual(clips.map((clip) => [clip.sourceStart, clip.sourceEnd]), [[0, 4], [10, 14]]);
  assert.equal(clips[0].burmeseScript, 'ငါ အေးချမ်းနေတယ်။\nဒုတိယစာကြောင်း');
});

test('rejects cues that cannot be narrated on the source timeline', () => {
  assert.throws(() => parseSrt(sample, 13), /Cue 2.*fit inside/);
  assert.throws(() => parseSrt(sample.replace('00:00:10,000', '00:00:03,000'), 14), /Cue 2 overlaps/);
  assert.throws(() => parseSrt('1\n00:00:00,000 --> 00:00:04,000', 14), /Cue 1 needs narration text/);
});

test('buildSrtFromClips creates continuous 1.0x cues from clip source spans', () => {
  const srt = buildSrtFromClips([
    { sourceStart: 12, sourceEnd: 18.5, burmeseScript: 'လုရှောင်က မြင်းတပ်နဲ့ လိုက်သွားပါတယ်။' },
    { sourceStart: 30, sourceEnd: 35, burmeseScript: 'ပြည်သူတွေကို ကယ်တင်လိုက်ပါတယ်။' },
  ]);
  assert.match(srt, /00:00:00,000 --> 00:00:06,500/);
  assert.match(srt, /00:00:06,500 --> 00:00:11,500/);
});
