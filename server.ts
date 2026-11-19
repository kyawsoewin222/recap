import { GoogleGenAI, Type } from '@google/genai';
import { execFile } from 'child_process';
import crypto from 'crypto';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const execFileAsync = promisify(execFile);

const PORT = 3000;
const ROOT_DIR = process.cwd();
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const TTS_DIR = path.join(PUBLIC_DIR, 'tts');
const RENDERS_DIR = path.join(PUBLIC_DIR, 'renders');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');
const SOURCE_VIDEO_PATH = path.join(
  PUBLIC_DIR,
  'assets',
  'aistudio',
  'part9.mp4'
);

fs.mkdirSync(TTS_DIR, { recursive: true });
fs.mkdirSync(RENDERS_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Add it in the Settings > Secrets panel.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function probeDuration(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  const parsed = parseFloat(stdout.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8.5;
}

async function probeVideoInfo(filePath: string): Promise<{
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
}> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration:stream=codec_type,width,height',
    '-of',
    'json',
    filePath,
  ]);
  const parsed = JSON.parse(stdout || '{}') as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
  };
  const streams = parsed.streams ?? [];
  const videoStream = streams.find((s) => s.codec_type === 'video');
  const audioStream = streams.find((s) => s.codec_type === 'audio');
  const dur = parseFloat(parsed.format?.duration ?? '0');
  return {
    durationSec: Number.isFinite(dur) && dur > 0 ? dur : 0,
    width: videoStream?.width ?? 1280,
    height: videoStream?.height ?? 720,
    hasAudio: Boolean(audioStream),
  };
}

function resolveSourceVideoPath(sourceVideoUrl?: string): string {
  if (!sourceVideoUrl) return SOURCE_VIDEO_PATH;
  const cleanRel = sourceVideoUrl.split('?')[0].replace(/^\/+/, '');
  if (!cleanRel.startsWith('assets/') && !cleanRel.startsWith('uploads/')) {
    throw new Error('Invalid source video URL.');
  }
  const resolved = path.resolve(PUBLIC_DIR, cleanRel);
  if (!resolved.startsWith(path.resolve(PUBLIC_DIR) + path.sep)) {
    throw new Error('Invalid source video path.');
  }
  return resolved;
}

async function withGeminiRetry<T>(fn: () => Promise<T>, maxRetries = 4): Promise<T> {
  let delayMs = 2500;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const retryable =
        msg.includes('429') ||
        msg.includes('503') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('UNAVAILABLE');
      if (!retryable || attempt === maxRetries) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs *= 2;
    }
  }
  throw new Error('Gemini request failed after retries.');
}

function formatAssTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const cs = Math.floor((clamped - Math.floor(clamped)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function formatSrtTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const ms = Math.floor((clamped - Math.floor(clamped)) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N')
    .trim();
}

interface RenderClipInput {
  id: number;
  sourceStart: number;
  sourceEnd: number;
  targetDuration: number;
  burmeseScript: string;
  englishScript?: string;
  audioUrl?: string;
}

async function startServer() {
  const app = express();

  app.post('/api/upload-episode', (req, res) => {
    const rawName = String(req.headers['x-file-name'] || 'episode.mp4');
    const decodedName = (() => {
      try {
        return decodeURIComponent(rawName);
      } catch {
        return rawName;
      }
    })();
    const ext = path.extname(decodedName).toLowerCase() || '.mp4';
    const allowedExt = ['.mp4', '.mov', '.mkv', '.webm', '.m4v'];
    const safeExt = allowedExt.includes(ext) ? ext : '.mp4';
    const baseName = path
      .basename(decodedName, ext)
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .slice(0, 48) || 'episode';
    const savedName = `${baseName}-${Date.now()}${safeExt}`;
    const destPath = path.join(UPLOADS_DIR, savedName);

    const writeStream = fs.createWriteStream(destPath);
    let receivedBytes = 0;

    req.on('data', (chunk: Buffer) => {
      receivedBytes += chunk.length;
    });

    req.pipe(writeStream);

    writeStream.on('finish', async () => {
      try {
        if (receivedBytes < 1024) {
          fs.rmSync(destPath, { force: true });
          res.status(400).json({ error: 'Uploaded video file is empty or invalid.' });
          return;
        }
        const info = await probeVideoInfo(destPath);
        if (info.durationSec <= 0) {
          fs.rmSync(destPath, { force: true });
          res.status(400).json({ error: 'Could not read video duration from uploaded file.' });
          return;
        }
        res.json({
          sourceVideoUrl: `/uploads/${savedName}`,
          fileName: decodedName,
          durationSec: info.durationSec,
          width: info.width,
          height: info.height,
          fileSizeBytes: receivedBytes,
        });
      } catch (err: unknown) {
        fs.rmSync(destPath, { force: true });
        const message = err instanceof Error ? err.message : 'Failed to process uploaded video.';
        res.status(500).json({ error: message });
      }
    });

    const handleStreamError = (err: unknown) => {
      fs.rmSync(destPath, { force: true });
      const message = err instanceof Error ? err.message : 'Upload stream failed.';
      if (!res.headersSent) {
        res.status(500).json({ error: message });
      }
    };

    req.on('error', handleStreamError);
    writeStream.on('error', handleStreamError);
  });

  app.use(express.json({ limit: '4mb' }));

  app.use('/assets', express.static(path.join(PUBLIC_DIR, 'assets')));
  app.use('/tts', express.static(TTS_DIR));
  app.use('/renders', express.static(RENDERS_DIR));
  app.use('/uploads', express.static(UPLOADS_DIR));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      sourceExists: fs.existsSync(SOURCE_VIDEO_PATH),
    });
  });

  app.get('/api/default-render', async (_req, res) => {
    const mp4Path = path.join(RENDERS_DIR, 'part9.mp4');
    const srtPath = path.join(RENDERS_DIR, 'part9.srt');
    if (!fs.existsSync(mp4Path)) {
      res.json(null);
      return;
    }
    try {
      const durationSec = await probeDuration(mp4Path);
      const stats = fs.statSync(mp4Path);
      res.json({
        videoUrl: '/renders/part9.mp4',
        srtUrl: fs.existsSync(srtPath)
          ? '/renders/part9.srt'
          : '',
        durationSec,
        fileSizeBytes: stats.size,
        width: 1280,
        height: 720,
      });
    } catch {
      res.json(null);
    }
  });

  app.post('/api/tts', async (req, res) => {
    try {
      const { clipId, text, voiceName = 'Charon' } = req.body as {
        clipId: number;
        text: string;
        voiceName?: string;
      };

      if (!text || !text.trim()) {
        res.status(400).json({ error: 'Narration text is required.' });
        return;
      }

      const allowedVoices = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'];
      const selectedVoice = allowedVoices.includes(voiceName)
        ? voiceName
        : 'Charon';

      const hash = crypto
        .createHash('sha1')
        .update(`${selectedVoice}:${text.trim()}`)
        .digest('hex')
        .slice(0, 12);
      const fileName = `clip-${clipId}-${hash}.wav`;
      const outPath = path.join(TTS_DIR, fileName);

      if (fs.existsSync(outPath)) {
        const durationSec = await probeDuration(outPath);
        res.json({ audioUrl: `/tts/${fileName}`, durationSec, cached: true });
        return;
      }

      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: text.trim(),
                speechMetadata: {
                  style:
                    'Fast-paced, energetic, clear Burmese YouTube movie recap narrator',
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: selectedVoice },
            },
          },
        },
      });

      const base64Audio =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        res.status(502).json({
          error:
            'No audio stream returned from Gemini TTS. Please verify your API key and try again.',
        });
        return;
      }

      const wavBuffer = Buffer.from(base64Audio, 'base64');
      fs.writeFileSync(outPath, wavBuffer);
      const durationSec = await probeDuration(outPath);

      res.json({ audioUrl: `/tts/${fileName}`, durationSec, cached: false });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to generate Burmese voiceover.';
      console.error('TTS error:', err);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/translate', async (req, res) => {
    try {
      const { englishScript } = req.body as { englishScript: string };
      if (!englishScript || !englishScript.trim()) {
        res.status(400).json({ error: 'English script text is required.' });
        return;
      }

      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Translate this short 8-10 second movie recap narration into natural, fast-paced spoken Burmese suitable for a viral Myanmar YouTube movie recap voiceover. Return ONLY the Burmese narration text with no quotes or notes:\n\n${englishScript.trim()}`,
      });

      const burmeseScript = response.text?.trim();
      if (!burmeseScript) {
        res.status(502).json({ error: 'Empty translation returned from Gemini.' });
        return;
      }

      res.json({ burmeseScript });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to translate narration.';
      console.error('Translate error:', err);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/analyze-episode', async (req, res) => {
    const tempChunkDir = path.join(
      RENDERS_DIR,
      `analyze-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );

    try {
      const { sourceVideoUrl } = req.body as { sourceVideoUrl?: string };
      const sourcePath = resolveSourceVideoPath(sourceVideoUrl);
      if (!fs.existsSync(sourcePath)) {
        res.status(404).json({ error: 'Uploaded episode file was not found on server.' });
        return;
      }

      const info = await probeVideoInfo(sourcePath);
      const totalDur = Math.max(1, info.durationSec);
      const ai = getAiClient();

      const CHUNK_SEC = 1200; // 20-minute chunk boundary
      const chunkFiles: Array<{ filePath: string; offsetSec: number; durationSec: number }> = [];

      if (totalDur <= CHUNK_SEC) {
        chunkFiles.push({ filePath: sourcePath, offsetSec: 0, durationSec: totalDur });
      } else {
        fs.mkdirSync(tempChunkDir, { recursive: true });
        for (let start = 0, idx = 0; start < totalDur; start += CHUNK_SEC, idx++) {
          const dur = Math.min(CHUNK_SEC, totalDur - start);
          const chunkPath = path.join(tempChunkDir, `chunk-${idx}.mp4`);
          await execFileAsync('ffmpeg', [
            '-y',
            '-ss',
            start.toFixed(2),
            '-t',
            dur.toFixed(2),
            '-i',
            sourcePath,
            '-c',
            'copy',
            chunkPath,
          ]);
          chunkFiles.push({ filePath: chunkPath, offsetSec: start, durationSec: dur });
        }
      }

      const allClips: Array<{
        id: number;
        title: string;
        sourceStart: number;
        sourceEnd: number;
        targetDuration: number;
        englishScript: string;
        burmeseScript: string;
      }> = [];

      let nextId = 1;

      for (const chunk of chunkFiles) {
        const uploaded = await withGeminiRetry(() =>
          ai.files.upload({
            file: chunk.filePath,
            config: { mimeType: 'video/mp4' },
          })
        );

        let fileState = uploaded;
        while (fileState.state === 'PROCESSING') {
          await new Promise((r) => setTimeout(r, 2500));
          if (!fileState.name) break;
          fileState = await ai.files.get({ name: fileState.name });
        }

        if (fileState.state === 'FAILED' || !fileState.uri) {
          throw new Error('Gemini video processing failed for uploaded episode.');
        }

        try {
          const prompt = `Analyze this ${chunk.durationSec.toFixed(1)}-second video clip and create a fast-paced YouTube movie recap storyboard split into short micro-segments.

Rules:
1. Do NOT copy or translate spoken/subtitle dialogue word-for-word. Describe all events using original recap narration wording for copyright safety.
2. Cover the whole key plot chronologically. Each segment must be 1 short punchy sentence (about 3.0 to 5.2 seconds when spoken).
3. For a 3-minute episode, produce ~20-26 segments; scale proportionally for longer/shorter chunks.
4. Provide accurate sourceStart and sourceEnd in seconds relative to THIS video clip (0 to ${chunk.durationSec.toFixed(1)}), with sourceEnd > sourceStart + 1.2.
5. Set targetDuration between 3.0 and 5.5 seconds matching the Burmese sentence length.
6. Write natural, dramatic, fast-paced spoken Burmese (Myanmar Unicode) in burmeseScript, plus concise English summary in englishScript and a short 2-3 word title.`;

          const response = await withGeminiRetry(() =>
            ai.models.generateContent({
              model: 'gemini-4-hydrogen',
              contents: [
                {
                  role: 'user',
                  parts: [
                    {
                      fileData: {
                        fileUri: fileState.uri!,
                        mimeType: fileState.mimeType || 'video/mp4',
                      },
                    },
                    { text: prompt },
                  ],
                },
              ],
              config: {
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      sourceStart: { type: Type.NUMBER },
                      sourceEnd: { type: Type.NUMBER },
                      targetDuration: { type: Type.NUMBER },
                      englishScript: { type: Type.STRING },
                      burmeseScript: { type: Type.STRING },
                    },
                    required: [
                      'title',
                      'sourceStart',
                      'sourceEnd',
                      'targetDuration',
                      'englishScript',
                      'burmeseScript',
                    ],
                  },
                },
              },
            })
          );

          const rawText = (response.text ?? '[]').trim();
          const parsed = JSON.parse(rawText) as Array<{
            title: string;
            sourceStart: number;
            sourceEnd: number;
            targetDuration: number;
            englishScript: string;
            burmeseScript: string;
          }>;

          for (const item of parsed) {
            const relStart = Math.max(0, Math.min(chunk.durationSec - 1.5, Number(item.sourceStart) || 0));
            const relEnd = Math.max(relStart + 1.2, Math.min(chunk.durationSec, Number(item.sourceEnd) || relStart + 4));
            const targetDur = Math.max(2.5, Math.min(6.0, Number(item.targetDuration) || 4.2));
            allClips.push({
              id: nextId,
              title: `${String(nextId).padStart(2, '0')}. ${(item.title || `Scene ${nextId}`).replace(/^\d+\.\s*/, '')}`,
              sourceStart: Number((chunk.offsetSec + relStart).toFixed(2)),
              sourceEnd: Number((chunk.offsetSec + relEnd).toFixed(2)),
              targetDuration: Number(targetDur.toFixed(2)),
              englishScript: String(item.englishScript || '').trim(),
              burmeseScript: String(item.burmeseScript || '').trim(),
            });
            nextId++;
          }
        } finally {
          if (fileState.name) {
            await ai.files.delete({ name: fileState.name }).catch(() => {});
          }
        }
      }

      if (allClips.length === 0) {
        res.status(502).json({ error: 'Gemini returned no recap segments for this video.' });
        return;
      }

      res.json({ clips: allClips });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to analyze uploaded episode.';
      console.error('Analyze episode error:', err);
      res.status(500).json({ error: message });
    } finally {
      fs.rmSync(tempChunkDir, { recursive: true, force: true });
    }
  });

  app.post('/api/render', async (req, res) => {
    const tempDir = path.join(
      RENDERS_DIR,
      `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );

    try {
      const {
        clips,
        sourceVideoUrl,
        includeSubtitles = true,
        maskBottomSubtitles = true,
        sourceAudioVolume = 0.14,
        voiceoverVolume = 1.0,
      } = req.body as {
        clips: RenderClipInput[];
        sourceVideoUrl?: string;
        includeSubtitles?: boolean;
        maskBottomSubtitles?: boolean;
        sourceAudioVolume?: number;
        voiceoverVolume?: number;
      };

      const sourcePath = resolveSourceVideoPath(sourceVideoUrl);
      if (!fs.existsSync(sourcePath)) {
        res.status(404).json({ error: 'Source video file was not found on server.' });
        return;
      }

      const sourceInfo = await probeVideoInfo(sourcePath);

      if (!Array.isArray(clips) || clips.length === 0) {
        res.status(400).json({ error: 'At least one recap clip is required.' });
        return;
      }

      fs.mkdirSync(tempDir, { recursive: true });

      const segmentPaths: string[] = [];
      const subtitleTimings: Array<{
        start: number;
        end: number;
        burmese: string;
      }> = [];

      let cumulativeTime = 0;

      for (let i = 0; i < clips.length; i++) {
        const clip = clips[i];
        const srcStart = Math.max(0, Number(clip.sourceStart));
        const srcEnd = Math.max(srcStart + 1, Number(clip.sourceEnd));
        const rawSrcDur = srcEnd - srcStart;

        let localAudioPath: string | null = null;
        let clipDuration = Math.max(2.5, Number(clip.targetDuration) || 4.5);

        if (clip.audioUrl && clip.audioUrl.startsWith('/tts/')) {
          const candidate = path.join(TTS_DIR, path.basename(clip.audioUrl));
          if (fs.existsSync(candidate)) {
            localAudioPath = candidate;
            const ttsDur = await probeDuration(candidate);
            clipDuration = Math.max(2.5, Math.min(14, ttsDur + 0.25));
          }
        }

        const speedRatio = clipDuration / rawSrcDur;
        const segOutPath = path.join(
          tempDir,
          `seg-${String(i).padStart(2, '0')}.mp4`
        );

        const videoFilters = [
          'scale=1280:720:force_original_aspect_ratio=increase',
          'crop=1280:720',
          'fps=25',
          `setpts=${speedRatio.toFixed(6)}*PTS`,
        ];

        if (maskBottomSubtitles) {
          videoFilters.push(
            'drawbox=x=0:y=592:w=1280:h=128:color=black@0.82:t=fill'
          );
        }

        const args: string[] = [
          '-y',
          '-ss',
          srcStart.toFixed(3),
          '-t',
          rawSrcDur.toFixed(3),
          '-i',
          sourcePath,
        ];

        if (!sourceInfo.hasAudio) {
          args.push(
            '-f',
            'lavfi',
            '-t',
            clipDuration.toFixed(3),
            '-i',
            'anullsrc=channel_layout=stereo:sample_rate=48000'
          );
        }

        const voInputIndex = sourceInfo.hasAudio ? 1 : 2;
        if (localAudioPath) {
          args.push('-i', localAudioPath);
        }

        const clampedBgVol = Math.max(0, Math.min(1, Number(sourceAudioVolume)));
        const clampedVoVol = Math.max(0, Math.min(2, Number(voiceoverVolume)));

        const filterParts: string[] = [
          `[0:v]${videoFilters.join(',')}[vout]`,
        ];

        const bgSourceRef = sourceInfo.hasAudio ? '[0:a]' : '[1:a]';

        if (localAudioPath) {
          const bgFilters: string[] = [];
          const tempo = 1 / speedRatio;
          if (sourceInfo.hasAudio && tempo >= 0.5 && tempo <= 2.0) {
            bgFilters.push(`atempo=${tempo.toFixed(4)}`);
          }
          bgFilters.push(
            `volume=${clampedBgVol.toFixed(2)}`,
            'aformat=sample_rates=48000:channel_layouts=stereo',
            `apad=whole_dur=${clipDuration.toFixed(3)}`,
            `atrim=duration=${clipDuration.toFixed(3)}`
          );

          filterParts.push(`${bgSourceRef}${bgFilters.join(',')}[bg]`);
          filterParts.push(
            `[${voInputIndex}:a]volume=${clampedVoVol.toFixed(2)},aformat=sample_rates=48000:channel_layouts=stereo,apad=whole_dur=${clipDuration.toFixed(3)},atrim=duration=${clipDuration.toFixed(3)}[vo]`
          );
          filterParts.push(
            `[bg][vo]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`
          );
        } else {
          const bgFilters: string[] = [];
          const tempo = 1 / speedRatio;
          if (sourceInfo.hasAudio && tempo >= 0.5 && tempo <= 2.0) {
            bgFilters.push(`atempo=${tempo.toFixed(4)}`);
          }
          const videoOnlyVol = clampedBgVol <= 0 ? 0 : Math.max(0.85, clampedBgVol);
          bgFilters.push(
            `volume=${videoOnlyVol.toFixed(2)}`,
            'aformat=sample_rates=48000:channel_layouts=stereo',
            `apad=whole_dur=${clipDuration.toFixed(3)}`,
            `atrim=duration=${clipDuration.toFixed(3)}`
          );
          filterParts.push(`${bgSourceRef}${bgFilters.join(',')}[aout]`);
        }

        args.push(
          '-filter_complex',
          filterParts.join(';'),
          '-map',
          '[vout]',
          '-map',
          '[aout]',
          '-t',
          clipDuration.toFixed(3),
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '21',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          segOutPath
        );

        await execFileAsync('ffmpeg', args);
        segmentPaths.push(segOutPath);

        subtitleTimings.push({
          start: cumulativeTime,
          end: cumulativeTime + clipDuration - 0.08,
          burmese: clip.burmeseScript.trim(),
        });

        cumulativeTime += clipDuration;
      }

      const concatListPath = path.join(tempDir, 'concat.txt');
      fs.writeFileSync(
        concatListPath,
        segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n')
      );

      const mergedRawPath = path.join(tempDir, 'merged.mp4');
      await execFileAsync('ffmpeg', [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        concatListPath,
        '-c',
        'copy',
        mergedRawPath,
      ]);

      const episode = path.basename(sourcePath).match(/(?:part|episode|ep)[_ -]*(\d+)/i)?.[1];
      const name = episode ? `part${episode}` : `burmese-recap-16x9-${Date.now()}`;
      const finalMp4Name = `${name}.mp4`;
      const finalSrtName = `${name}.srt`;
      const finalMp4Path = path.join(RENDERS_DIR, finalMp4Name);
      const finalSrtPath = path.join(RENDERS_DIR, finalSrtName);
      const tempMp4Path = path.join(tempDir, finalMp4Name);
      const tempSrtPath = path.join(tempDir, finalSrtName);

      // Write SRT for external YouTube upload
      const srtContent = subtitleTimings
        .map(
          (item, idx) =>
            `${idx + 1}\n${formatSrtTime(item.start)} --> ${formatSrtTime(item.end)}\n${item.burmese}\n`
        )
        .join('\n');
      fs.writeFileSync(tempSrtPath, srtContent, 'utf8');

      if (includeSubtitles) {
        const assPath = path.join(tempDir, 'subtitles.ass');
        const assHeader = `[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: BurmeseMain,Noto Sans Myanmar,28,&H00FFFFFF,&H000000FF,&H000A0D14,&H880A0D14,-1,0,0,0,100,100,0,0,1,2.2,1.2,2,64,64,26,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
        const assEvents = subtitleTimings
          .map(
            (item) =>
              `Dialogue: 0,${formatAssTime(item.start)},${formatAssTime(item.end)},BurmeseMain,,0,0,0,,${escapeAssText(item.burmese)}`
          )
          .join('\n');

        fs.writeFileSync(assPath, assHeader + assEvents, 'utf8');

        await execFileAsync(
          'ffmpeg',
          [
            '-y',
            '-i',
            mergedRawPath,
            '-vf',
            'ass=subtitles.ass',
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '20',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'copy',
            '-movflags',
            '+faststart',
            tempMp4Path,
          ],
          { cwd: tempDir }
        );
      } else {
        await execFileAsync('ffmpeg', [
          '-y',
          '-i',
          mergedRawPath,
          '-c',
          'copy',
          '-movflags',
          '+faststart',
          tempMp4Path,
        ]);
      }

      fs.renameSync(tempMp4Path, finalMp4Path);
      fs.renameSync(tempSrtPath, finalSrtPath);
      const stats = fs.statSync(finalMp4Path);
      const totalDuration = await probeDuration(finalMp4Path);

      res.json({
        videoUrl: `/renders/${finalMp4Name}`,
        srtUrl: `/renders/${finalSrtName}`,
        durationSec: totalDuration,
        fileSizeBytes: stats.size,
        width: 1280,
        height: 720,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to render 16:9 recap video.';
      console.error('Render error:', err);
      res.status(500).json({ error: message });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(ROOT_DIR, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`RecapCut Studio running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
