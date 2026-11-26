import { GoogleGenAI, Type } from '@google/genai';
import { execFile, spawn } from 'child_process';
import crypto from 'crypto';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { createServer as createViteServer } from 'vite';
import { buildSrtFromClips, parseSrt } from './src/data/srt.ts';
import { estimateBurmeseSpeechSec, wrapBurmeseCueLines } from './src/data/timing.ts';

dotenv.config();

const execFileAsync = promisify(execFile);

const PORT = 3000;
const ROOT_DIR = process.cwd();
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const RENDERS_DIR = path.join(PUBLIC_DIR, 'renders');
const AISTUDIO_DIR = path.join(PUBLIC_DIR, 'assets', 'aistudio');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');
const SOURCE_VIDEO_PATH = path.join(
  PUBLIC_DIR,
  'assets',
  'aistudio',
  'part9.mp4'
);

fs.mkdirSync(RENDERS_DIR, { recursive: true });
fs.mkdirSync(AISTUDIO_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export type AiProvider = 'gemini' | 'agy';

const AGY_BIN = process.env.AGY_BIN || 'agy';
const AGY_TEXT_MODEL =
  process.env.AGY_TEXT_MODEL || process.env.AGY_MODEL || 'gemini-4-hydrogen-medium';
const AGY_VIDEO_MODEL =
  process.env.AGY_VIDEO_MODEL || process.env.AGY_MODEL || 'gemini-4-argon-medium';
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-4-hydrogen';
const GEMINI_VIDEO_MODEL = process.env.GEMINI_VIDEO_MODEL || 'gemini-4-hydrogen';

function hasConfiguredGeminiKey(): boolean {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  return Boolean(key && key !== 'MY_GEMINI_API_KEY');
}

function resolveAiProvider(override?: string): AiProvider {
  const mode = (override || process.env.AI_PROVIDER || 'auto').trim().toLowerCase();
  if (mode === 'gemini') return 'gemini';
  if (mode === 'agy') return 'agy';
  return hasConfiguredGeminiKey() ? 'gemini' : 'agy';
}

function getAiClient(): GoogleGenAI {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!hasConfiguredGeminiKey()) {
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

interface AgyPromptOptions {
  model: string;
  prompt: string;
  jsonSchema?: unknown;
  conversationId?: string;
  addDirs?: string[];
}

interface AgyPromptResult {
  text: string;
  structuredOutput: unknown;
  conversationId?: string;
}

async function runAgyPrompt(options: AgyPromptOptions): Promise<AgyPromptResult> {
  const args = [
    '-p',
    options.prompt,
    '--model',
    options.model,
    '--disable-slash-commands',
    '--dangerously-skip-permissions',
    '--output-format',
    'json',
  ];

  if (options.jsonSchema !== undefined) {
    args.push(
      '--json-schema',
      typeof options.jsonSchema === 'string'
        ? options.jsonSchema
        : JSON.stringify(options.jsonSchema)
    );
  }
  if (options.conversationId) {
    args.push('-r', options.conversationId);
  }
  for (const dir of options.addDirs || []) {
    if (dir) {
      args.push('--add-dir', dir);
    }
  }

  const { stdout, stderr, exitCode } = await new Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
  }>((resolve, reject) => {
    const child = spawn(AGY_BIN, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdoutBuf = '';
    let stderrBuf = '';
    child.stdout.on('data', (chunk: Buffer | string) => {
      stdoutBuf += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderrBuf += chunk.toString();
    });
    child.on('error', (err) => {
      reject(new Error(`Failed to launch ${AGY_BIN}: ${err.message}`));
    });
    child.on('close', (code) => {
      resolve({ stdout: stdoutBuf, stderr: stderrBuf, exitCode: code });
    });
  });

  if (exitCode !== 0) {
    const detail = (stderr || stdout).trim().slice(0, 600);
    throw new Error(
      `agy CLI exited with code ${exitCode}${detail ? `: ${detail}` : ''}`
    );
  }

  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error('agy CLI returned empty output.');
  }

  let envelope: {
    status?: string;
    response?: unknown;
    structured_output?: unknown;
    conversation_id?: unknown;
    error?: unknown;
    message?: unknown;
  };
  try {
    envelope = JSON.parse(trimmed);
  } catch {
    const lastLine = trimmed.split(/\r?\n/).filter(Boolean).pop() || '';
    try {
      envelope = JSON.parse(lastLine);
    } catch {
      throw new Error(`Invalid JSON output from agy CLI: ${trimmed.slice(0, 400)}`);
    }
  }

  if (envelope.status !== 'SUCCESS') {
    const errDetail =
      (typeof envelope.error === 'string' && envelope.error) ||
      (typeof envelope.message === 'string' && envelope.message) ||
      `status=${String(envelope.status || 'UNKNOWN')}`;
    throw new Error(`agy CLI failed: ${errDetail}`);
  }

  return {
    text: typeof envelope.response === 'string' ? envelope.response : '',
    structuredOutput: envelope.structured_output,
    conversationId:
      typeof envelope.conversation_id === 'string' ? envelope.conversation_id : undefined,
  };
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
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('Could not measure media duration.');
  return parsed;
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
    const RESERVED_PUBLIC_DIRS = new Set(['assets', 'tts', 'renders', 'uploads', 'output']);
    let projectName = RESERVED_PUBLIC_DIRS.has(projectBase.toLowerCase()) ? `${projectBase}-2` : projectBase;
    let projectDir = path.join(AISTUDIO_DIR, projectName);
    for (let suffix = 2; ; suffix++) {
      if (
        RESERVED_PUBLIC_DIRS.has(projectName.toLowerCase()) ||
        fs.existsSync(path.join(PUBLIC_DIR, projectName)) ||
        fs.existsSync(path.join(RENDERS_DIR, projectName))
      ) {
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
    fs.mkdirSync(path.join(PUBLIC_DIR, projectName));
    const baseName = Array.from(stem
      .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_')
      .replace(/[. ]+$/g, '')).slice(0, 48).join('') || 'episode';
    const savedName = `${baseName}-${Date.now()}${safeExt}`;
    const destPath = path.join(projectDir, savedName);
    const cleanupUpload = () => {
      fs.rmSync(destPath, { force: true });
      for (const dir of [projectDir, path.join(PUBLIC_DIR, projectName)]) {
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
  app.use('/renders', express.static(RENDERS_DIR));
  app.use('/uploads', express.static(UPLOADS_DIR));
  app.use(express.static(PUBLIC_DIR, { index: false }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      sourceExists: fs.existsSync(SOURCE_VIDEO_PATH),
      aiProvider: resolveAiProvider(),
    });
  });

  app.get('/api/projects/:project/download', async (req, res) => {
    const project = req.params.project;
    if (!project || project === '.' || project === '..' || path.basename(project) !== project) {
      res.status(400).json({ error: 'Invalid project name.' });
      return;
    }
    const sourceDir = path.join(AISTUDIO_DIR, project);
    const renderDir = fs.existsSync(path.join(PUBLIC_DIR, project))
      ? path.join(PUBLIC_DIR, project)
      : path.join(RENDERS_DIR, project);
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

  app.post('/api/translate', async (req, res) => {
    try {
      const { englishScript, videoDuration, provider: providerOverride } = req.body as {
        englishScript: string;
        videoDuration?: number;
        provider?: string;
      };
      if (!englishScript || !englishScript.trim()) {
        res.status(400).json({ error: 'English script text is required.' });
        return;
      }

      const provider = resolveAiProvider(providerOverride);
      const durHint =
        typeof videoDuration === 'number' && Number.isFinite(videoDuration) && videoDuration > 0
          ? `Fit comfortably within ${videoDuration.toFixed(1)} seconds at natural 1.0x speaking speed (target ~${Math.max(18, Math.floor((videoDuration - 0.55) * 7.8))} Burmese characters/graphemes, 1–2 short easy-to-read subtitle lines).`
          : 'Keep it concise (1–2 short, easy-to-read subtitle lines).';

      const prompt = `Rewrite this movie recap beat into natural, conversational spoken Burmese storytelling (like telling a story to a friend, NOT stiff book-style writing). Preserve character names, actions, cause, and outcome without adding facts. ${durHint} Return ONLY the Burmese narration text with no quotes or notes:\n\n${englishScript.trim()}`;

      let rawText: string | undefined;
      if (provider === 'gemini') {
        const ai = getAiClient();
        const response = await withGeminiRetry(() =>
          ai.models.generateContent({
            model: GEMINI_TEXT_MODEL,
            contents: prompt,
          })
        );
        rawText = response.text;
      } else {
        const agyResult = await runAgyPrompt({
          model: AGY_TEXT_MODEL,
          prompt,
        });
        rawText = agyResult.text;
      }

      const burmeseScript = rawText?.trim();
      if (!burmeseScript) {
        res.status(502).json({
          error: `Empty translation returned from ${provider === 'agy' ? 'agy CLI' : 'Gemini'}.`,
        });
        return;
      }

      res.json({
        burmeseScript,
        estimatedSpeechSec: estimateBurmeseSpeechSec(burmeseScript),
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to translate narration.';
      console.error('Translate error:', err);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/shorten-clip', async (req, res) => {
    try {
      const { burmeseScript, englishScript, sourceStart, sourceEnd, provider: providerOverride } =
        req.body as {
          burmeseScript: string;
          englishScript?: string;
          sourceStart: number;
          sourceEnd: number;
          provider?: string;
        };
      if (!burmeseScript || !burmeseScript.trim()) {
        res.status(400).json({ error: 'Burmese script text is required.' });
        return;
      }
      const provider = resolveAiProvider(providerOverride);
      const videoDuration = Math.max(1.5, Number(sourceEnd) - Number(sourceStart) || 5);
      const targetGraphemes = Math.max(18, Math.floor((videoDuration - 0.55) * 7.8));

      const prompt = `Condense this Burmese movie recap line so a narrator speaking at normal 1.0x speed finishes comfortably inside ${videoDuration.toFixed(1)} seconds (around ${targetGraphemes} Burmese characters/graphemes or fewer, 1–2 short readable subtitle lines).

Rules:
- Remove repetition and wordy filler ONLY.
- Keep character names, key actions, cause/effect, and outcome intact (do NOT destroy story meaning or invent facts).
- Use natural, conversational spoken Burmese storytelling (not stiff textbook style).
- Return ONLY the shortened Burmese text with no quotes or explanations.

English plot reference: ${(englishScript || '').trim() || '(none)'}
Original Burmese text: ${burmeseScript.trim()}`;

      let rawText: string | undefined;
      if (provider === 'gemini') {
        const ai = getAiClient();
        const response = await withGeminiRetry(() =>
          ai.models.generateContent({
            model: GEMINI_TEXT_MODEL,
            contents: prompt,
          })
        );
        rawText = response.text;
      } else {
        const agyResult = await runAgyPrompt({
          model: AGY_TEXT_MODEL,
          prompt,
        });
        rawText = agyResult.text;
      }

      const shortened = rawText?.trim();
      if (!shortened) {
        res.status(502).json({
          error: `Empty shortened narration returned from ${provider === 'agy' ? 'agy CLI' : 'Gemini'}.`,
        });
        return;
      }

      res.json({
        burmeseScript: shortened,
        estimatedSpeechSec: estimateBurmeseSpeechSec(shortened),
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to shorten narration.';
      console.error('Shorten clip error:', err);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/analyze-episode', async (req, res) => {
    const tempChunkDir = path.join(
      RENDERS_DIR,
      `analyze-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );

    try {
      const { sourceVideoUrl, provider: providerOverride } = req.body as {
        sourceVideoUrl?: string;
        provider?: string;
      };
      const sourcePath = resolveSourceVideoPath(sourceVideoUrl);
      if (!fs.existsSync(sourcePath)) {
        res.status(404).json({ error: 'Uploaded episode file was not found on server.' });
        return;
      }

      const provider = resolveAiProvider(providerOverride);
      const info = await probeVideoInfo(sourcePath);
      const totalDur = Math.max(1, info.durationSec);

      type RawAnalyzedClip = {
        title: string;
        sourceStart: number;
        sourceEnd: number;
        targetDuration: number;
        englishScript: string;
        burmeseScript: string;
      };

      const allClips: Array<RawAnalyzedClip & { id: number }> = [];
      let nextId = 1;

      const appendValidatedClips = (
        items: RawAnalyzedClip[],
        chunkOffsetSec: number,
        chunkDurationSec: number,
        providerLabel: string
      ) => {
        let prevRelEnd = 0;
        for (const item of items) {
          const relStart = Number(item.sourceStart);
          const relEnd = Number(item.sourceEnd);
          const burmeseScript = String(item.burmeseScript || '').trim();
          if (
            !Number.isFinite(relStart) ||
            !Number.isFinite(relEnd) ||
            relStart < prevRelEnd ||
            relStart < 0 ||
            relEnd <= relStart ||
            relEnd > chunkDurationSec ||
            !burmeseScript
          ) {
            throw new Error(
              `${providerLabel} returned an invalid scene or empty Burmese text. Please analyze the episode again.`
            );
          }
          prevRelEnd = relEnd;
          const spanDur = relEnd - relStart;
          allClips.push({
            id: nextId,
            title: `${String(nextId).padStart(2, '0')}. ${(item.title || `Scene ${nextId}`).replace(/^\d+\.\s*/, '')}`,
            sourceStart: Number((chunkOffsetSec + relStart).toFixed(2)),
            sourceEnd: Number((chunkOffsetSec + relEnd).toFixed(2)),
            targetDuration: Number(spanDur.toFixed(2)),
            englishScript: String(item.englishScript || '').trim(),
            burmeseScript,
          });
          nextId++;
        }
      };

      const buildStoryboardPrompt = (chunkDurationSec: number) =>
        `Analyze this ${chunkDurationSec.toFixed(1)}-second video clip and create a chronological YouTube movie recap storyboard with natural spoken Burmese storytelling.

Rules:
1. Tell the story in original, natural spoken Burmese, not a word-for-word dialogue transcript. Do not invent facts.
2. Preserve the essential plot chronologically: character identities, actions, motivations, cause and effect, important dialogue meaning, reveals, and outcomes. Skip repetition and dead time first; never cut an essential story beat to meet a duration.
3. Aim for selected scenes totaling around 40–60% of this episode (roughly 2–3 minutes for a 5-minute episode). Allow longer when necessary for story clarity.
4. Choose complete, relevant visuals and write concise Burmese storytelling for each scene. Allow enough scene time for the text and important action; do not cut off meaningful action to meet a fixed cue length.
5. Provide accurate, strictly chronological, non-overlapping source timestamps relative to THIS video clip (0 to ${chunkDurationSec.toFixed(1)}), with sourceEnd > sourceStart and targetDuration = sourceEnd - sourceStart.
6. Return burmeseScript (Myanmar Unicode), a concise englishScript summary, and a short title.`;

      if (provider === 'gemini') {
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
            const prompt = buildStoryboardPrompt(chunk.durationSec);
            const response = await withGeminiRetry(() =>
              ai.models.generateContent({
                model: GEMINI_VIDEO_MODEL,
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
            const parsed = JSON.parse(rawText) as RawAnalyzedClip[];
            appendValidatedClips(parsed, chunk.offsetSec, chunk.durationSec, 'Gemini');
          } finally {
            if (fileState.name) {
              await ai.files.delete({ name: fileState.name }).catch(() => {});
            }
          }
        }
      } else {
        const CHUNK_SEC = 600; // 10-minute proxy chunk boundary for agy CLI
        const chunkFiles: Array<{ filePath: string; offsetSec: number; durationSec: number }> = [];

        fs.mkdirSync(tempChunkDir, { recursive: true });
        for (let start = 0, idx = 0; start < totalDur; start += CHUNK_SEC, idx++) {
          const dur = Math.min(CHUNK_SEC, totalDur - start);
          const chunkPath = path.join(tempChunkDir, `proxy-chunk-${idx}.mp4`);
          await execFileAsync('ffmpeg', [
            '-y',
            '-ss',
            start.toFixed(2),
            '-t',
            dur.toFixed(2),
            '-i',
            sourcePath,
            '-vf',
            'scale=640:-2',
            '-r',
            '1',
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '32',
            '-c:a',
            'aac',
            '-b:a',
            '48k',
            chunkPath,
          ]);
          chunkFiles.push({ filePath: chunkPath, offsetSec: start, durationSec: dur });
        }

        const agyAnalyzeSchema = {
          type: 'object',
          properties: {
            clips: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  sourceStart: { type: 'number' },
                  sourceEnd: { type: 'number' },
                  targetDuration: { type: 'number' },
                  englishScript: { type: 'string' },
                  burmeseScript: { type: 'string' },
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
          required: ['clips'],
        };

        let conversationId: string | undefined;
        for (let idx = 0; idx < chunkFiles.length; idx++) {
          const chunk = chunkFiles[idx];
          const continuationHint =
            idx > 0
              ? `This is chunk ${idx + 1} of ${chunkFiles.length} (starting at ${chunk.offsetSec.toFixed(1)}s in the full episode). Continue the story seamlessly from the previous chunk without repeating earlier scenes.\n\n`
              : '';
          const agyPrompt = `${continuationHint}First, inspect the video file at \`${chunk.filePath}\` using the \`read_file\` tool.\n\n${buildStoryboardPrompt(chunk.durationSec)}\n\nReturn a JSON object matching the schema with a \`clips\` array.`;

          const agyResult = await runAgyPrompt({
            model: AGY_VIDEO_MODEL,
            prompt: agyPrompt,
            jsonSchema: agyAnalyzeSchema,
            addDirs: [tempChunkDir],
            conversationId,
          });

          if (agyResult.conversationId) {
            conversationId = agyResult.conversationId;
          }

          let payload = agyResult.structuredOutput;
          if (payload === undefined || payload === null) {
            payload = JSON.parse((agyResult.text || '{}').trim());
          }
          const parsedClips = Array.isArray(payload)
            ? (payload as RawAnalyzedClip[])
            : Array.isArray((payload as { clips?: unknown })?.clips)
              ? ((payload as { clips: RawAnalyzedClip[] }).clips)
              : [];

          appendValidatedClips(parsedClips, chunk.offsetSec, chunk.durationSec, 'agy CLI');
        }
      }

      if (allClips.length === 0) {
        res.status(502).json({
          error: `${provider === 'agy' ? 'agy CLI' : 'Gemini'} returned no recap segments for this video.`,
        });
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

  app.post('/api/render', async (req, res) => {
    const tempDir = path.join(
      RENDERS_DIR,
      `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );

    try {
      const {
        clips,
        sourceVideoUrl,
        includeSubtitles = false,
        maskBottomSubtitles = false,
        scriptSource = 'gemini',
        sample = false,
      } = req.body as {
        clips: RenderClipInput[];
        sourceVideoUrl?: string;
        includeSubtitles?: boolean;
        maskBottomSubtitles?: boolean;
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

      const invalidRange = clips.findIndex((clip, i) =>
        !clip || !Number.isFinite(clip.sourceStart) || !Number.isFinite(clip.sourceEnd) ||
        clip.sourceStart < 0 || clip.sourceEnd <= clip.sourceStart ||
        clip.sourceEnd > sourceInfo.durationSec || typeof clip.burmeseScript !== 'string' ||
        (i > 0 && clip.sourceStart < clips[i - 1].sourceEnd) ||
        !clip.burmeseScript.trim()
      );
      if (invalidRange >= 0) {
        res.status(400).json({ error: `Segment ${invalidRange + 1} needs a valid chronological source range (within 0–${sourceInfo.durationSec.toFixed(1)}s) and non-empty Burmese text.` });
        return;
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
      const renderedClips: RenderClipInput[] = [];
      const subtitleTiming = 'scene-matched';

      {
        const segmentPaths: string[] = [];
        const segmentDurations: number[] = [];

        let cumulativeTime = 0;
        for (let i = 0; i < clips.length; i++) {
          const clip = clips[i];
          const srcStart = clip.sourceStart;
          const srcEnd = clip.sourceEnd;
          const rawSrcDur = srcEnd - srcStart;

          const segOutPath = path.join(
            tempDir,
            `seg-${String(i).padStart(2, '0')}.mp4`
          );

          const videoFilters = [
            'scale=1280:720:force_original_aspect_ratio=increase',
            'crop=1280:720',
            'fps=25',
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
              '-vf',
              videoFilters.join(','),
              '-t',
              rawSrcDur.toFixed(3),
              '-c:v',
              'libx264',
              '-preset',
              'veryfast',
              '-crf',
              '24',
              '-maxrate',
              '950k',
              '-bufsize',
              '1900k',
              '-pix_fmt',
              'yuv420p',
            ];

            args.push('-an');

            args.push(segOutPath);

            await execFileAsync('ffmpeg', args);
            segmentPaths.push(segOutPath);
            const renderedDuration = await probeDuration(segOutPath);
            segmentDurations.push(renderedDuration);
            renderedClips.push({ ...clip, sourceStart: 0, sourceEnd: renderedDuration });

            subtitleTimings.push({
              start: cumulativeTime,
              end: cumulativeTime + renderedDuration,
              burmese: wrapBurmeseCueLines(clip.burmeseScript),
            });
            cumulativeTime += renderedDuration;

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
      const publicFolder = projectName || 'output';
      const outputDir = path.join(PUBLIC_DIR, publicFolder);
      fs.mkdirSync(outputDir, { recursive: true });
      const finalMp4Path = path.join(outputDir, finalMp4Name);
      const finalSrtPath = path.join(outputDir, finalSrtName);
      const tempMp4Path = path.join(tempDir, finalMp4Name);
      const tempSrtPath = path.join(tempDir, finalSrtName);

      const srtContent = buildSrtFromClips(renderedClips);
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
            '24',
            '-maxrate',
            '950k',
            '-bufsize',
            '1900k',
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
        videoUrl: `/${encodeURIComponent(publicFolder)}/${finalMp4Name}`,
        srtUrl: `/${encodeURIComponent(publicFolder)}/${finalSrtName}`,
        downloadUrl: projectName ? `/api/projects/${encodeURIComponent(projectName)}/download` : undefined,
        durationSec: totalDuration,
        fileSizeBytes: stats.size,
        width: 1280,
        height: 720,
        subtitleTiming,

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
