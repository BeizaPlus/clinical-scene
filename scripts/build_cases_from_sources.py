#!/usr/bin/env python3
"""
Merge CCS review screenshots (answer key) + MultiCaRe (clinical presentation) → cases.json

Phases:
  answer-keys  — OCR review screenshots → data/answer_keys.json
  merge          — MultiCaRe + Claude → data/cases.json (batched, resumable)
  all            — both phases

Examples:
  python build_cases_from_sources.py answer-keys --resume
  python build_cases_from_sources.py merge --batch-size 10 --resume
  python build_cases_from_sources.py merge --case-ids 1,143 --batch-size 2
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent
DATA_DIR = ROOT / "data"
SCREENSHOT_DIR = Path(r"C:\Users\steve\Step 3\ccs_screenshots")
TOPICS_FILE = SCREENSHOT_DIR / "ccs_topics.txt"
MULTICARE_DIR = Path(r"C:\Users\steve\Step 3\MultiCaRe\medical_datasets")
MULTICARE_LIB = Path(r"C:\Users\steve\Step 3\MultiCaRe\MultiCaRe_Dataset\multiversity_library\multiversity")

ANSWER_KEYS_FILE = DATA_DIR / "answer_keys.json"
CASES_FILE = DATA_DIR / "cases.json"
PROGRESS_FILE = DATA_DIR / "cases_build_progress.json"
LOG_FILE = DATA_DIR / "cases_build_log.txt"

CLAUDE_MODEL = os.environ.get("ANTHROPIC_CASE_MODEL", "claude-sonnet-4-20250514")

GUIDELINE_RE = re.compile(
    r"\b(AAP|ACEP|PALS|ACLS|ATLS|Surviving Sepsis|IDSA|AHA|ACC|ASH|USPSTF|CDC|WHO|NICE|SSC)\b",
    re.I,
)

PE_SYSTEMS = [
    "general",
    "cardiovascular",
    "respiratory",
    "abdomen",
    "extremities",
    "neuro",
    "skin",
    "musculoskeletal",
    "psych",
    "heent",
]

EMPTY_PE = {k: None for k in PE_SYSTEMS}
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

ANSWER_KEY_OCR_PROMPT = """Extract all clinical data from this CCS review page. Return JSON only.

