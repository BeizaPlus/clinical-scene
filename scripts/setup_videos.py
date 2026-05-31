#!/usr/bin/env python3
"""Copy breathing + death videos into assets/video/ and refresh case video lists."""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "assets" / "video"
CASES_JSON = ROOT / "data" / "cases.json"

FILES = [
    (Path(r"C:\Users\steve\Downloads\breathign one.mp4"), DEST / "breathing_01.mp4"),
    (Path(r"C:\Users\steve\Downloads\breathign two.mp4"), DEST / "breathing_02.mp4"),
    (Path(r"C:\Users\steve\Downloads\breathig 3 .mp4"), DEST / "breathing_03.mp4"),
    (Path(r"C:\Users\steve\Downloads\death.mp4"), DEST / "death.mp4"),
]


def main() -> None:
    DEST.mkdir(parents=True, exist_ok=True)
    print("=== COPY ===")
    for src, dst in FILES:
        if not src.is_file():
            print(f"MISSING source: {src}")
            continue
        shutil.copy2(src, dst)
        size_mb = os.path.getsize(dst) / (1024 * 1024)
        flag = "WARNING >95MB" if size_mb > 95 else "OK"
        print(f"{flag}: {src.name} -> {dst.name} ({size_mb:.1f} MB)")

    breathing = sorted(DEST.glob("breathing_*.mp4"))
    print(f"\nBreathing videos in assets/video: {len(breathing)}")
    for path in breathing:
        print(f"  {path.name}")

    death = DEST / "death.mp4"
    if death.is_file():
        print("death.mp4: present")
    else:
        print("WARNING: death.mp4 missing — deterioration sequence will not trigger")

    if CASES_JSON.is_file():
        payload = json.loads(CASES_JSON.read_text(encoding="utf-8"))
        idle = [p.name for p in breathing]
        for case in payload.get("cases", []):
            case["videos"] = {"idle": idle, "death": "death.mp4"}
        CASES_JSON.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(f"UPDATED: videos.idle on {len(payload.get('cases', []))} cases in data/cases.json")


if __name__ == "__main__":
    main()
