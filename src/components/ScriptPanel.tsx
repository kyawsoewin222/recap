import {
  Check,
  Copy,
  Languages,
  Loader2,
  Mic,
  Play,
  Volume2,
} from 'lucide-react';
import { useState } from 'react';
import type { ClipAudioState, RecapClip } from '../data/recapClips';

const VOICE_OPTIONS = [
  { id: 'Charon', label: 'Charon (Deep Storyteller)' },
  { id: 'Kore', label: 'Kore (Clear Narrator)' },
  { id: 'Puck', label: 'Puck (Fast & Energetic)' },
  { id: 'Fenrir', label: 'Fenrir (Dramatic Trailer)' },
  { id: 'Zephyr', label: 'Zephyr (Smooth Recap)' },
];

interface ScriptPanelProps {
  clips: RecapClip[];
  activeClipIndex: number;
  audioMap: Record<number, ClipAudioState>;
  selectedVoice: string;
  onVoiceChange: (voice: string) => void;
  onSelectClip: (index: number) => void;
  onUpdateClip: (
    clipId: number,
    patch: Partial<Pick<RecapClip, 'burmeseScript' | 'englishScript'>>
  ) => void;
  onGenerateClipAudio: (clip: RecapClip) => Promise<void>;
  onGenerateAllAudio: () => Promise<void>;
  isGeneratingAll: boolean;
  generationProgressText: string | null;
  onTranslateClip: (clip: RecapClip) => Promise<void>;
  translatingClipId: number | null;
  fromSrt: boolean;
  busy: boolean;
}

function formatSourceRange(start: number, end: number): string {
  const fmt = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };
  return `${fmt(start)}–${fmt(end)}`;
}