{
  "diagnosis": "final diagnosis exactly as shown",
  "your_score": 0,
  "average_score": 0,
  "timing_score": "if shown, else null",
  "specialty": "e.g. Pediatrics, Emergency Medicine",
  "setting": "ER, ICU, OBS, clinic, etc",
  "correctly_ordered": [
    {
      "order": "exact order text",
      "rationale": "exact rationale text",
      "guideline": "AAP, ACEP, PALS etc if cited, else empty string",
      "category": "emergent"
    }
  ],
  "should_have_ordered": [
    {"order": "exact text", "rationale": "exact text", "guideline": "", "category": "long_term"}
  ],
  "correctly_avoided": [
    {"order": "exact text", "rationale": "exact text", "guideline": "", "category": "avoided"}
  ],
  "inappropriate_orders": [
    {"order": "exact text", "reason": "exact text"}
  ],
  "case_summary": "exact full case summary paragraph"
}"""


def log(msg: str) -> None:
    line = f"[{datetime.now().isoformat(timespec='seconds')}] {msg}"
    print(line, flush=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with LOG_FILE.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_json(path: Path, default):
    if not path.is_file():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def import_extract_module():
    extract_path = SCRIPT_DIR / "extract_cases_from_screenshots.py"
    if not extract_path.is_file():
        raise FileNotFoundError(f"Missing {extract_path}")
    import importlib.util

    spec = importlib.util.spec_from_file_location("extract_cases", extract_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def infer_guideline(text: str) -> str:
    if not text:
        return ""
    match = GUIDELINE_RE.search(text)
    return match.group(1).upper() if match else ""


def normalize_order_items(items: list | None, default_category: str) -> list[dict]:
    out: list[dict] = []
    for idx, item in enumerate(items or [], start=1):
        if isinstance(item, str):
            out.append({
                "order": item.strip(),
                "rationale": "",
                "guideline": "",
                "sequence": idx,
                "category": default_category,
            })
            continue
        if not isinstance(item, dict):
            continue
        order = (item.get("order") or item.get("reason") or "").strip()
        rationale = (item.get("rationale") or item.get("reason") or "").strip()
        guideline = (item.get("guideline") or infer_guideline(rationale)).strip()
        out.append({
            "order": order,
            "rationale": rationale,
            "guideline": guideline,
            "sequence": item.get("sequence") or idx,
            "category": item.get("category") or default_category,
        })
    return [x for x in out if x["order"]]


def order_strings(items: list[dict]) -> list[str]:
    return [x["order"] for x in items if x.get("order")]


def ocr_to_answer_key(ocr: dict, case_id: int, title: str, screenshot: str | None) -> dict:
    correct = normalize_order_items(ocr.get("correctly_ordered"), "emergent")
    should = normalize_order_items(ocr.get("should_have_ordered"), "long_term")
    avoided = normalize_order_items(ocr.get("correctly_avoided"), "avoided")

    missing: list[str] = []
    if not ocr.get("diagnosis"):
        missing.append("diagnosis")
    if not correct:
        missing.append("correct_orders")
    if not ocr.get("case_summary"):
        missing.append("case_summary")

    return {
        "id": case_id,
        "title": title,
        "specialty": ocr.get("specialty") or ocr.get("setting") or None,
        "setting": ocr.get("setting") or None,
        "diagnosis": ocr.get("diagnosis") or None,
        "correct_orders": correct,
        "should_have_ordered": should,
        "correctly_avoided": avoided,
        "case_summary": ocr.get("case_summary") or None,
        "your_score": ocr.get("your_score"),
        "average_score": ocr.get("average_score"),
        "timing_score": ocr.get("timing_score"),
        "answer_key_screenshot": screenshot,
        "incomplete": bool(missing),
        "missing_fields": missing,
        "order_details": {
            "inappropriate_orders": ocr.get("inappropriate_orders") or [],
        },
    }


def is_template_ocr(ocr: dict) -> bool:
    blob = json.dumps(ocr).lower()
    markers = [
        "exact order text",
        "exactly as shown",
        "exact full case summary",
        "exact rationale text",
        "if shown, else null",
    ]
    return any(m in blob for m in markers)


def legacy_ocr_to_answer_key(entry: dict) -> dict:
    """Convert extract_cases_from_screenshots entry → answer_keys format."""
    details = entry.get("order_details") or {}
    return {
        "id": entry["id"],
        "title": entry.get("title"),
        "specialty": entry.get("specialty"),
        "setting": entry.get("specialty"),
        "diagnosis": entry.get("diagnosis"),
        "correct_orders": normalize_order_items(details.get("correctly_ordered"), "emergent"),
        "should_have_ordered": normalize_order_items(details.get("should_have_ordered"), "long_term"),
        "correctly_avoided": normalize_order_items(details.get("correctly_avoided"), "avoided"),
        "case_summary": entry.get("case_summary"),
        "your_score": entry.get("your_score"),
        "average_score": entry.get("average_score"),
        "timing_score": None,
        "answer_key_screenshot": None,
        "incomplete": entry.get("incomplete", True),
        "missing_fields": [],
        "order_details": {
            "inappropriate_orders": details.get("inappropriate_orders") or [],
        },
    }


def load_progress() -> dict:
    return load_json(PROGRESS_FILE, {
        "completed_ids": [],
        "partial_ids": [],
        "failed_ids": [],
        "no_multicare_match_ids": [],
        "last_batch": 0,
        "started_at": None,
        "updated_at": None,
    })


def save_progress(progress: dict) -> None:
    progress["updated_at"] = utc_now()
    save_json(PROGRESS_FILE, progress)


def diagnosis_terms(diagnosis: str | None, title: str | None) -> list[str]:
    source = diagnosis or title or ""
    parts = re.findall(r"[A-Za-z]{4,}", source)
    stop = {"with", "from", "type", "syndrome", "disease", "acute", "chronic", "secondary"}
    terms = [p.lower() for p in parts if p.lower() not in stop]
    if not terms and title:
        terms = [w.lower() for w in re.findall(r"[A-Za-z]{4,}", title)]
    return terms[:6] or ["clinical"]


def init_multicare():
    if str(MULTICARE_LIB) not in sys.path:
        sys.path.insert(0, str(MULTICARE_LIB))
    from multiversity.multicare_dataset import MedicalDatasetCreator

    MULTICARE_DIR.mkdir(parents=True, exist_ok=True)
    log(f"Loading MultiCaRe from {MULTICARE_DIR} ...")
    return MedicalDatasetCreator(directory=str(MULTICARE_DIR))


def score_multicare_match(case: dict, terms: list[str], setting: str | None) -> int:
    text = (case.get("case_text") or "").lower()
    score = 0
    for term in terms:
        if term in text:
            score += 3 if len(term) > 6 else 2
    if len(terms) >= 2 and sum(1 for t in terms if t in text) >= 2:
        score += 4

    acute_words = ["emergency", "ed ", " er", "acute", "presented with", "admitted", "critical"]
    if any(w in text for w in acute_words):
        score += 2
    if setting and setting.lower() in text:
        score += 2

    # completeness proxy
    if re.search(r"\b\d{1,3}\s*(?:/|over)\s*\d{2,3}\b", text):
        score += 1
    if "heart rate" in text or "blood pressure" in text or "temperature" in text:
        score += 2
    if "physical examination" in text or "on exam" in text:
        score += 2
    if len(text) > 400:
        score += 1
    return score


def search_multicare(mdc, diagnosis: str | None, title: str | None, setting: str | None, limit: int = 10) -> list[dict]:
    terms = diagnosis_terms(diagnosis, title)
    scored: list[tuple[int, dict]] = []
    seen: set[str] = set()

    for case_list in mdc.full_cases["cases"]:
        for case in case_list:
            case_id = case.get("case_id") or ""
            if not case_id or case_id in seen:
                continue
            score = score_multicare_match(case, terms, setting)
            if score < 4:
                continue
            seen.add(case_id)
            text = case.get("case_text") or ""
            scored.append((score, {
                "case_id": case_id,
                "age": case.get("age"),
                "gender": case.get("gender"),
                "case_text": text,
                "score": score,
            }))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [item for _, item in scored[:limit]]


def require_anthropic():
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY not set (needed for presentation extraction + distractors)")
    import anthropic

    return anthropic.Anthropic(api_key=key)


def claude_json(client, system: str, user: str) -> dict:
    response = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=2000,
        temperature=0.2,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    raw = response.content[0].text.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    return json.loads(raw)


PRESENTATION_SYSTEM = """You reconstruct clinical case presentation fields from a de-identified case report.

