// Run against npm run dev: npx tsx scripts/verify-recap.ts
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { getSegmentTiming } from '../src/data/timing.ts';
import { alignedSubtitleCues } from '../src/data/alignment.ts';

const directory = 'sample-output/timing-review';
const metadata = JSON.parse(await fs.readFile(`${directory}/narration.json`, 'utf8'));
const hash = crypto.createHash('sha1').update(`my-MM-ThihaNeural:+0%:${metadata.text}`).digest('hex').slice(0, 12);
const audio = `clip-1-${hash}.mp3`;
await fs.mkdir('public/tts', { recursive: true });
await fs.mkdir('public/uploads', { recursive: true });
await fs.copyFile(`${directory}/narration.mp3`, `public/tts/${audio}`);
await fs.copyFile(`${directory}/narration.json`, `public/tts/${audio.replace('.mp3', '.json')}`);
await fs.copyFile(`${directory}/source.mp4`, 'public/uploads/timing-review-source.mp4');
const clip = { id: 1, sourceStart: 0, sourceEnd: 6.2, targetDuration: 4, burmeseScript: metadata.text, audioUrl: `/tts/${audio}` };
const payload = { clips: [clip], sourceVideoUrl: '/uploads/timing-review-source.mp4', scriptSource: 'srt', includeSubtitles: false, sourceAudioVolume: 0.14, sample: true };
async function render(body: unknown) {
  const response = await fetch('http://localhost:3000/api/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { ok: response.ok, data: await response.json() };
}
for (const [name, badClip, expected] of [
  ['missing audio', { ...clip, audioUrl: undefined }, /generated narration/],
  ['stale text', { ...clip, burmeseScript: clip.burmeseScript + ' အဆုံး။' }, /Regenerate/],
  ['long narration in short footage', { ...clip, sourceEnd: 1 }, /needs review/],
] as const) {
  const result = await render({ ...payload, clips: [badClip] });
  assert.equal(result.ok, false, name);
  assert.match(result.data.error, expected, name);
}
const expected = getSegmentTiming(clip, metadata.duration_sec).duration;
for (const source of ['srt', 'gemini']) {
  const result = await render({ ...payload, scriptSource: source });
  assert.equal(result.ok, true, JSON.stringify(result.data));
  assert.ok(Math.abs(result.data.durationSec - expected) < 0.05, 'preview/export duration within one frame plus AAC rounding');
  assert.equal(result.data.subtitleTiming, 'aligned');
  const srt = await fs.readFile('public' + result.data.srtUrl, 'utf8');
  const cues = alignedSubtitleCues(metadata.text, metadata.duration_sec, metadata.boundaries).subtitleCues;
  assert.equal(srt.trim().split(/\n\s*\n/).length, cues.length);
  assert.ok(srt.includes(cues[0].burmese));
  if (source === 'srt') {
    await fs.copyFile('public' + result.data.videoUrl, `${directory}/sample.mp4`);
    await fs.copyFile('public' + result.data.srtUrl, `${directory}/sample.srt`);
    await fs.writeFile(`${directory}/result.json`, JSON.stringify(result.data, null, 2));
  }
}
// Repeating the fixture as chronological adjacent segments reveals cumulative AAC padding drift.
await fs.copyFile(`${directory}/source.mp4`, 'public/uploads/timing-review-long.mp4');
const { execFileSync } = await import('node:child_process');
execFileSync('ffmpeg', ['-v', 'error', '-y', '-stream_loop', '3', '-i', `${directory}/source.mp4`, '-c', 'copy', 'public/uploads/timing-review-long.mp4']);
const multi = await render({ ...payload, sourceVideoUrl: '/uploads/timing-review-long.mp4', clips: [0, 1, 2, 3].map(i => ({ ...clip, id: i + 1, sourceStart: i * 6.2, sourceEnd: (i + 1) * 6.2 })) });
assert.equal(multi.ok, true, JSON.stringify(multi.data));
assert.ok(Math.abs(multi.data.durationSec - expected * 4) < 0.05, `multi-segment drift: ${multi.data.durationSec} vs ${expected * 4}`);
const filters = execFileSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const burned = await render({ ...payload, includeSubtitles: true });
if (/\bass\s+V->V/.test(filters)) assert.equal(burned.ok, true, JSON.stringify(burned.data));
else {
  assert.equal(burned.ok, false);
  assert.match(burned.data.error, /libass/);
}
console.log('Render checks passed: missing/stale audio, long narration rejection, SRT/Gemini consistency, aligned cues, four-segment drift.');
