import {
  Download,
  FileCode,
  FileText,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { RecapClip, RenderResult } from '../data/recapClips';
import { buildSrtFromClips } from '../data/srt';
import { getClipPaceCheck, wrapBurmeseCueLines } from '../data/timing';

export type SubtitleMode = 'burmese' | 'bilingual' | 'off';

interface RecapPlayerProps {
  sourceVideoUrl: string;
  clips: RecapClip[];
  activeClipIndex: number;
  onSelectClip: (index: number) => void;
  subtitleMode: SubtitleMode;
  onSubtitleModeChange: (mode: SubtitleMode) => void;
  burnSubtitles: boolean;
  onBurnSubtitlesChange: (val: boolean) => void;
  maskBottomSubtitles: boolean;
  onMaskBottomChange: (val: boolean) => void;
  sourceAudioVolume: number;
  onSourceAudioVolumeChange: (val: number) => void;
  renderResult: RenderResult | null;
  playerMode: 'storyboard' | 'rendered';
  onPlayerModeChange: (mode: 'storyboard' | 'rendered') => void;
  isRendering: boolean;
  renderError: string | null;
  onTriggerRender: () => void;
  onTriggerSample: () => void;
  fromSrt: boolean;
  exportDisabled: boolean;
}

function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

export default function RecapPlayer({
  sourceVideoUrl,
  clips,
  activeClipIndex,
  onSelectClip,
  subtitleMode,
  onSubtitleModeChange,
  burnSubtitles,
  onBurnSubtitlesChange,
  maskBottomSubtitles,
  onMaskBottomChange,
  sourceAudioVolume,
  onSourceAudioVolumeChange,
  renderResult,
  playerMode,
  onPlayerModeChange,
  isRendering,
  renderError,
  onTriggerRender,
  onTriggerSample,
  fromSrt,
  exportDisabled,
}: RecapPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [clipProgress, setClipProgress] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  const activeClip = clips[activeClipIndex] ?? clips[0];
  const activePace = getClipPaceCheck(activeClip);

  const getClipDuration = (clip: RecapClip) =>
    Math.max(0.1, clip.sourceEnd - clip.sourceStart);

  const totalRecapDuration = clips.reduce(
    (sum, clip) => sum + getClipDuration(clip),
    0
  );
  const elapsedBeforeActive = clips
    .slice(0, activeClipIndex)
    .reduce((sum, clip) => sum + getClipDuration(clip), 0);
  const currentClipDuration = getClipDuration(activeClip);
  const currentElapsed =
    elapsedBeforeActive + clipProgress * currentClipDuration;

  const wrappedCueText = wrapBurmeseCueLines(activeClip.burmeseScript);

  // Seek video cleanly at strict 1.0x speed whenever activeClipIndex changes
  useEffect(() => {
    if (playerMode !== 'storyboard') return;
    const video = videoRef.current;
    if (!video) return;

    const clip = clips[activeClipIndex];
    if (!clip) return;

    video.currentTime = clip.sourceStart;
    video.playbackRate = 1;
    video.volume = isMuted ? 0 : sourceAudioVolume;
    setClipProgress(0);

    if (isPlaying) {
      video.play().catch(() => {});
    }
  }, [
    activeClipIndex,
    playerMode,
    sourceVideoUrl,
    activeClip.sourceStart,
    activeClip.sourceEnd,
  ]);

  // Sync mute & original audio volume live
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.volume = isMuted ? 0 : sourceAudioVolume;
    }
  }, [isMuted, sourceAudioVolume]);

  // Play / Pause synchronization
  useEffect(() => {
    if (playerMode !== 'storyboard') return;
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      if (
        video.currentTime < activeClip.sourceStart ||
        video.currentTime >= activeClip.sourceEnd
      ) {
        video.currentTime = activeClip.sourceStart;
      }
      video.playbackRate = 1;
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [isPlaying, playerMode]);

  const handleTimeUpdate = () => {
    if (playerMode !== 'storyboard') return;
    const video = videoRef.current;
    if (!video) return;

    const span = Math.max(0.1, activeClip.sourceEnd - activeClip.sourceStart);
    const progress = Math.max(
      0,
      Math.min(1, (video.currentTime - activeClip.sourceStart) / span)
    );
    setClipProgress(progress);

    if (isPlaying && video.currentTime >= activeClip.sourceEnd - 0.02) {
      if (activeClipIndex < clips.length - 1) {
        onSelectClip(activeClipIndex + 1);
      } else {
        setIsPlaying(false);
        setClipProgress(1);
      }
    }
  };

  useEffect(() => {
    if (!isPlaying || playerMode !== 'storyboard') return;
    let frame: number;
    const tick = () => {
      handleTimeUpdate();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, playerMode, activeClipIndex]);

  const handleRestart = () => {
    onSelectClip(0);
    setClipProgress(0);
    setIsPlaying(true);
  };

  const handleStep = (delta: number) => {
    const next = Math.max(0, Math.min(clips.length - 1, activeClipIndex + delta));
    onSelectClip(next);
  };

  const handleDownloadDraftSrt = () => {
    const srtText = buildSrtFromClips(clips);
    const blob = new Blob([srtText], { type: 'application/x-subrip;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'recap-story.srt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section aria-label="16:9 Recap Video Studio" className="flex flex-col gap-4">
      {/* Mode bar & quick frame info */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg bg-[#111622] p-1 border border-slate-800">
          <button
            type="button"
            onClick={() => {
              setIsPlaying(false);
              onPlayerModeChange('storyboard');
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              playerMode === 'storyboard'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            16:9 Storyboard Preview
          </button>
          <button
            type="button"
            onClick={() => {
              setIsPlaying(false);
              onPlayerModeChange('rendered');
            }}
            disabled={!renderResult}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              playerMode === 'rendered'
                ? 'bg-rose-600 text-white'
                : renderResult
                  ? 'text-slate-300 hover:text-white'
                  : 'text-slate-600 cursor-not-allowed'
            }`}
          >
            {renderResult ? 'Rendered 16:9 MP4' : 'Rendered MP4 (Not Exported)'}
          </button>
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-400 font-mono tabular-nums">
          <span>1280×720 · 1.0x</span>
          <span aria-hidden="true">·</span>
          <span>
            {formatClock(currentElapsed)} / {formatClock(totalRecapDuration)}
          </span>
        </div>
      </div>

      {/* 16:9 Widescreen Viewport */}
      <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden border border-slate-800">
        {playerMode === 'rendered' && renderResult ? (
          <video
            key={renderResult.videoUrl}
            src={renderResult.videoUrl}
            controls
            autoPlay
            playsInline
            className="w-full h-full object-contain bg-black"
          />
        ) : (
          <>
            <video
              key={sourceVideoUrl}
              ref={videoRef}
              src={sourceVideoUrl}
              playsInline
              preload="auto"
              onTimeUpdate={handleTimeUpdate}
              onClick={() => setIsPlaying((prev) => !prev)}
              className="w-full h-full object-cover cursor-pointer"
            />

            {/* Optional bottom cinema scrim to mask original hardcoded subtitles */}
            {maskBottomSubtitles && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-[19%] bg-gradient-to-t from-black via-black/90 to-transparent"
              />
            )}

            {/* Burmese / Bilingual Subtitle Preview Overlay */}
            {subtitleMode !== 'off' && wrappedCueText && (
              <div className="pointer-events-none absolute inset-x-0 bottom-3 md:bottom-4 px-5 md:px-10 flex flex-col items-center text-center gap-1.5">
                <p
                  lang="my"
                  className="font-myanmar whitespace-pre-line text-sm sm:text-base md:text-[18px] font-semibold leading-relaxed text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.95)] bg-black/65 px-3.5 py-1.5 rounded-md max-w-3xl"
                >
                  {wrappedCueText}
                </p>

                {subtitleMode === 'bilingual' && !fromSrt && activeClip.englishScript && (
                  <p className="text-[11px] sm:text-xs font-medium text-slate-200 bg-black/55 px-2.5 py-0.5 rounded max-w-2xl">
                    {activeClip.englishScript}
                  </p>
                )}
              </div>
            )}

            {/* Top subtle clip metadata inside frame */}
            <div className="pointer-events-none absolute top-3 left-3.5 right-3.5 flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-200/90">
              <span className="bg-black/65 px-2.5 py-1 rounded">
                {activeClip.title}
              </span>
              <span
                className={`px-2.5 py-1 rounded ${
                  activePace.status === 'long'
                    ? 'bg-rose-950/85 text-rose-200'
                    : activePace.status === 'tight'
                      ? 'bg-amber-950/85 text-amber-200'
                      : 'bg-black/65 text-emerald-300'
                }`}
              >
                {activePace.videoDuration.toFixed(1)}s cut · ~{activePace.estimatedSpeechSec.toFixed(1)}s speech
              </span>
            </div>
          </>
        )}
      </div>

      {/* Transport + Timeline Strip (Storyboard Mode) */}
      {playerMode === 'storyboard' && (
        <div className="bg-[#111622] border border-slate-800 rounded-xl p-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleStep(-1)}
                disabled={activeClipIndex === 0}
                aria-label="Previous clip"
                className="h-10 w-10 inline-flex items-center justify-center rounded-lg border border-slate-800 bg-[#161D2D] text-slate-200 hover:bg-slate-800 disabled:opacity-40 transition-colors"
              >
                <SkipBack className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setIsPlaying((prev) => !prev)}
                className="h-10 px-4 inline-flex items-center gap-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
              >
                {isPlaying ? (
                  <>
                    <Pause className="w-4 h-4" />
                    <span>Pause</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    <span>Play Recap</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => handleStep(1)}
                disabled={activeClipIndex === clips.length - 1}
                aria-label="Next clip"
                className="h-10 w-10 inline-flex items-center justify-center rounded-lg border border-slate-800 bg-[#161D2D] text-slate-200 hover:bg-slate-800 disabled:opacity-40 transition-colors"
              >
                <SkipForward className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={handleRestart}
                aria-label="Restart recap from clip 1"
                className="h-10 px-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-[#161D2D] text-slate-300 hover:text-white hover:bg-slate-800 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Restart</span>
              </button>
            </div>

            {/* Volume controls (default 0% muted for local music + Edge-TTS) */}
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsMuted((m) => !m)}
                  aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
                  className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-slate-800 bg-[#161D2D] text-slate-300 hover:text-white"
                >
                  {isMuted || sourceAudioVolume === 0 ? (
                    <VolumeX className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="whitespace-nowrap">Original Audio</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={sourceAudioVolume}
                    onChange={(e) =>
                      onSourceAudioVolumeChange(parseFloat(e.target.value))
                    }
                    className="w-20 accent-rose-500 cursor-pointer"
                  />
                  <span className="font-mono tabular-nums w-9 text-right">
                    {Math.round(sourceAudioVolume * 100)}%
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* Segmented Timeline */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>{fromSrt ? `${clips.length} SRT Cues` : `${clips.length}-Beat 1.0x Storytelling Timeline`}</span>
              <span className="font-mono tabular-nums">
                Cue {String(activeClipIndex + 1).padStart(2, '0')} of {clips.length}
              </span>
            </div>
            <div className="grid grid-cols-12 gap-1">
              {clips.map((clip, idx) => {
                const isActive = idx === activeClipIndex;
                const pace = getClipPaceCheck(clip);
                return (
                  <button
                    key={clip.id}
                    type="button"
                    onClick={() => onSelectClip(idx)}
                    title={`${clip.title} (${pace.videoDuration.toFixed(1)}s cut / ~${pace.estimatedSpeechSec.toFixed(1)}s speech)`}
                    className={`relative h-8 rounded transition-colors flex flex-col justify-between p-1 overflow-hidden border ${
                      isActive
                        ? 'bg-rose-600/25 border-rose-500 text-white'
                        : 'bg-[#161D2D] border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    <span className="text-[10px] font-mono tabular-nums leading-none">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <span
                      className={`h-1 w-full rounded-sm ${
                        pace.status === 'long'
                          ? 'bg-rose-500/80'
                          : pace.status === 'tight'
                            ? 'bg-amber-400/80'
                            : 'bg-emerald-500/80'
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Caption & Export formatting bar */}
          <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 whitespace-nowrap">
                Preview Captions:
              </span>
              <div className="flex items-center gap-1 bg-[#0B0F17] p-0.5 rounded-lg border border-slate-800">
                {(
                  [
                    { key: 'burmese', label: 'Burmese' },
                    { key: 'bilingual', label: 'Burmese + EN' },
                    { key: 'off', label: 'Off' },
                  ] as const
                )
                  .filter((opt) => !fromSrt || opt.key !== 'bilingual')
                  .map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => onSubtitleModeChange(opt.key)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                        (fromSrt && subtitleMode === 'bilingual' ? 'burmese' : subtitleMode) === opt.key
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={burnSubtitles}
                  onChange={(e) => onBurnSubtitlesChange(e.target.checked)}
                  className="h-4 w-4 rounded accent-rose-600"
                />
                <span>Burn subtitles into MP4</span>
              </label>

              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={maskBottomSubtitles}
                  onChange={(e) => onMaskBottomChange(e.target.checked)}
                  className="h-4 w-4 rounded accent-rose-600"
                />
                <span>Mask original bottom subtitles</span>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Export Output & Download Box */}
      <div
        id="export-section"
        className="bg-[#111622] border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-white">
            16:9 Recap MP4 + Synced SRT Export
          </h2>
          {renderError ? (
            <p className="text-xs text-rose-400">{renderError}</p>
          ) : renderResult ? (
            <p className="text-xs text-slate-400 font-mono tabular-nums">
              Ready · {renderResult.width}×{renderResult.height} · 1.0x ·{' '}
              {renderResult.durationSec > 0
                ? `${renderResult.durationSec.toFixed(1)}s · `
                : ''}
              {(renderResult.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB
            </p>
          ) : (
            <p className="text-xs text-slate-400">
              Exports all {clips.length} cuts at 1.0x speed ({sourceAudioVolume === 0 ? 'muted audio' : `${Math.round(sourceAudioVolume * 100)}% audio`},{' '}
              {burnSubtitles ? 'burned subtitles' : 'clean video'}) + matching .SRT cues.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleDownloadDraftSrt}
            title="Download synced SRT directly from current storyboard"
            className="h-10 px-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#161D2D] hover:bg-slate-800 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            <FileText className="w-4 h-4" />
            <span>Draft .SRT</span>
          </button>

          <button
            type="button"
            onClick={() => {
              let cursor = 0;
              const syncPayload = clips.map((c) => {
                const dur = getClipDuration(c);
                const item = {
                  id: c.id,
                  title: c.title,
                  recapStart: Number(cursor.toFixed(3)),
                  recapEnd: Number((cursor + dur).toFixed(3)),
                  duration: Number(dur.toFixed(3)),
                  sourceStart: c.sourceStart,
                  sourceEnd: c.sourceEnd,
                  burmeseScript: c.burmeseScript,
                  englishScript: c.englishScript,
                };
                cursor += dur;
                return item;
              });
              const blob = new Blob([JSON.stringify(syncPayload, null, 2)], {
                type: 'application/json',
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'recap-storyboard.json';
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="h-10 px-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#161D2D] hover:bg-slate-800 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            <FileCode className="w-4 h-4" />
            <span>.JSON</span>
          </button>

          {renderResult && (
            <>
              {renderResult.downloadUrl && (
                <a
                  href={renderResult.downloadUrl}
                  download
                  className="h-10 px-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#161D2D] hover:bg-slate-800 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0"
                >
                  <Download className="w-4 h-4" />
                  <span>Zip Folder</span>
                </a>
              )}
              {renderResult.srtUrl && (
                <a
                  href={renderResult.srtUrl}
                  download
                  className="h-10 px-3 inline-flex items-center gap-1.5 rounded-lg border border-emerald-700/70 bg-emerald-950/50 hover:bg-emerald-900/60 text-xs font-semibold text-emerald-200 transition-colors whitespace-nowrap shrink-0"
                >
                  <FileText className="w-4 h-4" />
                  <span>Download .SRT</span>
                </a>
              )}
              <a
                href={renderResult.videoUrl}
                download
                className="h-10 px-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-4 h-4" />
                <span>Download MP4</span>
              </a>
            </>
          )}
          <button
            type="button"
            onClick={onTriggerSample}
            disabled={exportDisabled}
            className="h-10 px-3 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            Sample (Cue 1)
          </button>
          <button
            type="button"
            onClick={onTriggerRender}
            disabled={exportDisabled}
            className="h-10 px-4 inline-flex items-center gap-2 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0"
          >
            <span>
              {isRendering
                ? 'Rendering 16:9 Video...'
                : renderResult
                  ? 'Re-Render MP4 + SRT'
                  : 'Export MP4 + SRT'}
            </span>
          </button>
        </div>
      </div>

    </section>
  );
}
