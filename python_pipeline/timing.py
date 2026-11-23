"""Estimate subtitle timings within each selected video clip."""
import math
import re

def approximate_subtitles(text: str, audio_duration: float) -> list[tuple[float, float, str]]:
    # shortcut: phrase durations are approximate; replace with speech alignment when available.
    # Split only at existing phrase/word boundaries, never inside Myanmar combining sequences.
    units = re.findall(r"[^\s၊။!?]+[၊။!?]*|[၊။!?]+", text.strip())
    if not units or not math.isfinite(audio_duration) or audio_duration <= 0:
        raise ValueError("Subtitles need narration text and a positive clip duration.")
    phrases: list[str] = []
    current = ""
    for unit in units:
        candidate = f"{current} {unit}".strip()
        if current and len(candidate) > 64:
            phrases.append(current)
            current = unit
        else:
            current = candidate
        if current.endswith(("၊", "။", "!", "?")):
            phrases.append(current)
            current = ""
    if current:
        phrases.append(current)
    # Avoid flashing tiny fragments by combining them with a neighbor.
    while len(phrases) > 1:
        shortest = min(range(len(phrases)), key=lambda i: len(phrases[i]))
        if audio_duration * len(phrases[shortest]) / sum(map(len, phrases)) >= 1.0:
            break
        neighbor = shortest - 1 if shortest else 1
        first, second = sorted((shortest, neighbor))
        phrases[first:second + 1] = [" ".join(phrases[first:second + 1])]
    if any(len(phrase) > 128 for phrase in phrases):
        raise ValueError("Needs subtitle review: add natural Burmese phrase boundaries (spaces or punctuation) to the long narration before export.")
    weights = [len(phrase) for phrase in phrases]
    total = sum(weights)
    cursor = 0.0
    cues = []
    for phrase, weight in zip(phrases, weights):
        end = min(audio_duration, cursor + audio_duration * weight / total)
        cues.append((cursor, end, phrase))
        cursor = end
    return cues
