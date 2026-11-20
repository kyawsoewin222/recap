import { GoogleGenAI, Type } from '@google/genai';
import { execFile } from 'child_process';
import crypto from 'crypto';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { createServer as createViteServer } from 'vite';
import { parseSrt } from './src/data/srt.ts';
import { getSegmentTiming } from './src/data/timing.ts';
import { alignedSubtitleCues } from './src/data/alignment.ts';

dotenv.config();

const execFileAsync = promisify(execFile);

const PORT = 3000;
const ROOT_DIR = process.cwd();
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const TTS_DIR = path.join(PUBLIC_DIR, 'tts');
const RENDERS_DIR = path.join(PUBLIC_DIR, 'renders');
const AISTUDIO_DIR = path.join(PUBLIC_DIR, 'assets', 'aistudio');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');
const SOURCE_VIDEO_PATH = path.join(
  PUBLIC_DIR,
  'assets',
  'aistudio',
  'part9.mp4'
);

fs.mkdirSync(TTS_DIR, { recursive: true });
fs.mkdirSync(RENDERS_DIR, { recursive: true });
fs.mkdirSync(AISTUDIO_DIR, { recursive: true });
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
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('Could not measure media duration. Regenerate narration and retry.');
  return parsed;
}

function narrationCues(audioPath: string, text: string, duration: number) {
  const metadataPath = audioPath.replace(/\.[^.]+$/, '.json');
  if (fs.existsSync(metadataPath)) {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    if (metadata.text !== text.trim()) throw new Error('Narration changed. Regenerate its audio.');
    return alignedSubtitleCues(text.trim(), duration, metadata.boundaries);
  }
  return alignedSubtitleCues(text.trim(), duration);
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
  const cleanRel = decodeURIComponent(sourceVideoUrl.split('?')[0]).replace(/^\/+/, '');
  if (!cleanRel.startsWith('assets/') && !cleanRel.startsWith('uploads/')) {
    throw new Error('Invalid source video URL.');
  }
  const resolved = path.resolve(PUBLIC_DIR, cleanRel);
  if (!resolved.startsWith(path.resolve(PUBLIC_DIR) + path.sep)) {
    throw new Error('Invalid source video path.');
  }
  return resolved;
}