STRICT RULES:
- Use ONLY facts present in the provided MultiCaRe source text.
- physical_exam: extract verbatim findings per system if present; null if not mentioned.
- vitals: extract numeric values if explicitly stated; if a vital is missing but diagnosis/context strongly implies a range, you MAY fill with plausible value and list it in derived_fields.
- hpi: 3-5 sentences, third person, objective clinical tone. Grounded only in source.
- Never copy findings from outside the source text.
- Never use the CCS answer-key diagnosis to invent exam findings.

Return ONLY JSON:
{
  "hpi": "string",
  "physical_exam": {"general": null, "cardiovascular": null, "respiratory": null, "abdomen": null, "extremities": null, "neuro": null, "skin": null, "musculoskeletal": null, "psych": null, "heent": null},
  "vitals": {"hr": null, "spo2": null, "bp_systolic": null, "bp_diastolic": null, "rr": null, "temp": null, "map": null, "lactate": null},
  "derived_fields": ["vitals.hr"],
  "fields_not_in_source": ["physical_exam.neuro"],
  "multicare_case_id": "id from source"
}"""


PATIENT_VOICE_SYSTEM = """Generate patient_voice for a scared hospital patient.

Rules:
- Plain scared first-person fragments.
- Max 2 sentences per field.
- No medical jargon, no self-diagnosis.
- Ground in the HPI provided only.

