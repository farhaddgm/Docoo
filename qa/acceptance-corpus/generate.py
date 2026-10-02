"""Generates acceptance corpus v0 (QA-002): synthetic, non-sensitive fixtures with ground truth.

Requires Pillow with raqm (Persian shaping) and espeak-ng. Output bytes may differ between
tool versions, so the committed files plus manifest checksums are the source of truth;
regenerate only when publishing a new corpus version.
"""

import hashlib
import json
import random
import subprocess
import wave
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

VERSION = "v0"
OUT = Path(__file__).parent / VERSION
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

PERSIAN_BRIEF = [
    "شرح مسئلهٔ نمونه برای آزمون پذیرش",
    "شرکت نمونهٔ آریا در فروش آنلاین با کاهش بیست درصدی",
    "مشتریان تکراری روبه‌رو شده است.",
    "مدیرعامل می‌خواهد ظرف شش ماه نرخ بازگشت مشتری را",
    "افزایش دهد و هزینهٔ جذب مشتری جدید را کنترل کند.",
    "داده‌های فروش سه سال اخیر در دسترس است",
    "اما گزارش رضایت مشتری وجود ندارد.",
]

ENGLISH_MEMO_PAGES = [
    [
        "Sample problem memo for acceptance testing",
        "Northwind Demo Ltd. sells office furniture online.",
        "Average delivery time grew from three to nine days",
        "after the warehouse moved in the last quarter.",
    ],
    [
        "Goal: bring delivery back under four days within",
        "two quarters without raising logistics cost by more",
        "than ten percent. Carrier contracts end in March.",
    ],
]

PERSIAN_AUDIO = "مشکل اصلی ما کاهش خرید دوباره مشتریان در شش ماه گذشته است."
ENGLISH_AUDIO = "Our main problem is that delivery times tripled after the warehouse move."


def scan(lines, rtl, seed):
    """Renders text as a noisy, slightly rotated grayscale 'scan' with no text layer."""
    rng = random.Random(seed)
    page = Image.new("L", (1654, 2339), 248)  # A4 at 200 dpi
    draw = ImageDraw.Draw(page)
    font = ImageFont.truetype(FONT, 46)
    y = 220
    for line in lines:
        options = {"direction": "rtl", "language": "fa"} if rtl else {}
        width = draw.textlength(line, font=font, **options)
        x = 1654 - 180 - width if rtl else 180
        draw.text((x, y), line, fill=25, font=font, **options)
        y += 92
    for _ in range(4000):  # speckle noise of a cheap scanner
        page.putpixel((rng.randrange(1654), rng.randrange(2339)), rng.randrange(120, 230))
    page = page.rotate(rng.uniform(-1.2, 1.2), fillcolor=248, resample=Image.BICUBIC)
    return page.filter(ImageFilter.GaussianBlur(0.6)).convert("RGB")


def speak(text, voice, target):
    raw = target.with_suffix(".raw.wav")
    subprocess.run(["espeak-ng", "-v", voice, "-s", "140", "-w", str(raw), text], check=True)
    with wave.open(str(raw), "rb") as source:
        params = source.getparams()
        frames = source.readframes(source.getnframes())
    with wave.open(str(target), "wb") as sink:
        sink.setparams(params)
        sink.writeframes(frames)
    raw.unlink()
    with wave.open(str(target), "rb") as result:
        return {
            "sampleRate": result.getframerate(),
            "channels": result.getnchannels(),
            "durationSeconds": round(result.getnframes() / result.getframerate(), 2),
        }


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    items = []

    fa_pdf = OUT / "scanned-fa-brief.pdf"
    scan(PERSIAN_BRIEF, rtl=True, seed=1).save(fa_pdf, "PDF", resolution=200.0, quality=80)
    (OUT / "scanned-fa-brief.expected.txt").write_text("\n".join(PERSIAN_BRIEF) + "\n", "utf-8")
    items.append({
        "id": "scan-fa-001",
        "file": fa_pdf.name,
        "kind": "pdf",
        "language": "fa",
        "expected": {
            "pages": 1,
            "textLayer": False,
            "transcript": "scanned-fa-brief.expected.txt",
            "mustContain": ["کاهش بیست درصدی", "شش ماه", "رضایت مشتری"],
            "minCharacterAccuracy": 0.85,
            "pipeline": ["quarantine", "scan", "ocr", "lineage"],
        },
    })

    en_pdf = OUT / "scanned-en-memo.pdf"
    pages = [scan(lines, rtl=False, seed=10 + index) for index, lines in enumerate(ENGLISH_MEMO_PAGES)]
    pages[0].save(en_pdf, "PDF", resolution=200.0, quality=80, save_all=True, append_images=pages[1:])
    (OUT / "scanned-en-memo.expected.txt").write_text(
        "\n\n".join("\n".join(lines) for lines in ENGLISH_MEMO_PAGES) + "\n", "utf-8"
    )
    items.append({
        "id": "scan-en-001",
        "file": en_pdf.name,
        "kind": "pdf",
        "language": "en",
        "expected": {
            "pages": 2,
            "textLayer": False,
            "transcript": "scanned-en-memo.expected.txt",
            "mustContain": ["three to nine days", "under four days", "March"],
            "minCharacterAccuracy": 0.95,
            "pipeline": ["quarantine", "scan", "ocr", "lineage"],
        },
    })

    for item_id, name, voice, text, language, accuracy in [
        ("audio-fa-001", "audio-fa-interview.wav", "fa", PERSIAN_AUDIO, "fa", 0.7),
        ("audio-en-001", "audio-en-note.wav", "en-us", ENGLISH_AUDIO, "en", 0.85),
    ]:
        target = OUT / name
        properties = speak(text, voice, target)
        transcript = name.replace(".wav", ".expected.txt")
        (OUT / transcript).write_text(text + "\n", "utf-8")
        items.append({
            "id": item_id,
            "file": name,
            "kind": "audio",
            "language": language,
            "expected": {
                **properties,
                "transcript": transcript,
                "minWordAccuracy": accuracy,
                "pipeline": ["quarantine", "scan", "transcription", "lineage"],
            },
        })

    for item in items:
        files = [item["file"], item["expected"]["transcript"]]
        item["sha256"] = {name: sha256(OUT / name) for name in files}

    manifest = {
        "corpus": "docoo-acceptance",
        "version": VERSION,
        "description": "Synthetic, non-sensitive fixtures with ground truth for ingestion acceptance.",
        "generator": "qa/acceptance-corpus/generate.py",
        "items": items,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", "utf-8")


if __name__ == "__main__":
    main()