function projectNameFromSource(sourcePath: string): string | null {
  const relative = path.relative(AISTUDIO_DIR, path.dirname(sourcePath));
  return relative && relative !== '..' && !relative.includes(path.sep) ? relative : null;
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
  const clamped = Math.round(Math.max(0, seconds) * 1000);
  const h = Math.floor(clamped / 3600000);
  const m = Math.floor((clamped % 3600000) / 60000);
  const s = Math.floor((clamped % 60000) / 1000);
  const ms = clamped % 1000;
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
    const fileName = path.basename(decodedName.replace(/\\/g, '/'));
    const ext = path.extname(fileName).toLowerCase() || '.mp4';
    const allowedExt = ['.mp4', '.mov', '.mkv', '.webm', '.m4v'];
    const safeExt = allowedExt.includes(ext) ? ext : '.mp4';
    const stem = path.basename(fileName, path.extname(fileName)).normalize('NFC');
    const projectBase = Array.from(stem).slice(0, 10).join('')
      .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_')
      .replace(/[. ]+$/g, '') || 'episode';
    let projectName = projectBase;
    let projectDir = path.join(AISTUDIO_DIR, projectName);
    for (let suffix = 2; ; suffix++) {
      if (fs.existsSync(path.join(RENDERS_DIR, projectName))) {
        projectName = `${projectBase}-${suffix}`;
        projectDir = path.join(AISTUDIO_DIR, projectName);
        continue;
      }
      try {
        fs.mkdirSync(projectDir);
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        projectName = `${projectBase}-${suffix}`;
        projectDir = path.join(AISTUDIO_DIR, projectName);
      }
    }
    fs.mkdirSync(path.join(RENDERS_DIR, projectName));
    const baseName = Array.from(stem
      .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_')
      .replace(/[. ]+$/g, '')).slice(0, 48).join('') || 'episode';
    const savedName = `${baseName}-${Date.now()}${safeExt}`;
    const destPath = path.join(projectDir, savedName);
    const cleanupUpload = () => {
      fs.rmSync(destPath, { force: true });
      for (const dir of [projectDir, path.join(RENDERS_DIR, projectName)]) {
        try { fs.rmdirSync(dir); } catch { /* Keep nonempty folders. */ }
      }
    };

    const writeStream = fs.createWriteStream(destPath);
    let receivedBytes = 0;

    req.on('data', (chunk: Buffer) => {
      receivedBytes += chunk.length;
    });

    req.pipe(writeStream);

    writeStream.on('finish', async () => {
      try {
        if (receivedBytes < 1024) {
          cleanupUpload();
          res.status(400).json({ error: 'Uploaded video file is empty or invalid.' });
          return;
        }
        const info = await probeVideoInfo(destPath);
        if (info.durationSec <= 0) {
          cleanupUpload();
          res.status(400).json({ error: 'Could not read video duration from uploaded file.' });
          return;
        }
        res.json({
          sourceVideoUrl: `/assets/aistudio/${encodeURIComponent(projectName)}/${encodeURIComponent(savedName)}`,
          fileName,
          projectName,
          durationSec: info.durationSec,
          width: info.width,
          height: info.height,
          fileSizeBytes: receivedBytes,
        });
      } catch (err: unknown) {
        cleanupUpload();
        const message = err instanceof Error ? err.message : 'Failed to process uploaded video.';
        res.status(500).json({ error: message });
      }
    });

    const handleStreamError = (err: unknown) => {
      cleanupUpload();
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

  app.get('/api/projects/:project/download', async (req, res) => {
    const project = req.params.project;
    if (!project || project === '.' || project === '..' || path.basename(project) !== project) {
      res.status(400).json({ error: 'Invalid project name.' });
      return;
    }
    const sourceDir = path.join(AISTUDIO_DIR, project);
    const renderDir = path.join(RENDERS_DIR, project);
    if (!fs.existsSync(sourceDir) || !fs.existsSync(renderDir)) {
      res.status(404).json({ error: 'Project folder was not found.' });
      return;
    }
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recapcut-'));
    const zipPath = path.join(tempDir, `${project}.zip`);
    try {
      await execFileAsync('python3', ['-c', `
from pathlib import Path
from zipfile import ZipFile, ZIP_STORED
import sys
archive, project, source, renders = sys.argv[1:]
with ZipFile(archive, 'w', compression=ZIP_STORED) as zip_file:
    for label, directory in [('aistudio', Path(source)), ('renders', Path(renders))]:
        for file in directory.rglob('*'):
            if file.is_file():
                zip_file.write(file, f'{project}/{label}/{file.relative_to(directory)}')
`, zipPath, project, sourceDir, renderDir]);
      res.download(zipPath, `${project}.zip`, () => {
        fs.rmSync(tempDir, { recursive: true, force: true });
      });
    } catch (err) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      const message = err instanceof Error ? err.message : 'Could not package project.';
      res.status(500).json({ error: message });
    }
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
        .update(`natural-v2:${selectedVoice}:${text.trim()}`)
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
                    'Natural, consistent Burmese speaking pace. Speak clearly and preserve every word; do not rush.',
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
      const temporary = `${outPath}.${crypto.randomBytes(6).toString('hex')}.pcm`;
      try {
        if (wavBuffer.subarray(0, 4).toString() === 'RIFF') {
          fs.writeFileSync(outPath, wavBuffer);
        } else {
          // Gemini returns raw 24 kHz PCM; a .wav extension alone does not add a header.
          fs.writeFileSync(temporary, wavBuffer);
          await execFileAsync('ffmpeg', ['-v', 'error', '-y', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', temporary, outPath]);
        }
        await probeDuration(outPath);
      } catch (error) {
        fs.rmSync(outPath, { force: true });
        throw error;
      } finally {
        fs.rmSync(temporary, { force: true });
      }
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
          const prompt = `Analyze this ${chunk.durationSec.toFixed(1)}-second video clip and create a chronological YouTube movie recap storyboard with natural Burmese narration.

Rules:
1. Do NOT copy or translate spoken/subtitle dialogue word-for-word. Describe all events using original recap narration wording for copyright safety.
2. Cover the whole key plot chronologically. Remove repetition only. Preserve identities, actions, motivations, cause and effect, outcomes, important dialogue meaning, and reveals. Do not invent facts or change chronology. Compare narration against the source context before returning it.
3. Prefer concise segments, but retain essential meaning even when a segment must be longer.
4. Provide accurate sourceStart and sourceEnd in seconds relative to THIS video clip (0 to ${chunk.durationSec.toFixed(1)}), with sourceEnd > sourceStart + 1.2.
5. Set targetDuration as an estimate at a natural speaking pace; short durations are preferences, never hard caps. Select enough relevant footage to fit narration at 0.85x–1.15x video playback. Do not borrow unrelated scenes.
6. Write natural, clear spoken Burmese (Myanmar Unicode) in burmeseScript, plus concise English summary in englishScript and a short 2-3 word title.`;

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
            const targetDur = Math.max(1, Number(item.targetDuration) || relEnd - relStart);
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

  app.post('/api/import-srt', async (req, res) => {
    const { sourceVideoUrl, srt } = req.body;
    if (typeof srt !== 'string' || Buffer.byteLength(srt) > 1024 * 1024) {
      res.status(400).json({ error: 'Choose an SRT file of 1 MB or less.' });
      return;
    }
    try {
      const sourcePath = resolveSourceVideoPath(sourceVideoUrl);
      if (!fs.existsSync(sourcePath)) {
        res.status(404).json({ error: 'Upload a matching source video before importing the SRT.' });
        return;
      }
      const { durationSec } = await probeVideoInfo(sourcePath);
      if (durationSec <= 0) throw new Error('Could not read the source video duration.');
      res.json({ clips: parseSrt(srt, durationSec) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Could not import SRT.' });
    }
  });

  app.post('/api/srt-tts', async (req, res) => {
    const { clipId, text, voiceName } = req.body;
    if (!Number.isSafeInteger(clipId) || clipId < 1 || typeof text !== 'string' ||
        !text.trim() || !['my-MM-ThihaNeural', 'my-MM-NilarNeural'].includes(voiceName)) {
      res.status(400).json({ error: 'A cue number, narration text, and Burmese voice are required.' });
      return;
    }
    try {
      const python = process.env.EDGE_TTS_PYTHON || 'python3';
      const script = path.join(ROOT_DIR, 'python_pipeline', 'edge_tts_service.py');
      const job = execFileAsync(python, [script, String(clipId), voiceName, TTS_DIR], {
        timeout: 120_000,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });
      job.child.stdin?.on('error', () => {});
      job.child.stdin?.end(text, 'utf8');
      const { stdout } = await job;
      const name = stdout.trim();
      if (!/^clip-\d+-[a-f0-9]{12}\.mp3$/.test(name)) throw new Error('Unexpected narration output.');
      const audioPath = path.join(TTS_DIR, name);
      const durationSec = await probeDuration(audioPath);
      res.json({ audioUrl: `/tts/${name}`, durationSec, ...narrationCues(audioPath, text, durationSec) });
    } catch (err) {
      console.error('SRT narration failed:', err);
      const missing = err instanceof Error && /No module named 'edge_tts'|ENOENT/.test(err.message);
      res.status(502).json({
        error: missing
          ? 'Edge TTS is unavailable. Install edge-tts in the Python environment used by the server.'
          : 'Edge TTS could not generate this cue. Check the connection and try again.',
      });
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
        scriptSource = 'gemini',
        sample = false,
      } = req.body as {
        clips: RenderClipInput[];
        sourceVideoUrl?: string;
        includeSubtitles?: boolean;
        maskBottomSubtitles?: boolean;
        sourceAudioVolume?: number;
        voiceoverVolume?: number;
        scriptSource?: 'gemini' | 'srt';
        sample?: boolean;
      };
      const fromSrt = scriptSource === 'srt';

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
      const invalid = clips.findIndex((clip, i) =>
        !clip || !Number.isFinite(clip.sourceStart) || !Number.isFinite(clip.sourceEnd) ||
        clip.sourceStart < 0 || clip.sourceEnd <= clip.sourceStart ||
        clip.sourceEnd > sourceInfo.durationSec || typeof clip.burmeseScript !== 'string' ||
        (i > 0 && clip.sourceStart < clips[i - 1].sourceEnd) ||
        !clip.burmeseScript.trim() || typeof clip.audioUrl !== 'string' ||
        !/^\/tts\/clip-\d+-[a-f0-9]{12}\.(mp3|wav)$/.test(clip.audioUrl) ||
        !fs.existsSync(path.join(TTS_DIR, path.basename(clip.audioUrl))));
      if (invalid >= 0) {
        res.status(400).json({ error: `Segment ${invalid + 1} needs a chronological source range and generated narration. Regenerate audio before exporting.` });
        return;
      }

      for (const clip of clips) {
        const voices = clip.audioUrl!.endsWith('.mp3')
          ? ['my-MM-ThihaNeural', 'my-MM-NilarNeural'].map(voice => `${voice}:+0%:${clip.burmeseScript.trim()}`)
          : ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'].map(voice => `natural-v2:${voice}:${clip.burmeseScript.trim()}`);
        if (!voices.some(key => clip.audioUrl!.includes(crypto.createHash('sha1').update(key).digest('hex').slice(0, 12)))) {
          throw new Error(`Segment ${clip.id}: narration changed or audio uses an old speaking style. Regenerate its audio.`);
        }
      }

      if (includeSubtitles) {
        const { stdout } = await execFileAsync('ffmpeg', ['-hide_banner', '-filters']);
        if (!/\bass\s+V->V/.test(stdout)) {
          throw new Error('Burned subtitles require an FFmpeg build with libass. Select subtitles Off to export video plus SRT, or configure a libass-enabled FFmpeg.');
        }
      }
      fs.mkdirSync(tempDir, { recursive: true });

      const mergedRawPath = path.join(tempDir, 'merged.mp4');
      const subtitleTimings: Array<{ start: number; end: number; burmese: string }> = [];
      let subtitleTiming = 'aligned';

      {
        const segmentPaths: string[] = [];
        const segmentDurations: number[] = [];

        let cumulativeTime = 0;

        for (let i = 0; i < clips.length; i++) {
          const clip = clips[i];
          const srcStart = clip.sourceStart;
          const srcEnd = clip.sourceEnd;
          const rawSrcDur = srcEnd - srcStart;

          const localAudioPath = path.join(TTS_DIR, path.basename(clip.audioUrl!));
          const ttsDur = await probeDuration(localAudioPath);
          const { duration: clipDuration, speed } = getSegmentTiming(clip, ttsDur);
          const speedRatio = 1 / speed;
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
          segmentDurations.push(clipDuration);

          const cueData = narrationCues(localAudioPath, clip.burmeseScript, ttsDur);
          if (cueData.subtitleTiming === 'approximate') subtitleTiming = 'approximate';
          subtitleTimings.push(...cueData.subtitleCues.map(cue => ({
            ...cue, start: cumulativeTime + cue.start, end: cumulativeTime + cue.end,
          })));

          cumulativeTime += clipDuration;
        }

        const concatListPath = path.join(tempDir, 'concat.txt');
        fs.writeFileSync(
          concatListPath,
          segmentPaths.map((p, i) => `file '${p.replace(/'/g, "'\\''")}'\nduration ${segmentDurations[i].toFixed(6)}`).join('\n')
        );

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
          '-t', cumulativeTime.toFixed(3),
          mergedRawPath,
        ]);
      }

      const episode = path.basename(sourcePath).match(/(?:part|episode|ep)[_ -]*(\d+)/i)?.[1];
      const renderName = fromSrt
        ? `srt-recap-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
        : episode ? `part${episode}` : `burmese-recap-16x9-${Date.now()}`;
      const name = sample ? `${renderName}-sample-${Date.now()}` : renderName;
      const finalMp4Name = `${name}.mp4`;
      const finalSrtName = `${name}.srt`;
      const projectName = projectNameFromSource(sourcePath);
      const outputDir = projectName ? path.join(RENDERS_DIR, projectName) : RENDERS_DIR;
      fs.mkdirSync(outputDir, { recursive: true });
      const finalMp4Path = path.join(outputDir, finalMp4Name);
      const finalSrtPath = path.join(outputDir, finalSrtName);
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
        videoUrl: `/renders/${projectName ? `${encodeURIComponent(projectName)}/` : ''}${finalMp4Name}`,
        srtUrl: `/renders/${projectName ? `${encodeURIComponent(projectName)}/` : ''}${finalSrtName}`,
        downloadUrl: projectName ? `/api/projects/${encodeURIComponent(projectName)}/download` : undefined,
        durationSec: totalDuration,
        fileSizeBytes: stats.size,
        width: 1280,
        height: 720,
        subtitleTiming,
        warning: subtitleTiming === 'approximate' ? 'Subtitle phrases use approximate timing, not speech alignment. Review the sample before processing the full project.' : 'Subtitles use provider speech boundaries. Review the sample before processing the full project.',
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
