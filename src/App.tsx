import { Upload } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import RecapPlayer, { type SubtitleMode } from './components/RecapPlayer';
import ScriptPanel from './components/ScriptPanel';
import { getSegmentTiming } from './data/timing';
import {
  INITIAL_RECAP_CLIPS,
  SOURCE_VIDEO_URL,
  type ClipAudioState,
  type RecapClip,
  type RenderResult,
} from './data/recapClips';

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const episodeChanged = useRef(false);
  const assetRevision = useRef(0);
  const [scriptSource, setScriptSource] = useState<'gemini' | 'srt'>('gemini');
  const [activeScriptSource, setActiveScriptSource] = useState<'gemini' | 'srt'>('gemini');
  const [srtFile, setSrtFile] = useState<File | null>(null);
  const [srtVoice, setSrtVoice] = useState('my-MM-ThihaNeural');
  const [sourceVideoUrl, setSourceVideoUrl] = useState(SOURCE_VIDEO_URL);
  const [episodeTitle, setEpisodeTitle] = useState(
    'Ancient Empire Bridge Hostage & Night Rescue (Part 9) — Burmese 16:9 Short Recap'
  );
  const [clips, setClips] = useState<RecapClip[]>(INITIAL_RECAP_CLIPS);
  const [activeClipIndex, setActiveClipIndex] = useState(0);
  const [audioMap, setAudioMap] = useState<Record<number, ClipAudioState>>({});
  const [selectedVoice, setSelectedVoice] = useState('Charon');
  const [subtitleMode, setSubtitleMode] = useState<SubtitleMode>('off');
  const [maskBottomSubtitles, setMaskBottomSubtitles] = useState(false);
  const [sourceAudioVolume, setSourceAudioVolume] = useState(0.85);
  const [uploadStatusText, setUploadStatusText] = useState<string | null>(null);
  const [isProcessingEpisode, setIsProcessingEpisode] = useState(false);

  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [generationProgressText, setGenerationProgressText] = useState<
    string | null
  >(null);
  const [translatingClipId, setTranslatingClipId] = useState<number | null>(
    null
  );

  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderResult, setRenderResult] = useState<RenderResult | null>(null);
  const [playerMode, setPlayerMode] = useState<'storyboard' | 'rendered'>(
    'storyboard'
  );
  const busy = isProcessingEpisode || isRendering || isGeneratingAll ||
    translatingClipId !== null || Object.values(audioMap).some((audio) => audio.status === 'generating');

  useEffect(() => {
    fetch('/api/default-render')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: RenderResult | null) => {
        if (data?.videoUrl && !episodeChanged.current) {
          setRenderResult(data);
          setPlayerMode('rendered');
        }
      })
      .catch(() => {});
  }, []);

  const handleUpdateClip = (
    clipId: number,
    patch: Partial<Pick<RecapClip, 'burmeseScript' | 'englishScript' | 'sourceStart' | 'sourceEnd'>>
  ) => {
    const updated = clips.map((clip) => clip.id === clipId ? { ...clip, ...patch } : clip);
    if (updated.some((clip, index) => !Number.isFinite(clip.sourceStart) || !Number.isFinite(clip.sourceEnd) ||
      clip.sourceStart < 0 || clip.sourceEnd <= clip.sourceStart || (index > 0 && clip.sourceStart < updated[index - 1].sourceEnd))) {
      setRenderError('Choose ordered, nonoverlapping source ranges with start before end. Stay within the relevant scene.');
      return;
    }
    setClips(updated);
    assetRevision.current++;
    episodeChanged.current = true;
    setAudioMap((prev) => Object.fromEntries(Object.entries(prev).map(([id, audio]) => [id,
      (Number(id) === clipId && patch.burmeseScript !== undefined) || audio.status === 'generating'
        ? { status: 'idle' } : audio])));
    setRenderResult(null);
    setPlayerMode('storyboard');
    setRenderError(null);
  };

  const generateVoiceForClip = async (
    clip: RecapClip,
    source = activeScriptSource
  ): Promise<ClipAudioState> => {
    const revision = assetRevision.current;
    setAudioMap((prev) => ({
      ...prev,
      [clip.id]: { ...prev[clip.id], status: 'generating', error: undefined },
    }));

    try {
      const response = await fetch(source === 'srt' ? '/api/srt-tts' : '/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clipId: clip.id,
          text: clip.burmeseScript,
          voiceName: source === 'srt' ? srtVoice : selectedVoice,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Voiceover generation failed.');
      }

      if (revision !== assetRevision.current) throw new Error('Narration changed during generation. Generate it again.');
      if (!Number.isFinite(data.durationSec) || data.durationSec <= 0) throw new Error('Narration duration could not be measured. Generate it again.');
      const audio: ClipAudioState = {
        status: 'ready',
        audioUrl: data.audioUrl,
        durationSec: data.durationSec,
        subtitleCues: data.subtitleCues,
        subtitleTiming: data.subtitleTiming,
      };
      setAudioMap((prev) => ({ ...prev, [clip.id]: audio }));
      return audio;
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Voiceover generation failed.';
      const audio: ClipAudioState = { status: 'error', error: message };
      if (revision === assetRevision.current) setAudioMap((prev) => ({ ...prev, [clip.id]: audio }));
      return audio;
    }
  };

  const handleGenerateAllAudio = async () => {
    const revision = assetRevision.current;
    setIsGeneratingAll(true);
    try {
      for (let i = 0; i < clips.length; i++) {
        if (revision !== assetRevision.current) break;
        setGenerationProgressText(`Generating ${i + 1}/${clips.length}`);
        await generateVoiceForClip(clips[i]);
      }
    } finally {
      setIsGeneratingAll(false);
      setGenerationProgressText(null);
    }
  };

  const handleTranslateClip = async (clip: RecapClip) => {
    const revision = assetRevision.current;
    setTranslatingClipId(clip.id);
    try {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ englishScript: clip.englishScript }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Translation failed.');
      }
      if (revision === assetRevision.current) handleUpdateClip(clip.id, { burmeseScript: data.burmeseScript });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Translation failed.';
      setAudioMap((prev) => ({
        ...prev,
        [clip.id]: {
          ...prev[clip.id],
          status: 'error',
          error: message,
        },
      }));
    } finally {
      setTranslatingClipId(null);
    }
  };

  const renderVideoWithParams = async (
    targetClips: RecapClip[],
    targetSourceUrl: string,
    targetAudioMap: Record<number, ClipAudioState>,
    source = activeScriptSource,
    sample = false
  ) => {
    const revision = assetRevision.current;
    setIsRendering(true);
    setRenderError(null);

    try {
      for (const clip of targetClips) getSegmentTiming(clip, targetAudioMap[clip.id]?.durationSec);
      const payloadClips = targetClips.map((c) => ({
        id: c.id,
        sourceStart: c.sourceStart,
        sourceEnd: c.sourceEnd,
        targetDuration: c.targetDuration,
        burmeseScript: c.burmeseScript,
        englishScript: c.englishScript,
        audioUrl: targetAudioMap[c.id]?.audioUrl,
      }));

      const response = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clips: payloadClips,
          scriptSource: source,
          sample,
          sourceVideoUrl: targetSourceUrl,
          includeSubtitles: subtitleMode !== 'off',
          maskBottomSubtitles,
          sourceAudioVolume,
          voiceoverVolume: 1.0,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to render 16:9 recap video.');
      }

      if (revision === assetRevision.current) {
        setRenderResult(data);
        setPlayerMode('rendered');
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to render 16:9 recap video.';
      setRenderError(message);
    } finally {
      setIsRendering(false);
    }
  };

  const handleRenderVideo = async (sample = false) => {
    if (busy) return;
    setIsProcessingEpisode(true);
    setRenderError(null);
    try {
      await renderSrt(sample ? clips.slice(0, 1) : clips, sourceVideoUrl, audioMap, activeScriptSource, sample);
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : 'Could not render recap.');
    } finally {
      setUploadStatusText(null);
      setIsProcessingEpisode(false);
    }
  };

  const renderSrt = async (
    targetClips: RecapClip[],
    targetSourceUrl: string,
    currentAudio: Record<number, ClipAudioState>,
    source = activeScriptSource,
    sample = false
  ) => {
    const revision = assetRevision.current;
    const narration = { ...currentAudio };
    for (const [index, clip] of targetClips.entries()) {
      if (revision !== assetRevision.current) throw new Error('Narration changed. Review it and export again.');
      if (narration[clip.id]?.status === 'ready') continue;
      setUploadStatusText(`Generating Burmese narration ${index + 1}/${targetClips.length}…`);
      const audio = await generateVoiceForClip(clip, source);
      if (audio.status !== 'ready') throw new Error(`Cue ${index + 1}: ${audio.error}`);
      narration[clip.id] = audio;
    }
    if (revision !== assetRevision.current) throw new Error('Narration changed. Review it and export again.');
    setUploadStatusText(`Rendering ${targetClips.length} narrated scenes…`);
    await renderVideoWithParams(targetClips, targetSourceUrl, narration, source, sample);
  };

  const processEpisode = async (file?: File) => {
    if (busy || (scriptSource === 'gemini' && !file) || (scriptSource === 'srt' && !srtFile)) return;

    setIsProcessingEpisode(true);
    setRenderError(null);
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
      const useSrt = scriptSource === 'srt';

      setUploadStatusText(
        useSrt ? 'Reading SRT…' : 'Generating Burmese script with Gemini…'
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
        throw new Error(analyzeData.error || (useSrt ? 'Could not import SRT.' : 'Failed to generate split Burmese script.'));
      }

      const generatedClips: RecapClip[] = analyzeData.clips;
      episodeChanged.current = true;
      assetRevision.current++;
      if (file) {
        const cleanTitle = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
        setEpisodeTitle(`${cleanTitle} — Burmese 16:9 Short Recap`);
      }
      setSourceVideoUrl(targetSourceUrl);
      setActiveScriptSource(scriptSource);
      setActiveClipIndex(0);
      setAudioMap({});
      setRenderResult(null);
      setPlayerMode('storyboard');
      setClips(generatedClips);
      setGenerationProgressText('Review narration and export a sample before rendering the full project.');
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
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
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
              Export MP4
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
              {isRendering ? 'Rendering 16:9 MP4...' : 'Export 16:9 MP4'}
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
          <label className="flex flex-col gap-1 text-sm">
            Script source
            <select className="rounded border border-slate-700 bg-slate-900 p-2"
              value={scriptSource} disabled={busy}
              onChange={(e) => {
                setScriptSource(e.target.value === 'srt' ? 'srt' : 'gemini');
                setSrtFile(null);
              }}>
              <option value="gemini">Generate with Gemini</option>
              <option value="srt">Use an SRT file</option>
            </select>
          </label>
          {scriptSource === 'srt' && (
            <>
              <label className="flex flex-col gap-1 text-sm">
                Narration SRT
                <input type="file" accept=".srt" disabled={busy}
                  onChange={(e) => setSrtFile(e.target.files?.[0] ?? null)} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Burmese narrator
                <select className="rounded border border-slate-700 bg-slate-900 p-2"
                  value={srtVoice} disabled={busy} onChange={(e) => {
                    setSrtVoice(e.target.value);
                    if (activeScriptSource === 'srt') {
                      assetRevision.current++;
                      setAudioMap({}); setRenderResult(null); setPlayerMode('storyboard');
                    }
                  }}>
                  <option value="my-MM-ThihaNeural">Thiha (male)</option>
                  <option value="my-MM-NilarNeural">Nilar (female)</option>
                </select>
              </label>
              <button type="button" onClick={() => void processEpisode()} disabled={busy || !srtFile}
                className="rounded bg-slate-800 px-3 py-2 text-sm disabled:opacity-50">
                Use Current Video
              </button>
              <p className="w-full text-xs text-slate-400">
                Use the current video or upload a matching episode. Cue windows select footage. Final segment timing follows measured narration; unsuitable fits require review.
              </p>
            </>
          )}
        </div>
        {generationProgressText && !isGeneratingAll && <p className="text-sm text-slate-300">{generationProgressText}</p>}
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
              {clips.length} {activeScriptSource === 'srt' ? 'SRT cues' : 'recap segments'} · 16:9 (1280×720)
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(390px,1fr)] gap-6 items-start">
          <RecapPlayer
            sourceVideoUrl={sourceVideoUrl}
            clips={clips}
            audioMap={audioMap}
            activeClipIndex={activeClipIndex}
            onSelectClip={setActiveClipIndex}
            subtitleMode={subtitleMode}
            onSubtitleModeChange={setSubtitleMode}
            maskBottomSubtitles={maskBottomSubtitles}
            onMaskBottomChange={setMaskBottomSubtitles}
            sourceAudioVolume={sourceAudioVolume}
            onSourceAudioVolumeChange={setSourceAudioVolume}
            renderResult={renderResult}
            playerMode={playerMode}
            onPlayerModeChange={setPlayerMode}
            isRendering={isRendering}
            renderError={renderError}
            onTriggerRender={() => void handleRenderVideo()}
            onTriggerSample={() => void handleRenderVideo(true)}
            fromSrt={activeScriptSource === 'srt'}
            exportDisabled={busy}
          />

          <ScriptPanel
            clips={clips}
            activeClipIndex={activeClipIndex}
            audioMap={audioMap}
            selectedVoice={selectedVoice}
            onVoiceChange={(voice) => {
              setSelectedVoice(voice);
              assetRevision.current++;
              setAudioMap({}); setRenderResult(null); setPlayerMode('storyboard');
            }}
            onSelectClip={setActiveClipIndex}
            onUpdateClip={handleUpdateClip}
            onGenerateClipAudio={async (clip) => { await generateVoiceForClip(clip); }}
            onGenerateAllAudio={handleGenerateAllAudio}
            isGeneratingAll={isGeneratingAll}
            generationProgressText={generationProgressText}
            onTranslateClip={handleTranslateClip}
            translatingClipId={translatingClipId}
            fromSrt={activeScriptSource === 'srt'}
            busy={busy}
          />
        </div>
      </main>
    </div>
  );
}
