import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSrt } from './srt.ts';

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
