import type { RecapClip } from './recapClips';

const timestamp = '(\\d{2,}):([0-5]\\d):([0-5]\\d)[,.](\\d{3})';
const timing = new RegExp(`^${timestamp}\\s+-->\\s+${timestamp}$`);

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
