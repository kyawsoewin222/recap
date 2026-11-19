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
import type {
  ClipAudioState,
  RecapClip,
  RenderResult,
} from '../data/recapClips';

export type SubtitleMode = 'burmese' | 'bilingual' | 'off';

interface RecapPlayerProps {
  sourceVideoUrl: string;
  clips: RecapClip[];
  audioMap: Record<number, ClipAudioState>;
  activeClipIndex: number;
  onSelectClip: (index: number) => void;
  subtitleMode: SubtitleMode;
  onSubtitleModeChange: (mode: SubtitleMode) => void;
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
  audioMap,
  activeClipIndex,
  onSelectClip,
  subtitleMode,
  onSubtitleModeChange,
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
}: RecapPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [clipProgress, setClipProgress] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  const activeClip = clips[activeClipIndex] ?? clips[0];
  const activeAudio = audioMap[activeClip.id];

  const getClipEffectiveDuration = (clip: RecapClip) => {
    const audioDur = audioMap[clip.id]?.durationSec;
    if (audioDur && audioDur > 0) {
      return Math.max(2.5, Math.min(14, audioDur + 0.25));
    }
    return clip.targetDuration;
  };

  const totalRecapDuration = clips.reduce(
    (sum, c) => sum + getClipEffectiveDuration(c),
    0
  );

  const elapsedBeforeActive = clips
    .slice(0, activeClipIndex)
    .reduce((sum, c) => sum + getClipEffectiveDuration(c), 0);

  const currentClipDuration = getClipEffectiveDuration(activeClip);
  const currentElapsed =
    elapsedBeforeActive + clipProgress * currentClipDuration;

  // Seek video & setup voiceover whenever activeClipIndex changes in storyboard mode
  useEffect(() => {
    if (playerMode !== 'storyboard') return;
    const video = videoRef.current;
    const voiceEl = voiceAudioRef.current;
    if (!video) return;

    const clip = clips[activeClipIndex];
    if (!clip) return;

    const rawDur = Math.max(1, clip.sourceEnd - clip.sourceStart);
    const targetDur = getClipEffectiveDuration(clip);
    const rate = Math.max(0.6, Math.min(1.75, rawDur / targetDur));

    video.currentTime = clip.sourceStart;
    video.playbackRate = rate;
    video.volume = isMuted ? 0 : sourceAudioVolume;
    setClipProgress(0);

    if (voiceEl) {
      voiceEl.pause();
      const url = audioMap[clip.id]?.audioUrl;
      if (url) {
        voiceEl.src = url;
        voiceEl.currentTime = 0;
        voiceEl.volume = isMuted ? 0 : 1;
      } else {
        voiceEl.removeAttribute('src');
      }
    }

    if (isPlaying) {
      video.play().catch(() => {});
      if (voiceEl && audioMap[clip.id]?.audioUrl) {
        voiceEl.play().catch(() => {});
      }
    }
  }, [activeClipIndex, playerMode, sourceVideoUrl]);

  // Sync mute & volume live
  useEffect(() => {
    const video = videoRef.current;
    const voiceEl = voiceAudioRef.current;
    if (video) {
      video.volume = isMuted ? 0 : sourceAudioVolume;
    }
    if (voiceEl) {
      voiceEl.volume = isMuted ? 0 : 1;
    }
  }, [isMuted, sourceAudioVolume]);

  // Play / Pause synchronization
  useEffect(() => {
    if (playerMode !== 'storyboard') return;
    const video = videoRef.current;
    const voiceEl = voiceAudioRef.current;
    if (!video) return;

    if (isPlaying) {
      if (
        video.currentTime < activeClip.sourceStart ||
        video.currentTime >= activeClip.sourceEnd - 0.08
      ) {
        video.currentTime = activeClip.sourceStart;
      }
      const rawDur = Math.max(1, activeClip.sourceEnd - activeClip.sourceStart);
      const targetDur = getClipEffectiveDuration(activeClip);
      video.playbackRate = Math.max(0.6, Math.min(1.75, rawDur / targetDur));
      video.play().catch(() => {});

      if (voiceEl && activeAudio?.audioUrl) {
        if (!voiceEl.src.endsWith(activeAudio.audioUrl)) {
          voiceEl.src = activeAudio.audioUrl;
        }
        voiceEl.play().catch(() => {});
      }
    } else {
      video.pause();
      if (voiceEl) voiceEl.pause();
    }
  }, [isPlaying, playerMode]);

  // Advance clip cleanly on timeupdate
  const handleTimeUpdate = () => {
    if (playerMode !== 'storyboard') return;
    const video = videoRef.current;
    if (!video) return;

    const span = Math.max(0.5, activeClip.sourceEnd - activeClip.sourceStart);
    const progress = Math.max(
      0,
      Math.min(1, (video.currentTime - activeClip.sourceStart) / span)
    );
    setClipProgress(progress);

    if (isPlaying && video.currentTime >= activeClip.sourceEnd - 0.06) {
      if (activeClipIndex < clips.length - 1) {
        onSelectClip(activeClipIndex + 1);
      } else {
        setIsPlaying(false);
        setClipProgress(1);
      }
    }
  };

  const handleRestart = () => {
    onSelectClip(0);
    setClipProgress(0);
    setIsPlaying(true);
  };

  const handleStep = (delta: number) => {
    const next = Math.max(0, Math.min(clips.length - 1, activeClipIndex + delta));
    onSelectClip(next);
  };

  return (
    <section aria-label="16:9 Recap Video Studio" className="flex flex-col gap-4">
      {/* Mode bar & quick frame controls */}
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
          <span>1280×720 · 16:9</span>
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
            <audio ref={voiceAudioRef} preload="auto" />

            {/* Clean bottom cinema scrim to mask original hardcoded subtitles */}
            {maskBottomSubtitles && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-[19%] bg-gradient-to-t from-black via-black/90 to-transparent"
              />
            )}

            {/* Burmese / Bilingual Subtitle Overlay */}
            {subtitleMode !== 'off' && (
              <div className="pointer-events-none absolute inset-x-0 bottom-3 md:bottom-4 px-5 md:px-10 flex flex-col items-center text-center gap-1.5">
                <p
                  lang="my"
                  className="font-myanmar text-sm sm:text-base md:text-[18px] font-semibold leading-relaxed text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.95)] bg-black/60 px-3.5 py-1.5 rounded-md max-w-3xl"
                >
                  {activeClip.burmeseScript}
                </p>
                {subtitleMode === 'bilingual' && (
                  <p className="text-[11px] sm:text-xs font-medium text-slate-200 bg-black/55 px-2.5 py-0.5 rounded max-w-2xl">
                    {activeClip.englishScript}
                  </p>
                )}
              </div>
            )}

            {/* Top subtle clip caption inside frame */}
            <div className="pointer-events-none absolute top-3 left-3.5 right-3.5 flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-200/90">
              <span className="bg-black/65 px-2.5 py-1 rounded">
                {activeClip.title}
              </span>
              <span className="bg-black/65 px-2.5 py-1 rounded">
                {activeAudio?.audioUrl ? 'Burmese Voiceover Ready' : 'Subtitle Preview'}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Transport + 12-clip Timeline Strip (Storyboard Mode) */}
      {playerMode === 'storyboard' && (
        <div className="bg-[#111622] border border-slate-800 rounded-xl p-4 flex flex-col gap-4">
          {/* Transport controls row */}
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

            {/* Volume & Frame options */}
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsMuted((m) => !m)}
                  aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
                  className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-slate-800 bg-[#161D2D] text-slate-300 hover:text-white"
                >
                  {isMuted ? (
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
              <span>{clips.length}-Segment Condensed Timeline</span>
              <span className="font-mono tabular-nums">
                Clip {String(activeClipIndex + 1).padStart(2, '0')} of{' '}
                {clips.length}
              </span>
            </div>
            <div className="grid grid-cols-12 gap-1">
              {clips.map((clip, idx) => {
                const isActive = idx === activeClipIndex;
                const hasVoice = Boolean(audioMap[clip.id]?.audioUrl);
                return (
                  <button
                    key={clip.id}
                    type="button"
                    onClick={() => onSelectClip(idx)}
                    title={clip.title}
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
                        hasVoice ? 'bg-emerald-500/80' : 'bg-slate-700'
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
                Captions:
              </span>
              <div className="flex items-center gap-1 bg-[#0B0F17] p-0.5 rounded-lg border border-slate-800">
                {(
                  [
                    { key: 'burmese', label: 'Burmese' },
                    { key: 'bilingual', label: 'Burmese + EN' },
                    { key: 'off', label: 'Off' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => onSubtitleModeChange(opt.key)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      subtitleMode === opt.key
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={maskBottomSubtitles}
                onChange={(e) => onMaskBottomChange(e.target.checked)}
                className="h-4 w-4 rounded accent-rose-600"
              />
              <span>Mask original bottom subtitles with cinema scrim</span>
            </label>
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
            16:9 Burmese Recap MP4 Export
          </h2>
          {renderError ? (
            <p className="text-xs text-rose-400">{renderError}</p>
          ) : renderResult ? (
            <p className="text-xs text-slate-400 font-mono tabular-nums">
              Ready · {renderResult.width}×{renderResult.height} ·{' '}
              {renderResult.durationSec.toFixed(1)}s ·{' '}
              {(renderResult.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB
            </p>
          ) : (
            <p className="text-xs text-slate-400">
              Combines all {clips.length} split 16:9 segments with original
              audio and burned-in Myanmar subtitles into one MP4.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              let cursor = 0;
              const syncPayload = clips.map((c) => {
                const dur = getClipEffectiveDuration(c);
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
              a.download = 'burmese-recap-part9-24-segments.json';
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="h-10 px-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#161D2D] hover:bg-slate-800 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            <FileCode className="w-4 h-4" />
            <span>Script .JSON</span>
          </button>

          {renderResult && (
            <>
              <a
                href={renderResult.srtUrl}
                download
                className="h-10 px-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#161D2D] hover:bg-slate-800 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0"
              >
                <FileText className="w-4 h-4" />
                <span>.SRT</span>
              </a>
              <a
                href={renderResult.videoUrl}
                download
                className="h-10 px-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-4 h-4" />
                <span>Download 16:9 MP4</span>
              </a>
            </>
          )}
          <button
            type="button"
            onClick={onTriggerRender}
            disabled={isRendering}
            className="h-10 px-4 inline-flex items-center gap-2 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0"
          >
            <span>
              {isRendering
                ? 'Rendering 16:9 Video...'
                : renderResult
                  ? 'Re-Render MP4'
                  : 'Render 16:9 MP4'}
            </span>
          </button>
        </div>
      </div>
    </section>
  );
}
