import {
  Check,
  Copy,
  Languages,
  Loader2,
  Play,
  Scissors,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { RecapClip } from '../data/recapClips';
import { getClipPaceCheck } from '../data/timing';

interface ScriptPanelProps {
  clips: RecapClip[];
  activeClipIndex: number;
  clipErrorMap: Record<number, string>;
  onSelectClip: (index: number) => void;
  onUpdateClip: (
    clipId: number,
    patch: Partial<Pick<RecapClip, 'burmeseScript' | 'englishScript' | 'sourceStart' | 'sourceEnd'>>
  ) => void;
  onShortenClip: (clip: RecapClip) => Promise<void>;
  onShortenAllLongClips: () => Promise<void>;
  onTightenAllGaps: () => void;
  isShorteningAll: boolean;
  progressNote: string | null;
  onTranslateClip: (clip: RecapClip) => Promise<void>;
  busyClipId: number | null;
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

function TimestampInput({
  label,
  value,
  disabled,
  ariaLabel,
  onCommit,
}: {
  label: string;
  value: number;
  disabled: boolean;
  ariaLabel: string;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || draft.trim() === '') {
      setDraft(String(value));
      return;
    }
    if (parsed !== value) {
      onCommit(parsed);
    }
  };

  return (
    <label className="flex items-center gap-2">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        step={0.1}
        value={draft}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="w-20 rounded bg-slate-900 border border-slate-800 px-2 py-1 text-slate-100 font-mono tabular-nums"
      />
    </label>
  );
}

export default function ScriptPanel({
  clips,
  activeClipIndex,
  clipErrorMap,
  onSelectClip,
  onUpdateClip,
  onShortenClip,
  onShortenAllLongClips,
  onTightenAllGaps,
  isShorteningAll,
  progressNote,
  onTranslateClip,
  busyClipId,
  fromSrt,
  busy,
}: ScriptPanelProps) {
  const [copiedBurmese, setCopiedBurmese] = useState(false);

  const totalSec = clips.reduce(
    (sum, c) => sum + Math.max(0, c.sourceEnd - c.sourceStart),
    0
  );
  const longClipCount = clips.filter((c) => getClipPaceCheck(c).status === 'long').length;
  const excessGapCount = clips.filter((c) => getClipPaceCheck(c).hasExcessGap).length;

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

  return (
    <aside
      id="script-section"
      aria-label="Burmese Recap Script and Timing Editor"
      className="bg-[#111622] border border-slate-800 rounded-xl flex flex-col overflow-hidden"
    >
      {/* Header & Batch Actions */}
      <div className="p-4 border-b border-slate-800 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-white">
              {fromSrt ? 'SRT Cues' : 'Burmese Storytelling Script'}
            </h2>
            <p className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
              {clips.length} cues · {Math.floor(totalSec / 60)}m {Math.round(totalSec % 60)}s total ·{' '}
              {longClipCount > 0 ? (
                <span className="text-rose-400">{longClipCount} longer than 1.0x cut</span>
              ) : (
                <span className="text-emerald-400">all fit at 1.0x</span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {excessGapCount > 0 && (
              <button
                type="button"
                onClick={onTightenAllGaps}
                disabled={busy}
                className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg border border-sky-700/60 bg-sky-950/40 hover:bg-sky-900/50 text-sky-200 disabled:opacity-60 text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
              >
                <Scissors className="w-3.5 h-3.5" />
                <span>Tighten {excessGapCount} Gaps</span>
              </button>
            )}

            {longClipCount > 0 && (
              <button
                type="button"
                onClick={() => void onShortenAllLongClips()}
                disabled={busy}
                className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 disabled:opacity-60 text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
              >
                {isShorteningAll ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>{progressNote || 'Shortening...'}</span>
                  </>
                ) : (
                  <>
                    <Scissors className="w-3.5 h-3.5" />
                    <span>Shorten {longClipCount} Long Cues</span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={handleCopyFullBurmese}
              className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#161D2D] hover:bg-slate-800 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0"
            >
              {copiedBurmese ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Script</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable cues list */}
      <div className="divide-y divide-slate-800/80 max-h-[680px] overflow-y-auto">
        {clips.map((clip, idx) => {
          const isActive = idx === activeClipIndex;
          const isBusyThis = busyClipId === clip.id;
          const pace = getClipPaceCheck(clip);
          const errorMsg = clipErrorMap[clip.id];

          return (
            <div
              key={clip.id}
              onClick={() => onSelectClip(idx)}
              className={`p-4 transition-colors cursor-pointer flex flex-col gap-2.5 ${
                isActive ? 'bg-[#171F30]' : 'hover:bg-[#141A28]'
              }`}
            >
              {/* Metadata line + per-clip controls */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span
                    className={`font-semibold ${
                      isActive ? 'text-rose-400' : 'text-slate-200'
                    }`}
                  >
                    {clip.title}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {formatSourceRange(clip.sourceStart, clip.sourceEnd)} ({pace.videoDuration.toFixed(1)}s)
                  </span>
                  <span
                    className={`font-mono tabular-nums px-1.5 py-0.5 rounded text-[11px] ${
                      pace.status === 'long'
                        ? 'bg-rose-950/70 text-rose-300 border border-rose-800/60'
                        : pace.hasExcessGap
                          ? 'bg-sky-950/70 text-sky-300 border border-sky-800/60'
                          : pace.status === 'tight'
                            ? 'bg-amber-950/60 text-amber-300 border border-amber-800/50'
                            : 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/50'
                    }`}
                  >
                    {pace.status === 'long'
                      ? `~${pace.estimatedSpeechSec.toFixed(1)}s speech (+${pace.overflowSec.toFixed(1)}s long)`
                      : pace.hasExcessGap
                        ? `~${pace.estimatedSpeechSec.toFixed(1)}s speech (${pace.gapSec.toFixed(1)}s gap)`
                        : `~${pace.estimatedSpeechSec.toFixed(1)}s speech`}
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

                  <button
                    type="button"
                    onClick={() => void onShortenClip(clip)}
                    disabled={busy}
                    title="Condense repetition while preserving story meaning to fit 1.0x clip duration"
                    className="h-8 px-2.5 inline-flex items-center gap-1 rounded-md border border-amber-700/60 bg-amber-950/30 hover:bg-amber-900/40 disabled:opacity-50 text-[11px] font-medium text-amber-200 whitespace-nowrap"
                  >
                    {isBusyThis ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Scissors className="w-3 h-3" />
                    )}
                    <span>Shorten to Fit</span>
                  </button>
                </div>
              </div>

              <div
                className="flex flex-wrap gap-3 text-xs text-slate-400"
                onClick={(event) => event.stopPropagation()}
              >
                <TimestampInput
                  label="Start (s)"
                  value={clip.sourceStart}
                  disabled={busy}
                  ariaLabel={`sourceStart for ${clip.title}`}
                  onCommit={(val) => onUpdateClip(clip.id, { sourceStart: val })}
                />
                <TimestampInput
                  label="End (s)"
                  value={clip.sourceEnd}
                  disabled={busy}
                  ariaLabel={`sourceEnd for ${clip.title}`}
                  onCommit={(val) => onUpdateClip(clip.id, { sourceEnd: val })}
                />
                <span className="self-center font-mono tabular-nums text-[11px] text-slate-500">
                  {pace.graphemes} chars
                </span>
              </div>

              {/* Editable Burmese storytelling cue */}
              <div onClick={(e) => e.stopPropagation()}>
                <textarea
                  lang="my"
                  rows={2}
                  value={clip.burmeseScript}
                  disabled={busy}
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
                {!fromSrt && clip.englishScript && (
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs leading-relaxed text-slate-400">
                      {clip.englishScript}
                    </p>
                    <button
                      type="button"
                      onClick={() => void onTranslateClip(clip)}
                      disabled={busy}
                      title="Rewrite Burmese storytelling from English summary within clip duration"
                      className="h-7 px-2 inline-flex items-center gap-1 rounded border border-slate-800 bg-[#0B0F17] hover:bg-slate-800 text-[11px] text-slate-400 hover:text-slate-200 shrink-0 whitespace-nowrap"
                    >
                      {isBusyThis ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Languages className="w-3 h-3" />
                      )}
                      <span>Refresh MY</span>
                    </button>
                  </div>
                )}
                {errorMsg && <p className="text-xs text-rose-400">{errorMsg}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
