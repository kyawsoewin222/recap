import { Upload } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import RecapPlayer, { type SubtitleMode } from './components/RecapPlayer';
import ScriptPanel from './components/ScriptPanel';
import {
  INITIAL_RECAP_CLIPS,
  SOURCE_VIDEO_URL,
  type ClipAudioState,
  type RecapClip,
  type RenderResult,
} from './data/recapClips';

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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

  useEffect(() => {
    fetch('/api/default-render')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: RenderResult | null) => {
        if (data?.videoUrl) {
          setRenderResult(data);
          setPlayerMode('rendered');
        }
      })
      .catch(() => {});
  }, []);

  const handleUpdateClip = (
    clipId: number,
    patch: Partial<Pick<RecapClip, 'burmeseScript' | 'englishScript'>>
  ) => {
    setClips((prev) =>
      prev.map((c) => (c.id === clipId ? { ...c, ...patch } : c))
    );
  };

  const generateVoiceForClip = async (clip: RecapClip): Promise<void> => {
    setAudioMap((prev) => ({
      ...prev,
      [clip.id]: { ...prev[clip.id], status: 'generating', error: undefined },
    }));

    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clipId: clip.id,
          text: clip.burmeseScript,
          voiceName: selectedVoice,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Voiceover generation failed.');
      }

      setAudioMap((prev) => ({
        ...prev,
        [clip.id]: {
          status: 'ready',
          audioUrl: data.audioUrl,
          durationSec: data.durationSec,
        },
      }));
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Voiceover generation failed.';
      setAudioMap((prev) => ({
        ...prev,
        [clip.id]: {
          ...prev[clip.id],
          status: 'error',
          error: message,
        },
      }));
    }
  };

  const handleGenerateAllAudio = async () => {
    setIsGeneratingAll(true);
    try {
      for (let i = 0; i < clips.length; i++) {
        setGenerationProgressText(`Generating ${i + 1}/${clips.length}`);
        await generateVoiceForClip(clips[i]);
      }
    } finally {
      setIsGeneratingAll(false);
      setGenerationProgressText(null);
    }
  };

  const handleTranslateClip = async (clip: RecapClip) => {
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
      handleUpdateClip(clip.id, { burmeseScript: data.burmeseScript });
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
    targetAudioMap: Record<number, ClipAudioState>
  ) => {
    setIsRendering(true);
    setRenderError(null);

    try {
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

      setRenderResult(data);
      setPlayerMode('rendered');
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

  const handleRenderVideo = async () => {
    await renderVideoWithParams(clips, sourceVideoUrl, audioMap);
  };

  const handleEpisodeFileSelected = async (
    e: ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setIsProcessingEpisode(true);
    setRenderError(null);
    setUploadStatusText(`Uploading ${file.name} (0%)...`);

    try {
      const uploaded = await new Promise<{
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
      });

      const cleanTitle = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
      setEpisodeTitle(`${cleanTitle} — Burmese 16:9 Short Recap`);
      setSourceVideoUrl(uploaded.sourceVideoUrl);
      setActiveClipIndex(0);
      setAudioMap({});
      setRenderResult(null);
      setPlayerMode('storyboard');

      setUploadStatusText(
        `Analyzing ${Math.round(uploaded.durationSec)}s episode & splitting Burmese script...`
      );

      const analyzeRes = await fetch('/api/analyze-episode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceVideoUrl: uploaded.sourceVideoUrl }),
      });
      const analyzeData = await analyzeRes.json();
      if (!analyzeRes.ok) {
        throw new Error(
          analyzeData.error || 'Failed to generate split Burmese script.'
        );
      }

      const generatedClips: RecapClip[] = analyzeData.clips;
      setClips(generatedClips);
      setUploadStatusText(
        `Rendering clean video-only 16:9 MP4 (${generatedClips.length} segments)...`
      );

      await renderVideoWithParams(generatedClips, uploaded.sourceVideoUrl, {});
      setUploadStatusText(null);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to process new episode.';
      setRenderError(message);
      setUploadStatusText(null);
    } finally {
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
              onChange={handleEpisodeFileSelected}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessingEpisode || isRendering}
              className="h-10 px-3.5 inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-[#161D2D] hover:bg-slate-800 disabled:opacity-60 text-xs font-semibold text-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{isProcessingEpisode ? 'Processing...' : 'Upload Episode'}</span>
            </button>
            <button
              type="button"
              onClick={handleRenderVideo}
              disabled={isRendering || isProcessingEpisode}
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
              {clips.length} fast-paced 3–5 second segments · Widescreen 16:9
              (1280×720) · Clean video-only MP4 + synced Burmese script
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
            onTriggerRender={handleRenderVideo}
          />

          <ScriptPanel
            clips={clips}
            activeClipIndex={activeClipIndex}
            audioMap={audioMap}
            selectedVoice={selectedVoice}
            onVoiceChange={setSelectedVoice}
            onSelectClip={setActiveClipIndex}
            onUpdateClip={handleUpdateClip}
            onGenerateClipAudio={generateVoiceForClip}
            onGenerateAllAudio={handleGenerateAllAudio}
            isGeneratingAll={isGeneratingAll}
            generationProgressText={generationProgressText}
            onTranslateClip={handleTranslateClip}
            translatingClipId={translatingClipId}
          />
        </div>
      </main>
    </div>
  );
}
