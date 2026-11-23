// Run against npm run dev: npx tsx scripts/verify-recap.ts
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import { parseSrt } from '../src/data/srt.ts';

const execFileAsync = promisify(execFile);
const source = `verify-recap-${crypto.randomUUID()}.mp4`;
const files = [`public/uploads/${source}`];
const clips = [
  { id: 1, sourceStart: 0.12, sourceEnd: 1.35, burmeseScript: 'မင်္ဂလာပါ။' },
  { id: 2, sourceStart: 2.1, sourceEnd: 3.73, burmeseScript: 'ဇာတ်လမ်း ဆက်ပါမည်။' },
  { id: 3, sourceStart: 4.2, sourceEnd: 6, burmeseScript: 'ဇာတ်လမ်း ပြီးပါပြီ။' },
];

async function render(renderClips: typeof clips, scriptSource = 'gemini') {
  const response = await fetch('http://localhost:3000/api/render', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clips: renderClips, sourceVideoUrl: `/uploads/${source}`, scriptSource, sourceAudioVolume: 1, sample: true }),
  });
  const result = await response.json();
  if (response.ok) files.push('public' + result.videoUrl, 'public' + result.srtUrl);
  return { response, result };
}

try {
  await fs.mkdir('public/uploads', { recursive: true });
  await fs.copyFile('sample-output/timing-review/source.mp4', files[0]);
  const durations: number[] = [];
  for (const clip of clips) {
    const { response, result } = await render([clip]);
    assert.equal(response.ok, true, JSON.stringify(result));
    durations.push(result.durationSec);
  }

  for (const scriptSource of ['srt', 'gemini']) {
    const { response, result } = await render(clips, scriptSource);
    assert.equal(response.ok, true, JSON.stringify(result));
    assert.equal(result.subtitleTiming, 'scene-matched');
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', 'public' + result.videoUrl,
    ]);
    assert.deepEqual(JSON.parse(stdout).streams.map((stream: { codec_type: string }) => stream.codec_type), ['video']);
    const cues = parseSrt(await fs.readFile('public' + result.srtUrl, 'utf8'), result.durationSec + 0.05);
    assert.equal(cues.length, clips.length);
    let expected = 0;
    for (let i = 0; i < cues.length; i++) {
      assert.ok(Math.abs(cues[i].sourceStart - expected) < 0.041, `Cue ${i + 1} starts at the wrong scene`);
      expected += durations[i];
      assert.ok(Math.abs(cues[i].sourceEnd - expected) < 0.041, `Cue ${i + 1} ends at the wrong scene`);
      assert.equal(cues[i].burmeseScript.replace(/\s+/g, ' ').trim(), clips[i].burmeseScript);
    }
    assert.ok(Math.abs(result.durationSec - expected) < 0.041);
  }

  for (const invalid of [
    [{ ...clips[0], sourceEnd: clips[0].sourceStart }],
    [clips[0], { ...clips[1], sourceStart: 1 }],
    [{ ...clips[0], burmeseScript: ' ' }],
    [{ ...clips[0], sourceEnd: 100 }],
  ]) {
    const { response } = await render(invalid);
    assert.equal(response.status, 400);
  }
  console.log('Silent recap, scene-timed SRT, and invalid range checks passed.');
} finally {
  await Promise.all(files.map((file) => fs.rm(file, { force: true })));
}
