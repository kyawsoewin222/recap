import { Upload } from 'lucide-react';
import { useRef, useState, type ChangeEvent } from 'react';
import RecapPlayer, { type SubtitleMode } from './components/RecapPlayer';
import ScriptPanel from './components/ScriptPanel';
import { getClipPaceCheck, getTightClipDuration } from './data/timing';
import {
  INITIAL_RECAP_CLIPS,
  SOURCE_VIDEO_URL,
  type RecapClip,
  type RenderResult,
} from './data/recapClips';

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const assetRevision = useRef(0);
  const [scriptSource, setScriptSource] = useState<'gemini' | 'srt'>('gemini');
  const [activeScriptSource, setActiveScriptSource] = useState<'gemini' | 'srt'>('gemini');
  const [srtFile, setSrtFile] = useState<File | null>(null);
  const [sourceVideoUrl, setSourceVideoUrl] = useState(SOURCE_VIDEO_URL);
  const [sourceDurationSec, setSourceDurationSec] = useState<number | null>(null);
  const [episodeTitle, setEpisodeTitle] = useState(
    'RecapCut Studio — 16:9 Burmese Storytelling Recap'
  );
  const [clips, setClips] = useState<RecapClip[]>(INITIAL_RECAP_CLIPS);
  const [activeClipIndex, setActiveClipIndex] = useState(0);
  const [subtitleMode, setSubtitleMode] = useState<SubtitleMode>('burmese');
  const [burnSubtitles, setBurnSubtitles] = useState(false);
  const [maskBottomSubtitles, setMaskBottomSubtitles] = useState(false);
  const [sourceAudioVolume, setSourceAudioVolume] = useState(1);
  const [uploadStatusText, setUploadStatusText] = useState<string | null>(null);
  const [isProcessingEpisode, setIsProcessingEpisode] = useState(false);

  const [isShorteningAll, setIsShorteningAll] = useState(false);
  const [progressNote, setProgressNote] = useState<string | null>(null);
  const [busyClipId, setBusyClipId] = useState<number | null>(null);
  const [clipErrorMap, setClipErrorMap] = useState<Record<number, string>>({});

  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderResult, setRenderResult] = useState<RenderResult | null>(null);
  const [playerMode, setPlayerMode] = useState<'storyboard' | 'rendered'>(
    'storyboard'
  );
  const busy = isProcessingEpisode || isRendering || isShorteningAll || busyClipId !== null;

  const handleUpdateClip = (
    clipId: number,
    patch: Partial<Pick<RecapClip, 'burmeseScript' | 'englishScript' | 'sourceStart' | 'sourceEnd'>>
  ) => {
    const updated = clips.map((clip) => {
      if (clip.id !== clipId) return clip;
      const next = { ...clip, ...patch };
      return {
        ...next,
        targetDuration: Number(Math.max(0, next.sourceEnd - next.sourceStart).toFixed(2)),
      };
    });

    const invalidIdx = updated.findIndex((clip, index) =>
      !Number.isFinite(clip.sourceStart) ||
      !Number.isFinite(clip.sourceEnd) ||
      clip.sourceStart < 0 ||
      clip.sourceEnd <= clip.sourceStart + 0.4 ||
      (sourceDurationSec !== null && clip.sourceEnd > sourceDurationSec) ||
      (index > 0 && clip.sourceStart < updated[index - 1].sourceEnd)
    );
    if (invalidIdx >= 0) {
      setRenderError(
        `Clip ${invalidIdx + 1}: keep chronological, non-overlapping timestamps${sourceDurationSec ? ` within 0–${sourceDurationSec.toFixed(1)}s` : ''}.`
      );
      return;
    }

    setClips(updated);
    assetRevision.current++;
    setClipErrorMap((prev) => {
      if (!(clipId in prev)) return prev;
      const copy = { ...prev };
      delete copy[clipId];
      return copy;
    });
    setRenderResult(null);
    setPlayerMode('storyboard');
    setRenderError(null);
  };

  const handleShortenClip = async (clip: RecapClip) => {
    const revision = assetRevision.current;
    setBusyClipId(clip.id);
    setClipErrorMap((prev) => {
      const copy = { ...prev };
      delete copy[clip.id];
      return copy;
    });
    try {
      const response = await fetch('/api/shorten-clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          burmeseScript: clip.burmeseScript,
          englishScript: clip.englishScript,
          sourceStart: clip.sourceStart,
          sourceEnd: clip.sourceEnd,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to shorten narration.');
      }
      if (revision === assetRevision.current) {
        handleUpdateClip(clip.id, { burmeseScript: data.burmeseScript });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to shorten narration.';
      setClipErrorMap((prev) => ({ ...prev, [clip.id]: message }));
    } finally {
      setBusyClipId(null);
    }
  };

  const handleShortenAllLongClips = async () => {
    const longClips = clips.filter((clip) => getClipPaceCheck(clip).status === 'long');
    if (longClips.length === 0 || busy) return;
    setIsShorteningAll(true);
    setRenderError(null);
    try {
      let currentClips = [...clips];
      for (let i = 0; i < longClips.length; i++) {
        const target = longClips[i];
        setProgressNote(`Shortening clip ${i + 1}/${longClips.length} without losing meaning…`);
        const response = await fetch('/api/shorten-clip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            burmeseScript: target.burmeseScript,
            englishScript: target.englishScript,
            sourceStart: target.sourceStart,
            sourceEnd: target.sourceEnd,
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(`Clip ${target.id}: ${data.error || 'Failed to shorten.'}`);
        }
        currentClips = currentClips.map((c) =>
          c.id === target.id ? { ...c, burmeseScript: data.burmeseScript } : c
        );
        setClips(currentClips);
        assetRevision.current++;
      }
      setRenderResult(null);
      setPlayerMode('storyboard');
    setProgressNote('Long cues shortened. Preview or export 16:9 MP4 + SRT.');
    } catch (err: unknown) {
      setRenderError(err instanceof Error ? err.message : 'Failed to shorten long cues.');
    } finally {
      setIsShorteningAll(false);
    }
  };

  const handleTightenAllGaps = () => {
    if (busy) return;
    let adjustedCount = 0;
    const updated = clips.map((clip) => {
      const pace = getClipPaceCheck(clip);
      if (!pace.hasExcessGap) return clip;
      const tightDur = getTightClipDuration(clip.burmeseScript);
      const nextEnd = Number((clip.sourceStart + tightDur).toFixed(2));
      if (nextEnd >= clip.sourceEnd) return clip;
      adjustedCount++;
      return {
        ...clip,
        sourceEnd: nextEnd,
        targetDuration: Number(Math.max(0, nextEnd - clip.sourceStart).toFixed(2)),
      };
    });
    if (adjustedCount === 0) return;
    setClips(updated);
    assetRevision.current++;
    setRenderResult(null);
    setPlayerMode('storyboard');
    setRenderError(null);
    setProgressNote(`Tightened ${adjustedCount} cue(s) to leave ~0.5–0.8s breathing pause between narrations.`);
  };

  const handleTranslateClip = async (clip: RecapClip) => {
    const revision = assetRevision.current;
    setBusyClipId(clip.id);
    try {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          englishScript: clip.englishScript,
          videoDuration: clip.sourceEnd - clip.sourceStart,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Translation failed.');
      }
      if (revision === assetRevision.current) {
        handleUpdateClip(clip.id, { burmeseScript: data.burmeseScript });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Translation failed.';
      setClipErrorMap((prev) => ({ ...prev, [clip.id]: message }));
    } finally {
      setBusyClipId(null);
    }
  };

  const handleRenderVideo = async (sample = false) => {
    if (busy) return;
    const targetClips = sample ? clips.slice(0, 1) : clips;
    setIsRendering(true);
    setRenderError(null);
    setUploadStatusText(
      sample
        ? 'Rendering first-segment 1.0x MP4 + SRT sample…'
        : `Rendering ${targetClips.length} scenes at 1.0x speed + synced .SRT…`
    );

    try {
      const payloadClips = targetClips.map((c) => ({
        id: c.id,
        sourceStart: c.sourceStart,
        sourceEnd: c.sourceEnd,
        targetDuration: Number((c.sourceEnd - c.sourceStart).toFixed(2)),
        burmeseScript: c.burmeseScript,
        englishScript: c.englishScript,
      }));

      const response = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clips: payloadClips,
          scriptSource: activeScriptSource,
          sample,
          sourceVideoUrl,
          includeSubtitles: burnSubtitles,
          maskBottomSubtitles,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to render 16:9 recap video.');
      }

      setRenderResult(data);
      setPlayerMode('rendered');
    } catch (err: unknown) {
      setRenderError(
        err instanceof Error ? err.message : 'Failed to render 16:9 recap video.'
      );
    } finally {
      setUploadStatusText(null);
      setIsRendering(false);
    }
  };

  const processEpisode = async (file?: File) => {
    if (busy || (scriptSource === 'gemini' && !file) || (scriptSource === 'srt' && !srtFile)) return;

    setIsProcessingEpisode(true);
    setRenderError(null);
    setProgressNote(null);
    setUploadStatusText(file ? `Uploading ${file.name} (0%)...` : 'Reading SRT…');

    try {
      if (srtFile && scriptSource === 'srt' && srtFile.size > 1024 * 1024) {
        throw new Error('Choose an SRT file of 1 MB or less.');
      }
      const uploaded = file ? await new Promise<{
        sourceVideoUrl: string;
        fileName: string;
        durationSec: number;
      }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/upload-episode');
        xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
        xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name));

        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable && ev.total > 0) {
            const pct = Math.round((ev.loaded / ev.total) * 100);
            setUploadStatusText(`Uploading ${file.name} (${pct}%)...`);
          }
        };

        xhr.onload = () => {
          try {
            const json = JSON.parse(xhr.responseText || '{}');
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(json);
            } else {
              reject(new Error(json.error || 'Video upload failed.'));
            }
          } catch {
            reject(new Error('Invalid server response during upload.'));
          }
        };

        xhr.onerror = () => reject(new Error('Network error during upload.'));
        xhr.send(file);
      }) : null;
      const targetSourceUrl = uploaded?.sourceVideoUrl ?? sourceVideoUrl;
      if (uploaded?.durationSec) {
        setSourceDurationSec(uploaded.durationSec);
      }
      const useSrt = scriptSource === 'srt';

      setUploadStatusText(
        useSrt ? 'Reading SRT cues…' : 'Generating Burmese storytelling script & scene cuts with Gemini…'
      );

      const analyzeRes = await fetch(useSrt ? '/api/import-srt' : '/api/analyze-episode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceVideoUrl: targetSourceUrl,
          ...(useSrt && srtFile
            ? { srt: new TextDecoder('utf-8', { fatal: true }).decode(await srtFile.arrayBuffer()) }
            : {}),
        }),
      });
      const analyzeData = await analyzeRes.json();
      if (!analyzeRes.ok) {
        throw new Error(analyzeData.error || (useSrt ? 'Could not import SRT.' : 'Failed to generate Burmese recap script.'));
      }

      const generatedClips: RecapClip[] = analyzeData.clips;
      assetRevision.current++;
      if (file) {
        const cleanTitle = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
        setEpisodeTitle(`${cleanTitle} — 16:9 Burmese Recap`);
      }
      setSourceVideoUrl(targetSourceUrl);
      setActiveScriptSource(scriptSource);
      setActiveClipIndex(0);
      setClipErrorMap({});
      setRenderResult(null);
      setPlayerMode('storyboard');
      setClips(generatedClips);

      const longCount = generatedClips.filter((c) => getClipPaceCheck(c).status === 'long').length;
      setProgressNote(
        longCount > 0
          ? `${longCount} cue(s) may need more time for narration. Review the story and scene ranges before export.`
          : 'Review the story and scene ranges before exporting the silent MP4 and Burmese SRT.'
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to process new episode.';
      setRenderError(message);
    } finally {
      setUploadStatusText(null);
      setIsProcessingEpisode(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0D14] text-slate-100 flex flex-col">
      {/* Top Bar */}
      <header className="border-b border-slate-800/90 bg-[#0A0D14]/95 sticky top-0 z-30 backdrop-blur-sm">
        <div className="max-w-[1440px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="#studio-top"
            className="text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            RecapCut Studio
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
            <a
              href="#studio-top"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              16:9 Preview
            </a>
            <a
              href="#script-section"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Burmese Script
            </a>
            <a
              href="#export-section"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Export MP4 + SRT
            </a>
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/x-matroska,video/*"
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void processEpisode(file);
              }}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || (scriptSource === 'srt' && !srtFile)}
              className="h-10 px-3.5 inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-[#161D2D] hover:bg-slate-800 disabled:opacity-60 text-xs font-semibold text-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{isProcessingEpisode ? 'Processing...' : 'Upload Episode'}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleRenderVideo()}
              disabled={busy}
              className="h-10 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0"
            >
              {isRendering ? 'Rendering 16:9 MP4...' : 'Export MP4 + SRT'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Studio Workspace */}
      <main
        id="studio-top"
        className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-6 flex flex-col gap-6"
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Script source
            <select
              className="h-10 rounded-lg border border-slate-700 bg-[#111622] px-3 text-sm text-slate-100"
              value={scriptSource}
              disabled={busy}
              onChange={(e) => {
                setScriptSource(e.target.value === 'srt' ? 'srt' : 'gemini');
                setSrtFile(null);
              }}
            >
              <option value="gemini">Generate recap with Gemini</option>
              <option value="srt">Import existing SRT file</option>
            </select>
          </label>
          {scriptSource === 'srt' && (
            <>
              <p className="text-xs text-slate-400">SRT timestamps select ranges in the source video.</p>
              <label className="flex flex-col gap-1 text-xs text-slate-400">
                Narration SRT
                <input
                  type="file"
                  accept=".srt"
                  disabled={busy}
                  onChange={(e) => setSrtFile(e.target.files?.[0] ?? null)}
                  className="text-xs text-slate-200 file:mr-2 file:rounded-md file:border file:border-slate-700 file:bg-[#161D2D] file:px-3 file:py-1.5 file:text-xs file:text-slate-100"
                />
              </label>
              <button
                type="button"
                onClick={() => void processEpisode()}
                disabled={busy || !srtFile}
                className="h-10 rounded-lg bg-slate-800 hover:bg-slate-700 px-3.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                Apply SRT to Current Video
              </button>
            </>
          )}
        </div>

        {progressNote && !isShorteningAll && (
          <p className="text-xs text-slate-300 bg-[#111622] border border-slate-800 rounded-lg px-3.5 py-2.5">
            {progressNote}
          </p>
        )}
        {uploadStatusText && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-950/25 px-4 py-3 text-xs font-medium text-rose-200">
            {uploadStatusText}
          </div>
        )}

        <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white text-balance">
              {episodeTitle}
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              {clips.length} {activeScriptSource === 'srt' ? 'SRT cues' : 'storytelling beats'} · Estimated recap: {clips.reduce((sum, clip) => sum + clip.sourceEnd - clip.sourceStart, 0).toFixed(1)}s · Silent MP4 + Burmese SRT
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(390px,1fr)] gap-6 items-start">
          <RecapPlayer
            sourceVideoUrl={sourceVideoUrl}
            clips={clips}
            activeClipIndex={activeClipIndex}
            onSelectClip={setActiveClipIndex}
            subtitleMode={subtitleMode}
            onSubtitleModeChange={setSubtitleMode}
            burnSubtitles={burnSubtitles}
            onBurnSubtitlesChange={setBurnSubtitles}
            maskBottomSubtitles={maskBottomSubtitles}
            onMaskBottomChange={setMaskBottomSubtitles}
            sourceAudioVolume={sourceAudioVolume}
            onSourceAudioVolumeChange={setSourceAudioVolume}
            renderResult={renderResult}
            playerMode={playerMode}
            onPlayerModeChange={setPlayerMode}
            isRendering={isRendering}
            renderError={renderError}
            onTriggerRender={() => void handleRenderVideo(false)}
            onTriggerSample={() => void handleRenderVideo(true)}
            fromSrt={activeScriptSource === 'srt'}
            exportDisabled={busy}
          />

          <ScriptPanel
            clips={clips}
            activeClipIndex={activeClipIndex}
            clipErrorMap={clipErrorMap}
            onSelectClip={setActiveClipIndex}
            onUpdateClip={handleUpdateClip}
            onShortenClip={handleShortenClip}
            onShortenAllLongClips={handleShortenAllLongClips}
            onTightenAllGaps={handleTightenAllGaps}
            isShorteningAll={isShorteningAll}
            progressNote={progressNote}
            onTranslateClip={handleTranslateClip}
            busyClipId={busyClipId}
            fromSrt={activeScriptSource === 'srt'}
            busy={busy}
          />
        </div>
      </main>
    </div>
  );
}
