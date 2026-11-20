import type { RecapClip } from './recapClips.ts';
import { wrapBurmeseCueLines } from './timing.ts';

const timestamp = '(\\d{2,}):([0-5]\\d):([0-5]\\d)[,.](\\d{3})';
const timing = new RegExp(`^${timestamp}\\s+-->\\s+${timestamp}$`);

export function formatSrtTimestamp(seconds: number): string {
  const clamped = Math.round(Math.max(0, seconds) * 1000);
  const h = Math.floor(clamped / 3600000);
  const m = Math.floor((clamped % 3600000) / 60000);
  const s = Math.floor((clamped % 60000) / 1000);
  const ms = clamped % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export function buildSrtFromClips(
  clips: Array<Pick<RecapClip, 'sourceStart' | 'sourceEnd' | 'burmeseScript'>>
): string {
  let cursor = 0;
  return clips
    .map((clip, index) => {
      const duration = Math.max(0, clip.sourceEnd - clip.sourceStart);
      const start = cursor;
      const end = cursor + duration;
      cursor = end;
      return `${index + 1}\n${formatSrtTimestamp(start)} --> ${formatSrtTimestamp(end)}\n${wrapBurmeseCueLines(clip.burmeseScript)}\n`;
    })
    .join('\n');
}

export function parseSrt(srt: string, durationSec: number): RecapClip[] {
  const content = srt.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!content) throw new Error('The SRT file is empty.');

  let previousEnd = 0;
  return content.split(/\n(?:[ \t]*\n)+/).map((block, index) => {
    const id = index + 1;
    const lines = block.split('\n');
    if (/^\d+$/.test(lines[0].trim())) lines.shift();
    const match = lines.shift()?.trim().match(timing);
    if (!match) throw new Error(`Cue ${id} has an invalid timestamp.`);

    const seconds = (i: number) =>
      Number(match[i]) * 3600 + Number(match[i + 1]) * 60 +
      Number(match[i + 2]) + Number(match[i + 3]) / 1000;
    const sourceStart = seconds(1);
    const sourceEnd = seconds(5);
    if (!(sourceStart < sourceEnd && sourceEnd <= durationSec)) {
      throw new Error(`Cue ${id} must start before it ends and fit inside the source video.`);
    }
    if (sourceStart < previousEnd) {
      throw new Error(`Cue ${id} overlaps an earlier cue or is out of order.`);
    }
    previousEnd = sourceEnd;

    const burmeseScript = lines.join('\n').trim();
    if (!burmeseScript) throw new Error(`Cue ${id} needs narration text.`);
    return {
      id,
      title: `Cue ${id}`,
      sourceStart,
      sourceEnd,
      targetDuration: sourceEnd - sourceStart,
      burmeseScript,
      englishScript: '',
    };
  });
}