Return ONLY JSON:
{"chief_complaint": "...", "history": "...", "pain": "..."}"""


DISTRACTOR_SYSTEM = """Generate clinically plausible WRONG orders (distractors) for a training case.

Return ONLY JSON:
{"distractors": [{"order": "...", "why_wrong": "one specific sentence"}]}

Rules:
- Exactly 4 distractors.
- Each must be plausible but wrong for THIS diagnosis.
- Do not duplicate correct orders."""


def extract_presentation(client, source_case: dict, answer_key: dict) -> dict:
    user = json.dumps({
        "ccs_diagnosis_for_context_only_do_not_invent_from_it": answer_key.get("diagnosis"),
        "ccs_case_summary_for_context_only": answer_key.get("case_summary"),
        "multicare_source": {
            "case_id": source_case.get("case_id"),
            "age": source_case.get("age"),
            "gender": source_case.get("gender"),
            "case_text": source_case.get("case_text"),
        },
    }, indent=2)
    return claude_json(client, PRESENTATION_SYSTEM, user)


def generate_patient_voice(client, hpi: str) -> dict:
    return claude_json(client, PATIENT_VOICE_SYSTEM, f"HPI:\n{hpi}")


def generate_distractors(client, answer_key: dict) -> list[dict]:
    payload = {
        "diagnosis": answer_key.get("diagnosis"),
        "title": answer_key.get("title"),
        "correct_orders": order_strings(answer_key.get("correct_orders") or []),
        "case_summary": answer_key.get("case_summary"),
    }
    result = claude_json(client, DISTRACTOR_SYSTEM, json.dumps(payload, indent=2))
    return result.get("distractors") or []


def merge_vitals(raw: dict) -> tuple[dict, list[str]]:
    vitals = dict(EMPTY_VITALS)
    derived = list(raw.get("derived_fields") or [])
    source = raw.get("vitals") or {}
    for key in EMPTY_VITALS:
        val = source.get(key)
        if isinstance(val, (int, float)):
            vitals[key] = val
    if vitals["bp_systolic"] and vitals["bp_diastolic"] and not vitals["map"]:
        vitals["map"] = round(vitals["bp_diastolic"] + (vitals["bp_systolic"] - vitals["bp_diastolic"]) / 3)
    return vitals, [f"vitals.{k}" if not k.startswith("vitals.") else k for k in derived]


def build_merged_case(answer_key: dict, presentation: dict, matches: list[dict], distractors: list[dict]) -> dict:
    pe = dict(EMPTY_PE)
    for key in PE_SYSTEMS:
        val = (presentation.get("physical_exam") or {}).get(key)
        pe[key] = val if val else None

    vitals, derived_from_vitals = merge_vitals(presentation)
    derived_fields = list(presentation.get("derived_fields") or [])
    derived_fields.extend(derived_from_vitals)
    derived_fields = sorted(set(derived_fields))

    missing = list(answer_key.get("missing_fields") or [])
    if not presentation.get("hpi"):
        missing.append("hpi")
    if not any(v for v in vitals.values() if v is not None):
        missing.append("vitals")

    correct = answer_key.get("correct_orders") or []
    stacks = order_strings(correct)[:5]

    return {
        "id": answer_key["id"],
        "title": answer_key.get("title"),
        "specialty": answer_key.get("specialty") or answer_key.get("setting"),
        "diagnosis": answer_key.get("diagnosis"),
        "source": {
            "answer_key_screenshot": answer_key.get("answer_key_screenshot"),
            "multicare_case_ids": [m.get("case_id") for m in matches[:3] if m.get("case_id")],
            "primary_multicare_case_id": presentation.get("multicare_case_id"),
            "derived_fields": derived_fields,
            "fields_not_in_source": presentation.get("fields_not_in_source") or [],
        },
        "hpi": presentation.get("hpi"),
        "physical_exam": pe,
        "vitals": vitals,
        "correct_orders": correct,
        "should_have_ordered": order_strings(answer_key.get("should_have_ordered") or []),
        "correctly_avoided": order_strings(answer_key.get("correctly_avoided") or []),
        "distractors": distractors,
        "stacks": stacks,
        "case_summary": answer_key.get("case_summary"),
        "patient_voice": presentation.get("patient_voice") or {},
        "your_score": answer_key.get("your_score"),
        "average_score": answer_key.get("average_score"),
        "timing_score": answer_key.get("timing_score"),
        "incomplete": bool(missing),
        "missing_fields": sorted(set(missing)),
        "reconstruction_status": "full" if not missing else "partial",
    }


def bootstrap_answer_keys_from_cases() -> None:
    """Seed answer_keys.json from existing cases.json (order fields only)."""
    cases_payload = load_json(CASES_FILE, {"cases": []})
    if not cases_payload.get("cases"):
        raise SystemExit(f"No cases in {CASES_FILE}")

    keys = []
    for case in cases_payload["cases"]:
        keys.append({
            "id": case["id"],
            "title": case.get("title"),
            "specialty": case.get("specialty"),
            "setting": case.get("specialty"),
            "diagnosis": case.get("diagnosis"),
            "correct_orders": normalize_order_items(
                [{"order": o, "rationale": "", "guideline": "", "category": "emergent"} for o in case.get("correct_orders") or case.get("stacks") or []],
                "emergent",
            ),
            "should_have_ordered": normalize_order_items(
                [{"order": o, "rationale": "", "guideline": "", "category": "long_term"} for o in case.get("should_have_ordered") or []],
                "long_term",
            ),
            "correctly_avoided": normalize_order_items(
                [{"order": o, "rationale": "", "guideline": "", "category": "avoided"} for o in case.get("correctly_avoided") or []],
                "avoided",
            ),
            "case_summary": case.get("case_summary"),
            "your_score": case.get("your_score"),
            "average_score": case.get("average_score"),
            "timing_score": case.get("timing_score"),
            "answer_key_screenshot": None,
            "incomplete": case.get("incomplete", False),
            "missing_fields": case.get("missing_fields") or [],
            "order_details": case.get("order_details") or {},
        })

    save_json(ANSWER_KEYS_FILE, {"cases": keys})
    log(f"Bootstrapped {len(keys)} answer keys from {CASES_FILE} -> {ANSWER_KEYS_FILE}")


def phase_answer_keys(args, extract_mod) -> None:
    if args.bootstrap_from_cases:
        bootstrap_answer_keys_from_cases()
        return

    topics = extract_mod.load_topics()
    screenshots = extract_mod.list_screenshots()
    dupes = extract_mod.find_duplicate_screenshots(screenshots)

    existing = load_json(ANSWER_KEYS_FILE, {"cases": []})
    by_id = {c["id"]: c for c in existing.get("cases", [])}

    model = args.model or extract_mod.detect_vision_model()
    log(f"Answer-key extraction using vision model: {model}")

    targets = sorted(topics.keys())
    if args.case_ids:
        targets = [i for i in args.case_ids if i in topics]

    for case_id in targets:
        if args.resume and case_id in by_id and not by_id[case_id].get("incomplete"):
            log(f"  skip case {case_id} (answer key complete)")
            continue

        title = topics[case_id]
        if case_id in extract_mod.NO_SCREENSHOT_IDS or case_id not in screenshots:
            by_id[case_id] = ocr_to_answer_key({}, case_id, title, None)
            by_id[case_id]["incomplete"] = True
            by_id[case_id]["missing_fields"] = ["screenshot"]
            continue

        if case_id in dupes:
            by_id[case_id] = ocr_to_answer_key({}, case_id, title, screenshots[case_id].name)
            by_id[case_id]["incomplete"] = True
            by_id[case_id]["missing_fields"] = ["duplicate_screenshot"]
            continue

        path = screenshots[case_id]
        log(f"OCR case {case_id}: {path.name}")
        ocr, raw = extract_mod.extract_case_with_retry(path, model)
        if ocr is None or is_template_ocr(ocr):
            if ocr is not None:
                log(f"  case {case_id}: template OCR detected, retrying with legacy prompt")
                ocr, raw = extract_mod.extract_case_with_retry(path, model, prompt=extract_mod.OCR_PROMPT)
        if ocr is None:
            entry = ocr_to_answer_key({}, case_id, title, path.name)
            entry["missing_fields"].append("ocr_parse_error")
            entry["incomplete"] = True
            entry["raw_ocr"] = raw[:4000]
        else:
            legacy = extract_mod.ocr_to_case_entry(ocr, case_id, title)
            entry = legacy_ocr_to_answer_key(legacy)
            entry["answer_key_screenshot"] = path.name
        by_id[case_id] = entry
        save_json(ANSWER_KEYS_FILE, {"cases": [by_id[i] for i in sorted(by_id.keys())]})

    payload = {"cases": [by_id[i] for i in sorted(by_id.keys())]}
    save_json(ANSWER_KEYS_FILE, payload)
    log(f"Saved {len(payload['cases'])} answer keys -> {ANSWER_KEYS_FILE}")


def phase_merge(args) -> None:
    answer_keys = load_json(ANSWER_KEYS_FILE, {"cases": []})
    if not answer_keys.get("cases"):
        raise SystemExit(f"No answer keys at {ANSWER_KEYS_FILE}. Run answer-keys phase first.")

    progress = load_progress()
    if not progress.get("started_at"):
        progress["started_at"] = utc_now()

    completed = set(progress.get("completed_ids") or [])

    cases_payload = load_json(CASES_FILE, {"cases": []})
    cases_by_id = {c["id"]: c for c in cases_payload.get("cases", [])}

    keys = answer_keys["cases"]
    if args.case_ids:
        wanted = set(args.case_ids)
        keys = [k for k in keys if k["id"] in wanted]

    pending = [k for k in keys if k["id"] not in completed]
    batch_size = args.batch_size

    mdc = init_multicare()
    client = None
    if not args.skip_claude:
        try:
            client = require_anthropic()
        except RuntimeError as exc:
            log(f"WARNING: {exc} — presentation/distractor steps limited")

    full = partial = failed = no_match = 0

    for batch_num, start in enumerate(range(0, len(pending), batch_size), start=progress.get("last_batch", 0) + 1):
        batch = pending[start : start + batch_size]
        if not batch:
            break
        log(f"=== Batch {batch_num}: cases {[k['id'] for k in batch]} ===")

        for answer_key in batch:
            case_id = answer_key["id"]
            try:
                matches = search_multicare(
                    mdc,
                    answer_key.get("diagnosis"),
                    answer_key.get("title"),
                    answer_key.get("setting"),
                    limit=10,
                )
                if not matches:
                    log(f"  case {case_id}: no MultiCaRe match")
                    progress.setdefault("no_multicare_match_ids", []).append(case_id)
                    merged = build_merged_case(answer_key, {"hpi": None, "physical_exam": EMPTY_PE, "vitals": EMPTY_VITALS}, [], [])
                    merged["reconstruction_status"] = "failed"
                    merged["incomplete"] = True
                    merged["missing_fields"] = sorted(set(merged.get("missing_fields", []) + ["multicare_match"]))
                    cases_by_id[case_id] = merged
                    failed += 1
                    progress.setdefault("failed_ids", []).append(case_id)
                    continue

                top_matches = matches[:3]
                source = top_matches[0]
                log(f"  case {case_id}: MultiCaRe {source['case_id']} (score {source['score']})")

                presentation = {"hpi": None, "physical_exam": EMPTY_PE, "vitals": EMPTY_VITALS}
                distractors: list[dict] = []

                if client:
                    presentation = extract_presentation(client, source, answer_key)
                    presentation["multicare_case_id"] = presentation.get("multicare_case_id") or source["case_id"]
                    if presentation.get("hpi"):
                        presentation["patient_voice"] = generate_patient_voice(client, presentation["hpi"])
                    distractors = generate_distractors(client, answer_key)
                else:
                    # Minimal fallback without Claude
                    text = source.get("case_text") or ""
                    presentation["hpi"] = re.sub(r"\s+", " ", text).strip()[:1200]
                    presentation["multicare_case_id"] = source["case_id"]
                    presentation["patient_voice"] = {
                        "chief_complaint": "I don't feel right. Something is wrong.",
                        "history": "It got worse and they brought me in.",
                        "pain": "I hurt and I'm scared.",
                    }

                merged = build_merged_case(answer_key, presentation, top_matches, distractors)
                cases_by_id[case_id] = merged

                if merged["reconstruction_status"] == "full":
                    full += 1
                    progress.setdefault("completed_ids", []).append(case_id)
                else:
                    partial += 1
                    progress.setdefault("partial_ids", []).append(case_id)

            except Exception as exc:
                log(f"  case {case_id}: ERROR {exc}")
                progress.setdefault("failed_ids", []).append(case_id)
                failed += 1

        progress["last_batch"] = batch_num
        save_progress(progress)
        save_json(CASES_FILE, {"cases": [cases_by_id[i] for i in sorted(cases_by_id.keys())]})
        log(f"Batch {batch_num} saved -> {CASES_FILE}")
        if args.sleep:
            time.sleep(args.sleep)

    print_report(len(keys), full, partial, failed, no_match, progress)
    save_progress(progress)


def print_report(total: int, full: int, partial: int, failed: int, no_match: int, progress: dict) -> None:
    log("\n=== BUILD REPORT ===")
    log(f"Total attempted: {total}")
    log(f"Fully reconstructed: {full}")
    log(f"Partially reconstructed: {partial}")
    log(f"Failed: {failed}")
    log(f"No MultiCaRe match: {no_match}")
    manual = sorted(set(
        (progress.get("failed_ids") or [])
        + (progress.get("no_multicare_match_ids") or [])
        + (progress.get("partial_ids") or [])
    ))
    if manual:
        log(f"Cases needing manual review: {', '.join(map(str, manual))}")
    log(f"Progress file: {PROGRESS_FILE}")
    log(f"Output: {CASES_FILE}")


def parse_args():
    parser = argparse.ArgumentParser(description="Build cases.json from screenshots + MultiCaRe")
    parser.add_argument("phase", choices=["answer-keys", "merge", "all"], help="Pipeline phase")
    parser.add_argument("--batch-size", type=int, default=10)
    parser.add_argument("--resume", action="store_true", help="Skip completed cases")
    parser.add_argument("--case-ids", type=str, default="", help="Comma-separated case IDs")
    parser.add_argument("--model", type=str, default="", help="Ollama vision model override")
    parser.add_argument("--skip-claude", action="store_true", help="Skip Anthropic steps (partial merge)")
    parser.add_argument("--bootstrap-from-cases", action="store_true", help="Seed answer_keys.json from existing cases.json")
    parser.add_argument("--sleep", type=float, default=0.0, help="Pause seconds between batches")
    return parser.parse_args()


def main():
    args = parse_args()
    args.case_ids = [int(x.strip()) for x in args.case_ids.split(",") if x.strip()]

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    extract_mod = import_extract_module()

    if args.phase in ("answer-keys", "all"):
        phase_answer_keys(args, extract_mod)
    if args.phase in ("merge", "all"):
        phase_merge(args)


if __name__ == "__main__":
    main()
