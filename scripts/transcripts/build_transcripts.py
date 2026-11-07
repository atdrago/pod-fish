"""Build VTT, SRT, and Podcasting 2.0 JSON transcripts from the segments of transcribe.swift.

usage: python3 -I scripts/transcripts/build_transcripts.py <segments.json> <output folder> <base name> [<fixes.json>]

The output folder receives <base name>.vtt, <base name>.srt, and <base name>.json. A plain text
file with one line per segment lands next to the segments file, for a read of the whole show
and for the chapter titles.

The optional fixes file is a JSON array of [pattern, replacement] pairs. Each pattern is a
Python regular expression, and the pairs apply in order to every cue and every text line. It
holds the names and terms that the speech model mishears, so it belongs in the content folder,
not in this repository.
"""

import json
import re
import sys
from pathlib import Path

MAX_CUE_CHARS = 84
MAX_LINE_CHARS = 42
MAX_CUE_SECONDS = 6.0
GAP_SECONDS = 1.5
SENTENCE_END = (".", "?", "!")


def load_fixes(path):
    if path is None:
        return []
    pairs = json.loads(Path(path).read_text(encoding="utf-8"))
    return [(re.compile(pattern), replacement) for pattern, replacement in pairs]


def load_words(segments):
    words = []
    for segment in segments:
        timed = segment["words"]
        if timed:
            words.extend(timed)
            continue
        # No word timing: spread the text evenly over the segment.
        tokens = segment["text"].split()
        if not tokens:
            continue
        total = sum(max(1, len(token)) for token in tokens)
        duration = segment["end"] - segment["start"]
        elapsed = 0
        for token in tokens:
            start = segment["start"] + duration * elapsed / total
            elapsed += max(1, len(token))
            end = segment["start"] + duration * elapsed / total
            words.append({"text": token, "start": start, "end": end})
    words.sort(key=lambda word: word["start"])
    return words


def build_cues(words, fixes):
    cues = []
    current = []

    def close():
        if current:
            cues.append(list(current))
            current.clear()

    for word in words:
        if current:
            text_length = len(" ".join(item["text"] for item in current)) + 1 + len(word["text"])
            too_long = text_length > MAX_CUE_CHARS
            too_slow = word["end"] - current[0]["start"] > MAX_CUE_SECONDS
            gap = word["start"] - current[-1]["end"] > GAP_SECONDS
            sentence_done = current[-1]["text"].endswith(SENTENCE_END) and len(current) >= 3
            if too_long or too_slow or gap or sentence_done:
                close()
        current.append(word)
    close()

    result = []
    for index, cue in enumerate(cues):
        start = cue[0]["start"]
        end = cue[-1]["end"] + 0.1
        if index + 1 < len(cues):
            end = min(end, cues[index + 1][0]["start"])
        end = max(end, start + 0.3)
        text = apply_fixes(" ".join(item["text"] for item in cue), fixes)
        result.append({"start": start, "end": end, "text": text})
    return result


def apply_fixes(text, fixes):
    for pattern, replacement in fixes:
        text = pattern.sub(replacement, text)
    return text


def wrap(text):
    if len(text) <= MAX_LINE_CHARS:
        return text
    middle = len(text) // 2
    left = text.rfind(" ", 0, middle + 1)
    right = text.find(" ", middle)
    split_at = left if left != -1 and (right == -1 or middle - left <= right - middle) else right
    if split_at == -1:
        return text
    return text[:split_at] + "\n" + text[split_at + 1 :]


def stamp(seconds, separator):
    whole = int(seconds)
    millis = int(round((seconds - whole) * 1000))
    if millis == 1000:
        whole += 1
        millis = 0
    hours, rest = divmod(whole, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}{separator}{millis:03d}"


def write_vtt(cues, path):
    lines = ["WEBVTT", ""]
    for cue in cues:
        lines.append(f"{stamp(cue['start'], '.')} --> {stamp(cue['end'], '.')}")
        lines.append(wrap(cue["text"]))
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def write_srt(cues, path):
    lines = []
    for number, cue in enumerate(cues, start=1):
        lines.append(str(number))
        lines.append(f"{stamp(cue['start'], ',')} --> {stamp(cue['end'], ',')}")
        lines.append(wrap(cue["text"]))
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def write_json(cues, path):
    document = {
        "version": "1.0.0",
        "segments": [
            {"startTime": round(cue["start"], 3), "endTime": round(cue["end"], 3), "body": cue["text"]}
            for cue in cues
        ],
    }
    path.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def write_text(segments, fixes, path):
    lines = []
    for segment in segments:
        text = apply_fixes(segment["text"].strip(), fixes)
        if text:
            lines.append(f"[{stamp(segment['start'], '.')[:8]}] {text}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    if len(sys.argv) not in (4, 5):
        print(__doc__.strip().splitlines()[2], file=sys.stderr)
        sys.exit(2)
    segments_path = Path(sys.argv[1])
    folder = Path(sys.argv[2])
    base = sys.argv[3]
    fixes = load_fixes(sys.argv[4] if len(sys.argv) == 5 else None)
    segments = json.loads(segments_path.read_text(encoding="utf-8"))
    cues = build_cues(load_words(segments), fixes)
    write_vtt(cues, folder / f"{base}.vtt")
    write_srt(cues, folder / f"{base}.srt")
    write_json(cues, folder / f"{base}.json")
    write_text(segments, fixes, segments_path.with_suffix(".txt"))
    word_count = sum(len(segment["text"].split()) for segment in segments)
    print(f"{len(segments)} segments, {word_count} words, {len(cues)} cues")


main()