export default function ScriptPanel({
  clips,
  activeClipIndex,
  audioMap,
  selectedVoice,
  onVoiceChange,
  onSelectClip,
  onUpdateClip,
  onGenerateClipAudio,
  onGenerateAllAudio,
  isGeneratingAll,
  generationProgressText,
  onTranslateClip,
  translatingClipId,
  fromSrt,
  busy,
}: ScriptPanelProps) {
  const [copiedBurmese, setCopiedBurmese] = useState(false);
  const [previewPlayingId, setPreviewPlayingId] = useState<number | null>(null);

  const readyAudioCount = clips.filter(
    (c) => audioMap[c.id]?.status === 'ready'
  ).length;

  const handleCopyFullBurmese = async () => {
    const fullText = clips
      .map(
        (c, i) =>
          `[${String(i + 1).padStart(2, '0')}] (${formatSourceRange(c.sourceStart, c.sourceEnd)})\n${c.burmeseScript}`
      )
      .join('\n\n');
    await navigator.clipboard.writeText(fullText);
    setCopiedBurmese(true);
    setTimeout(() => setCopiedBurmese(false), 2000);
  };

  const handlePlaySingleAudio = (clipId: number, url: string) => {
    const audio = new Audio(url);
    setPreviewPlayingId(clipId);
    audio.onended = () => setPreviewPlayingId(null);
    audio.onerror = () => setPreviewPlayingId(null);
    audio.play().catch(() => setPreviewPlayingId(null));
  };

  return (
    <aside
      id="script-section"
      aria-label="Burmese Recap Script and Voiceover Editor"
      className="bg-[#111622] border border-slate-800 rounded-xl flex flex-col overflow-hidden"
    >
      {/* Header & Voiceover Controls */}
      <div className="p-4 border-b border-slate-800 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-white">
              {fromSrt ? 'SRT Narration Script' : 'Burmese Recap Script'}
            </h2>
            <p className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
              {clips.length} clips · {readyAudioCount}/{clips.length} Burmese
              voiceovers ready
            </p>
          </div>

          <button
            type="button"
            onClick={handleCopyFullBurmese}
            className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#161D2D] hover:bg-slate-800 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            {copiedBurmese ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Copied Burmese</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Script</span>
              </>
            )}
          </button>
        </div>

        {/* Voice selector + Generate All */}
        <div className="flex flex-wrap items-center gap-2.5">
          {!fromSrt && <select
            aria-label="Select AI Narrator Voice"
            value={selectedVoice}
            onChange={(e) => onVoiceChange(e.target.value)}
            className="h-10 px-3 rounded-lg bg-[#0B0F17] border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-rose-500 flex-1 min-w-[180px]"
          >
            {VOICE_OPTIONS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>}

          <button
            type="button"
            onClick={onGenerateAllAudio}
            disabled={busy}
            className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-slate-100 hover:bg-white text-slate-950 disabled:opacity-60 text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            {isGeneratingAll ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{generationProgressText || 'Generating...'}</span>
              </>
            ) : (
              <>
                <Mic className="w-3.5 h-3.5" />
                <span>Generate All Burmese Voiceovers</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Scrollable 12-clip rows */}
      <div className="divide-y divide-slate-800/80 max-h-[680px] overflow-y-auto">
        {clips.map((clip, idx) => {
          const isActive = idx === activeClipIndex;
          const audioState = audioMap[clip.id] ?? { status: 'idle' };
          const isGeneratingThis = audioState.status === 'generating';
          const isTranslatingThis = translatingClipId === clip.id;

          return (
            <div
              key={clip.id}
              onClick={() => onSelectClip(idx)}
              className={`p-4 transition-colors cursor-pointer flex flex-col gap-2.5 ${
                isActive ? 'bg-[#171F30]' : 'hover:bg-[#141A28]'
              }`}
            >
              {/* Quiet metadata line + per-clip controls */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span
                    className={`font-semibold ${
                      isActive ? 'text-rose-400' : 'text-slate-200'
                    }`}
                  >
                    {clip.title}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {formatSourceRange(clip.sourceStart, clip.sourceEnd)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {audioState.durationSec
                      ? `${audioState.durationSec.toFixed(1)}s VO`
                      : `${clip.targetDuration.toFixed(1)}s`}
                  </span>
                </div>

                <div
                  className="flex items-center gap-1.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => onSelectClip(idx)}
                    title="Jump player to this clip"
                    className="h-8 px-2.5 inline-flex items-center gap-1 rounded-md border border-slate-700/80 bg-[#0B0F17] hover:bg-slate-800 text-[11px] font-medium text-slate-300 whitespace-nowrap"
                  >
                    <Play className="w-3 h-3" />
                    <span>Seek</span>
                  </button>

                  {audioState.audioUrl && (
                    <button
                      type="button"
                      onClick={() =>
                        handlePlaySingleAudio(clip.id, audioState.audioUrl!)
                      }
                      title="Listen to generated Burmese voiceover"
                      className="h-8 px-2.5 inline-flex items-center gap-1 rounded-md border border-emerald-700/60 bg-emerald-950/40 hover:bg-emerald-900/50 text-[11px] font-medium text-emerald-300 whitespace-nowrap"
                    >
                      <Volume2 className="w-3 h-3" />
                      <span>
                        {previewPlayingId === clip.id ? 'Playing' : 'Listen'}
                      </span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onGenerateClipAudio(clip)}
                    disabled={busy}
                    className="h-8 px-2.5 inline-flex items-center gap-1 rounded-md border border-slate-700/80 bg-[#0B0F17] hover:bg-slate-800 disabled:opacity-50 text-[11px] font-medium text-slate-200 whitespace-nowrap"
                  >
                    {isGeneratingThis ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Mic className="w-3 h-3" />
                    )}
                    <span>{audioState.audioUrl ? 'Regen VO' : 'Gen VO'}</span>
                  </button>
                </div>
              </div>

              {/* Editable Burmese narration */}
              <div onClick={(e) => e.stopPropagation()}>
                <textarea
                  lang="my"
                  rows={3}
                  value={clip.burmeseScript}
                  disabled={fromSrt && busy}
                  onChange={(e) =>
                    onUpdateClip(clip.id, { burmeseScript: e.target.value })
                  }
                  aria-label={`Burmese script for ${clip.title}`}
                  className="font-myanmar w-full rounded-lg bg-[#0B0F17] border border-slate-800 focus:border-rose-500 focus:outline-none px-3 py-2 text-[14px] leading-relaxed text-slate-100 resize-y"
                />
              </div>

              {/* English reference + retranslate helper */}
              <div
                onClick={(e) => e.stopPropagation()}
                className="flex flex-col gap-1.5"
              >
                {!fromSrt && <div className="flex items-start justify-between gap-2">
                  <p className="text-xs leading-relaxed text-slate-400">
                    {clip.englishScript}
                  </p>
                  <button
                    type="button"
                    onClick={() => onTranslateClip(clip)}
                    disabled={busy}
                    title="Re-translate English to Burmese via Gemini"
                    className="h-7 px-2 inline-flex items-center gap-1 rounded border border-slate-800 bg-[#0B0F17] hover:bg-slate-800 text-[11px] text-slate-400 hover:text-slate-200 shrink-0 whitespace-nowrap"
                  >
                    {isTranslatingThis ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Languages className="w-3 h-3" />
                    )}
                    <span>Refresh MY</span>
                  </button>
                </div>}
                {audioState.status === 'error' && audioState.error && (
                  <p className="text-xs text-rose-400">{audioState.error}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
