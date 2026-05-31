#!/usr/bin/env python3
"""Extract case data from CCS review screenshots into cases.json via local Ollama."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

try:
    import ollama
except ImportError:
    print("ERROR: pip install ollama")
    sys.exit(1)

SCREENSHOT_DIR = Path(r"C:\Users\steve\Step 3\ccs_screenshots")
TOPICS_FILE = SCREENSHOT_DIR / "ccs_topics.txt"
OUTPUT_FILE = Path(r"C:\Users\steve\Downloads\clinical-scene\data\cases.json")

VISION_MODEL_CANDIDATES = [
    "llava:34b",
    "llava:13b",
    "llava",
    "bakllava",
    "minicpm-v",
    "moondream",
]

FAILED_CASE_IDS = [
    145, 146, 148, 149, 150, 151, 152, 153, 154,
    156, 157, 159, 160, 161, 162, 163, 164, 165,
    166, 167, 168, 169, 170, 172, 173, 181,
]

NO_SCREENSHOT_IDS = [
    27, 37, 47, 53, 55, 59, 65, 70, 72, 83, 92,
    103, 108, 114, 116, 117, 121, 124, 128, 129,
    131, 132, 141, 144, 147, 155, 158, 171, 174,
    175, 176, 177, 178, 179, 180,
]

OCR_PROMPT = """Extract all clinical data from this CCS review page. Return JSON only. No other text.
Fields required:
{
  "diagnosis": "",
  "your_score": 0,
  "average_score": 0,
  "correctly_ordered": [
    {"order": "", "rationale": ""}
  ],
  "should_have_ordered": [
    {"order": "", "rationale": ""}
  ],
  "correctly_avoided": [
    {"order": "", "rationale": ""}
  ],
  "inappropriate_orders": [
    {"order": "", "reason": ""}
  ],
  "case_summary": ""
}"""

RETRY_SUFFIX = (
    "\n\nReturn ONLY a JSON object. No explanation. "
    "No markdown. Just the raw JSON starting with {"
)

EMPTY_PHYSICAL_EXAM = {
    "general": None,
    "cardiovascular": None,
    "respiratory": None,
    "abdomen": None,
    "extremities": None,
    "neuro": None,
    "skin": None,
    "musculoskeletal": None,
    "psych": None,
    "heent": None,
}

EMPTY_VITALS = {
    "hr": None,
    "spo2": None,
    "bp_systolic": None,
    "bp_diastolic": None,
    "rr": None,
    "temp": None,
    "map": None,
    "lactate": None,
}


def detect_vision_model() -> str:
    result = subprocess.run(
        ["ollama", "list"],
        capture_output=True,
        text=True,
        check=False,
    )
    print(result.stdout)
    if result.returncode != 0:
        raise RuntimeError(f"ollama list failed: {result.stderr.strip()}")

    installed = {line.split()[0] for line in result.stdout.splitlines()[1:] if line.strip()}
    for candidate in VISION_MODEL_CANDIDATES:
        if candidate in installed:
            return candidate
        base = candidate.split(":")[0]
        for name in installed:
            if name == base or name.startswith(f"{base}:"):
                return name

    print("No vision model found. Pulling llava...")
    pull = subprocess.run(["ollama", "pull", "llava"], check=False)
    if pull.returncode != 0:
        raise RuntimeError("Failed to pull llava vision model")
    return "llava"


def load_topics() -> dict[int, str]:
    topics: dict[int, str] = {}
    for line in TOPICS_FILE.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^(\d+)\.\s*(.+)$", line.strip())
        if match:
            topics[int(match.group(1))] = match.group(2).strip()
    return topics


def list_screenshots() -> dict[int, Path]:
    mapping: dict[int, Path] = {}
    for path in sorted(SCREENSHOT_DIR.glob("case_*.png")):
        match = re.match(r"case_(\d+)_", path.name, re.I)
        if match:
            mapping[int(match.group(1))] = path
    return mapping


def find_duplicate_screenshots(screenshots: dict[int, Path]) -> dict[int, int]:
    hashes: dict[str, int] = {}
    dupes: dict[int, int] = {}
    for case_id, path in sorted(screenshots.items()):
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest in hashes:
            dupes[case_id] = hashes[digest]
        else:
            hashes[digest] = case_id
    return dupes


def clean_json_text(raw: str) -> str:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


def parse_ocr_json(raw: str) -> dict:
    text = clean_json_text(raw)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        if start == -1:
            raise
        depth = 0
        for index, char in enumerate(text[start:], start):
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    return json.loads(text[start : index + 1])
        raise


def extract_case_from_image(image_path: Path, model: str, prompt: str = OCR_PROMPT) -> tuple[dict | None, str]:
    with open(image_path, "rb") as handle:
        image_data = base64.b64encode(handle.read()).decode()

    response = ollama.chat(
        model=model,
        messages=[{
            "role": "user",
            "content": prompt,
            "images": [image_data],
        }],
    )
    raw = response["message"]["content"] or ""
    try:
        return parse_ocr_json(raw), raw
    except json.JSONDecodeError:
        return None, raw


def extract_case_with_retry(image_path: Path, model: str, prompt: str = OCR_PROMPT) -> tuple[dict | None, str]:
    ocr, raw_first = extract_case_from_image(image_path, model, prompt=prompt)
    if ocr is not None:
        return ocr, raw_first

    ocr, raw_retry = extract_case_from_image(image_path, model, prompt=prompt + RETRY_SUFFIX)
    combined_raw = raw_first
    if raw_retry:
        combined_raw = f"{raw_first}\n\n--- RETRY ---\n{raw_retry}"
    if ocr is not None:
        return ocr, combined_raw
    return None, combined_raw


def order_names(items: list) -> list[str]:
    names: list[str] = []

    def add_label(value) -> None:
        if value is None:
            return
        if isinstance(value, list):
            for part in value:
                add_label(part)
            return
        if isinstance(value, dict):
            label = (value.get("order") or value.get("reason") or value.get("rationale") or "").strip()
            if label and label not in names:
                names.append(label)
            return
        label = str(value).strip()
        if label and label not in names:
            names.append(label)

    for item in items or []:
        add_label(item)
    return names


def generate_patient_voice(title: str, diagnosis: str | None, case_summary: str | None) -> dict:
    topic = title or "something wrong"
    dx = diagnosis or "I don't know what's wrong"
    summary_hint = (case_summary or "")[:200]
    return {
        "chief_complaint": f"I need help — {topic.lower()}. I'm really scared.",
        "history": f"It's been getting worse. They said something about {dx.lower()}. {summary_hint[:80]}...",
        "pain": f"This {topic.lower()} won't let up and I'm afraid something bad is happening.",
    }


def ocr_to_case_entry(
    ocr: dict,
    case_id: int,
    title: str,
    *,
    status: str = "ok",
    raw_response: str | None = None,
) -> dict:
    correct = order_names(ocr.get("correctly_ordered"))
    should = order_names(ocr.get("should_have_ordered"))
    avoided = order_names(ocr.get("correctly_avoided"))
    diagnosis = ocr.get("diagnosis") or None
    case_summary = ocr.get("case_summary") or None

    entry = {
        "id": case_id,
        "title": title,
        "specialty": None,
        "diagnosis": diagnosis,
        "hpi": None,
        "physical_exam": dict(EMPTY_PHYSICAL_EXAM),
        "vitals": dict(EMPTY_VITALS),
        "correct_orders": correct,
        "should_have_ordered": should,
        "correctly_avoided": avoided,
        "case_summary": case_summary,
        "stacks": correct[:5] if correct else [],
        "patient_voice": generate_patient_voice(title, diagnosis, case_summary),
        "incomplete": True,
        "status": status,
        "your_score": ocr.get("your_score"),
        "average_score": ocr.get("average_score"),
        "order_details": {
            "correctly_ordered": ocr.get("correctly_ordered") or [],
            "should_have_ordered": ocr.get("should_have_ordered") or [],
            "correctly_avoided": ocr.get("correctly_avoided") or [],
            "inappropriate_orders": ocr.get("inappropriate_orders") or [],
        },
        "extraction_notes": "Extracted via local Ollama from review screenshot. HPI, PE, vitals not on review page.",
    }
    if raw_response is not None:
        entry["raw_response"] = raw_response
    return entry


def parse_error_entry(case_id: int, title: str, raw_response: str) -> dict:
    entry = ocr_to_case_entry({}, case_id, title, status="parse_error", raw_response=raw_response)
    entry["extraction_notes"] = "Ollama OCR returned unparseable JSON after retry."
    return entry


def no_screenshot_entry(case_id: int, topic: str) -> dict:
    return {
        "id": case_id,
        "title": topic,
        "topic": topic,
        "specialty": None,
        "diagnosis": None,
        "hpi": None,
        "physical_exam": dict(EMPTY_PHYSICAL_EXAM),
        "vitals": dict(EMPTY_VITALS),
        "correct_orders": [],
        "should_have_ordered": [],
        "correctly_avoided": [],
        "case_summary": None,
        "stacks": [],
        "patient_voice": generate_patient_voice(topic, None, None),
        "incomplete": True,
        "status": "no_screenshot",
        "extraction_notes": "No screenshot in source folder. To be filled from Crush Step 3 CCS book.",
    }


def placeholder_case(case_id: int, title: str, *, duplicate_of: int | None = None) -> dict:
    entry = no_screenshot_entry(case_id, title)
    entry.pop("status", None)
    entry["status"] = "duplicate_screenshot"
    entry["duplicate_screenshot_of"] = duplicate_of
    entry["extraction_notes"] = f"Screenshot file is identical to case {duplicate_of}; re-capture needed."
    return entry


def is_failed_entry(case: dict) -> bool:
    notes = case.get("extraction_notes") or ""
    status = case.get("status")
    return (
        status == "parse_error"
        or "Extraction failed" in notes
        or (case.get("id") in FAILED_CASE_IDS and not case.get("diagnosis") and status != "no_screenshot")
    )


def load_cases_file() -> tuple[dict, list[dict]]:
    payload = json.loads(OUTPUT_FILE.read_text(encoding="utf-8"))
    return payload, payload["cases"]


def save_cases(payload: dict) -> None:
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def mark_no_screenshot_cases(by_id: dict[int, dict], topics: dict[int, str]) -> int:
    updated = 0
    for case_id in NO_SCREENSHOT_IDS:
        topic = topics[case_id]
        by_id[case_id] = no_screenshot_entry(case_id, topic)
        updated += 1
    return updated


def resume_failed(model: str) -> None:
    topics = load_topics()
    screenshots = list_screenshots()
    payload, cases = load_cases_file()
    by_id = {case["id"]: case for case in cases}

    reprocessed: list[int] = []
    parse_errors: list[int] = []
    errors: list[str] = []

    for case_id in FAILED_CASE_IDS:
        title = topics[case_id]
        if case_id not in screenshots:
            errors.append(f"Case {case_id}: screenshot missing on disk")
            continue

        path = screenshots[case_id]
        print(f"Extracting case {case_id}: {path.name}...", flush=True)

        try:
            ocr, raw = extract_case_with_retry(path, model)
            if ocr is None:
                print(f"  JSON parse failed for case {case_id}", flush=True)
            else:
                print(f"  OK case {case_id}: {ocr.get('diagnosis', '?')}", flush=True)

            if ocr is None:
                by_id[case_id] = parse_error_entry(case_id, title, raw)
                parse_errors.append(case_id)
                errors.append(f"Case {case_id}: parse_error")
                continue

            by_id[case_id] = ocr_to_case_entry(ocr, case_id, title)
            reprocessed.append(case_id)
        except Exception as exc:
            by_id[case_id] = parse_error_entry(case_id, title, str(exc))
            parse_errors.append(case_id)
            errors.append(f"Case {case_id}: {exc}")

    marked = mark_no_screenshot_cases(by_id, topics)
    # Rebuild preserving order 1..181
    payload["cases"] = [by_id[i] for i in sorted(by_id.keys())]
    save_cases(payload)

    statuses: dict[str, list[int]] = {}
    for case in payload["cases"]:
        status = case.get("status", "ok")
        statuses.setdefault(status, []).append(case["id"])

    print("\n=== OLLAMA RESUME REPORT ===")
    print(f"Vision model: {model}")
    print(f"Reprocessed: {len(reprocessed)} cases -> {', '.join(map(str, reprocessed)) or 'none'}")
    print(f"Parse errors ({len(parse_errors)}): {', '.join(map(str, parse_errors)) or 'none'}")
    print(f"No-screenshot marked: {marked} cases")
    print(f"Total cases in output: {len(payload['cases'])}")
    for status, ids in sorted(statuses.items()):
        print(f"  status={status}: {len(ids)}")
    if errors:
        print(f"Errors ({len(errors)}):")
        for err in errors:
            print(f"  - {err}")
    print(f"Saved: {OUTPUT_FILE}")


def extract_all(model: str) -> None:
    topics = load_topics()
    screenshots = list_screenshots()
    dupes = find_duplicate_screenshots(screenshots)

    cases: list[dict] = []
    errors: list[str] = []
    parse_errors: list[int] = []

    for case_id in sorted(topics.keys()):
        title = topics[case_id]

        if case_id in NO_SCREENSHOT_IDS or case_id not in screenshots:
            cases.append(no_screenshot_entry(case_id, title))
            continue

        if case_id in dupes:
            cases.append(placeholder_case(case_id, title, duplicate_of=dupes[case_id]))
            errors.append(f"Case {case_id}: duplicate screenshot of case {dupes[case_id]}")
            continue

        path = screenshots[case_id]
        print(f"Extracting case {case_id}: {path.name}...", flush=True)
        ocr, raw = extract_case_with_retry(path, model)
        if ocr is None:
            cases.append(parse_error_entry(case_id, title, raw))
            parse_errors.append(case_id)
            errors.append(f"Case {case_id}: parse_error")
            continue
        cases.append(ocr_to_case_entry(ocr, case_id, title))

    payload = {"cases": cases}
    save_cases(payload)

    print("\n=== OLLAMA EXTRACTION REPORT ===")
    print(f"Vision model: {model}")
    print(f"Total cases: {len(cases)}")
    print(f"Parse errors ({len(parse_errors)}): {', '.join(map(str, parse_errors)) or 'none'}")
    if errors:
        print("Errors:")
        for err in errors:
            print(f"  - {err}")
    print(f"Saved: {OUTPUT_FILE}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract CCS cases via local Ollama vision OCR")
    parser.add_argument(
        "--mode",
        choices=["resume", "all"],
        default="resume",
        help="resume = reprocess failed cases only; all = full re-extraction",
    )
    parser.add_argument("--model", default=None, help="Override vision model name")
    args = parser.parse_args()

    model = args.model or detect_vision_model()
    print(f"Using vision model: {model}\n")

    if args.mode == "resume":
        resume_failed(model)
    else:
        extract_all(model)


if __name__ == "__main__":
    main()
