#!/usr/bin/env python3
"""Copy and rename patient videos from Downloads into assets/video/."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

SOURCE_DIR = Path(r"C:\Users\steve\Downloads")
PROJECT_ROOT = Path(__file__).resolve().parent
DEST_DIR = PROJECT_ROOT / "assets" / "video"
CASES_JSON = PROJECT_ROOT / "data" / "cases.json"

DEATH_KEYWORDS = ("death", "die", "deteriorat")
BREATH_KEYWORDS = ("breath", "idle", "loop")


def classify(filename: str) -> str | None:
    lower = filename.lower()
    if any(keyword in lower for keyword in DEATH_KEYWORDS):
        return "death"
    if any(keyword in lower for keyword in BREATH_KEYWORDS):
        return "breathing"
    return None


def list_source_videos() -> list[Path]:
    if not SOURCE_DIR.is_dir():
        print(f"ERROR: Source folder not found: {SOURCE_DIR}")
        sys.exit(1)

    return sorted(
        path
        for path in SOURCE_DIR.iterdir()
        if path.is_file() and path.suffix.lower() == ".mp4"
    )


def next_breathing_filename() -> str:
    number = 1
    while (DEST_DIR / f"breathing_{number:02d}.mp4").exists():
        number += 1
    return f"breathing_{number:02d}.mp4"


def copy_death(source: Path) -> bool:
    destination = DEST_DIR / "death.mp4"
    if destination.exists():
        print(f"SKIP: death.mp4 already exists (source: {source.name})")
        return False

    shutil.copy2(source, destination)
    print(f"COPIED: {source.name} -> death.mp4")
    return True


def copy_breathing(source: Path) -> bool:
    filename = next_breathing_filename()
    destination = DEST_DIR / filename

    if destination.exists():
        print(f"SKIP: {filename} already exists (source: {source.name})")
        return False

    shutil.copy2(source, destination)
    print(f"COPIED: {source.name} -> {filename}")
    return True


def prompt_unknown(source: Path, skip_unknown: bool) -> str:
    if skip_unknown:
        print(f"SKIP: {source.name} (unknown type, --skip-unknown)")
        return "skip"

    while True:
        answer = input(
            f"{source.name}\nIs this a breathing video or death video? (b/d/skip): "
        ).strip().lower()
        if answer in {"b", "d", "skip", "s"}:
            return "skip" if answer in {"skip", "s"} else answer
        print("Enter b, d, or skip.")


def list_breathing_videos() -> list[str]:
    files: list[tuple[int, str]] = []
    for path in DEST_DIR.glob("breathing_*.mp4"):
        match = re.match(r"breathing_(\d+)\.mp4$", path.name, re.IGNORECASE)
        if match:
            files.append((int(match.group(1)), path.name))
    files.sort(key=lambda item: item[0])
    return [name for _, name in files]


def update_idle_videos_array() -> None:
    if not SCENE_JS.is_file():
        print(f"WARNING: Could not update idleVideos — missing {SCENE_JS}")
        return

    breathing_files = list_breathing_videos()
    lines = [f"    'assets/video/{name}'," for name in breathing_files]
    if lines:
        lines.append("    // drop new files here as they are generated")
        body = "\n".join(lines)
    else:
        body = "    // drop new files here as they are generated"

    replacement = f"  const idleVideos = [\n{body}\n  ];"
    content = SCENE_JS.read_text(encoding="utf-8")
    updated, count = re.subn(
        r"  const idleVideos = \[[\s\S]*?\];",
        replacement,
        content,
        count=1,
    )

    if count != 1:
        print("WARNING: Could not update idleVideos array in assets/js/scene.js")
        return

    SCENE_JS.write_text(updated, encoding="utf-8", newline="\n")
    print(f"UPDATED: idleVideos array in {SCENE_JS.relative_to(PROJECT_ROOT)}")


def print_summary(breathing_count: int, death_found: bool) -> None:
    print()
    print(f"Breathing videos: {breathing_count}")
    print(f"Death video: {'found' if death_found else 'not found'}")
    print(f"Destination: {DEST_DIR}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Copy patient videos from Downloads into assets/video/."
    )
    parser.add_argument(
        "--skip-unknown",
        action="store_true",
        help="Skip unrecognized .mp4 files instead of prompting.",
    )
    args = parser.parse_args()

    DEST_DIR.mkdir(parents=True, exist_ok=True)

    sources = list_source_videos()
    if not sources:
        print(f"No .mp4 files found in {SOURCE_DIR}")
    else:
        print(f"Scanning {len(sources)} .mp4 file(s) in {SOURCE_DIR}\n")

    for source in sources:
        kind = classify(source.name)

        if kind is None:
            choice = prompt_unknown(source, args.skip_unknown)
            if choice == "skip":
                continue
            kind = "breathing" if choice == "b" else "death"

        if kind == "death":
            copy_death(source)
        else:
            copy_breathing(source)

    breathing_count = len(list_breathing_videos())
    death_found = (DEST_DIR / "death.mp4").is_file()
    update_idle_videos_array()
    print_summary(breathing_count, death_found)


if __name__ == "__main__":
    main()
