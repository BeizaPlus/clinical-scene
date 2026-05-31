#!/usr/bin/env python3
"""Generate HPI variants for clinical-scene cases using MultiCaRe + Anthropic."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

CASES_FILE = Path(r"C:\Users\steve\Downloads\clinical-scene\data\cases.json")
MULTICARE_DIR = Path(r"C:\Users\steve\Step 3\MultiCaRe\medical_datasets")
MODEL = "claude-sonnet-4-20250514"

DIFFICULTY_CONFIG = [
    ("A", "standard", "S"),
    ("B", "challenging", "C"),
    ("C", "expert", "E"),
]

SYSTEM_PROMPT = """You are generating clinical education case variants.
You will be given:
1. A confirmed diagnosis
2. Exact physical exam findings (do not change these)
3. Exact vitals (do not change these)
4. Real de-identified patient narratives for grounding

Generate a fresh HPI for a new fictional patient with the same diagnosis. Rules:
- Different age, gender, social context each time
- Grounded in the real patient narratives provided
- Medically accurate — symptoms must match the diagnosis
- Written as objective clinical HPI, third person
- 3-4 sentences maximum
- Include one subtle complicating factor or red herring
- Never invent physical exam findings
- Never invent vitals

Return ONLY valid JSON with this shape:
{
  "hpi": "string",
  "complicating_factor": "string or null",
  "atypical_element": "string or null"
}"""


def require_api_key() -> str:
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not key:
        print("ERROR: ANTHROPIC_API_KEY environment variable is not set.")
        print("Set it before running, for example:")
        print('  $env:ANTHROPIC_API_KEY = "your-key-here"')
        sys.exit(1)
    return key


def load_cases() -> tuple[dict, list[dict]]:
    payload = json.loads(CASES_FILE.read_text(encoding="utf-8"))
    return payload, payload["cases"]


def save_cases(payload: dict) -> None:
    CASES_FILE.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def diagnosis_terms(diagnosis: str | None, title: str | None) -> list[str]:
    source = diagnosis or title or ""
    parts = re.findall(r"[A-Za-z]{4,}", source)
    stop = {"with", "from", "type", "syndrome", "disease", "acute", "chronic"}
    terms = [p.lower() for p in parts if p.lower() not in stop]
    if not terms and title:
        terms = [w.lower() for w in re.findall(r"[A-Za-z]{4,}", title)]
    return terms[:4] or ["clinical"]


def init_multicare():
    from multiversity.multicare_dataset import MedicalDatasetCreator

    MULTICARE_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Initializing MultiCaRe from {MULTICARE_DIR} ...")
    return MedicalDatasetCreator(directory=str(MULTICARE_DIR))


def search_multicare(mdc, diagnosis: str | None, title: str | None, limit: int = 5) -> list[dict]:
    terms = diagnosis_terms(diagnosis, title)
    print(f"  MultiCaRe search terms: {terms}")

    scored: list[tuple[int, dict]] = []
    seen_ids: set[str] = set()

    for case_list in mdc.full_cases["cases"]:
        for case in case_list:
            text = case.get("case_text") or ""
            lower = text.lower()
            score = sum(1 for term in terms if term in lower)
            if score == 0:
                continue
            if len(terms) >= 2 and score < 2 and diagnosis:
                continue

            case_id = case.get("case_id") or ""
            if case_id in seen_ids:
                continue
            seen_ids.add(case_id)

            snippet = re.sub(r"\s+", " ", text).strip()
            if len(snippet) > 700:
                snippet = snippet[:700] + "..."

            scored.append((score, {
                "case_id": case_id,
                "age": case.get("age"),
                "gender": case.get("gender"),
                "chief_complaint": _extract_chief_complaint(text),
                "history_details": snippet,
                "complicating_factors": _extract_complicating(text),
            }))

    scored.sort(key=lambda item: item[0], reverse=True)
    matches = [item[1] for item in scored[:limit]]

    if len(matches) < limit:
        print(f"  Warning: only found {len(matches)} MultiCaRe matches for terms {terms}")
    return matches


def _extract_chief_complaint(text: str) -> str:
    patterns = [
        r"presented with ([^.]{10,160}\.)",
        r"complain(?:ed|ing) of ([^.]{10,160}\.)",
        r"chief complaint[^.]{0,40}([^.]{10,160}\.)",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            return match.group(1).strip()
    first = re.split(r"(?<=[.!?])\s+", text.strip())[0]
    return first[:180]


def _extract_complicating(text: str) -> str:
    patterns = [
        r"(history of [^.]{8,120}\.)",
        r"(family history[^.]{8,120}\.)",
        r"(previously [^.]{8,120}\.)",
        r"(complicated by [^.]{8,120}\.)",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            return match.group(1).strip()
    return ""


def build_user_prompt(case: dict, difficulty: str, source_cases: list[dict]) -> str:
    pe = case.get("physical_exam") or {}
    vitals = case.get("vitals") or {}
    pe_lines = {k: v for k, v in pe.items() if v}
    return json.dumps({
        "case_id": case["id"],
        "title": case.get("title"),
        "diagnosis": case.get("diagnosis"),
        "difficulty": difficulty,
        "physical_exam_locked": pe_lines or "Not available — do not invent exam findings.",
        "vitals_locked": vitals or "Not available — do not invent vitals.",
        "source_narratives": source_cases,
        "instructions": {
            "standard": "Typical presentation for this diagnosis.",
            "challenging": "Add one meaningful complicating factor that makes the case harder but still consistent with the diagnosis.",
            "expert": "Use an atypical or misleading history element while keeping the diagnosis correct.",
        }.get(difficulty, ""),
    }, indent=2)


def generate_variant(client, case: dict, difficulty: str, source_cases: list[dict]) -> dict:
    import anthropic

    response = client.messages.create(
        model=MODEL,
        max_tokens=800,
        temperature=0.7,
        system=SYSTEM_PROMPT,
        messages=[{
            "role": "user",
            "content": build_user_prompt(case, difficulty, source_cases),
        }],
    )

    raw = response.content[0].text.strip()
    raw = raw.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    return json.loads(raw)


def make_variant_entry(
    case_id: int,
    letter: str,
    difficulty: str,
    suffix: str,
    generated: dict,
    source_ids: list[str],
) -> dict:
    code = f"CASE-{case_id}-{letter}-{suffix}"
    entry = {
        "code": code,
        "difficulty": difficulty,
        "hpi": generated["hpi"],
        "source_case_ids": source_ids,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    if difficulty == "challenging" and generated.get("complicating_factor"):
        entry["complicating_factor"] = generated["complicating_factor"]
    if difficulty == "expert" and generated.get("atypical_element"):
        entry["atypical_element"] = generated["atypical_element"]
    return entry


def process_case(client, mdc, case: dict) -> list[dict]:
    case_id = case["id"]
    diagnosis = case.get("diagnosis")
    title = case.get("title")

    if not diagnosis and case.get("status") == "no_screenshot":
        print(f"Case {case_id}: skipped — no diagnosis and no screenshot.")
        return []

    print(f"\n=== Case {case_id}: {title} ===")
    print(f"Diagnosis: {diagnosis or '(using title for search)'}")

    source_cases = search_multicare(mdc, diagnosis, title, limit=5)
    source_ids = [item["case_id"] for item in source_cases]

    variants: list[dict] = []
    for letter, difficulty, suffix in DIFFICULTY_CONFIG:
        print(f"  Generating {difficulty} ({letter}) ...")
        generated = generate_variant(client, case, difficulty, source_cases)
        variant = make_variant_entry(case_id, letter, difficulty, suffix, generated, source_ids)
        variants.append(variant)
        print(f"    -> {variant['code']}")
        print(f"    HPI: {variant['hpi'][:160]}...")

    return variants


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate HPI variants for clinical-scene cases")
    parser.add_argument(
        "--case-ids",
        default="1,2,121,140,143",
        help="Comma-separated case IDs to process",
    )
    args = parser.parse_args()

    case_ids = [int(part.strip()) for part in args.case_ids.split(",") if part.strip()]
    api_key = require_api_key()

    import anthropic

    payload, cases = load_cases()
    by_id = {case["id"]: case for case in cases}

    missing = [cid for cid in case_ids if cid not in by_id]
    if missing:
        print(f"ERROR: case IDs not found in cases.json: {missing}")
        sys.exit(1)

    mdc = init_multicare()
    client = anthropic.Anthropic(api_key=api_key)

    print(f"\nProcessing {len(case_ids)} cases: {case_ids}\n")

    for case_id in case_ids:
        case = by_id[case_id]
        try:
            variants = process_case(client, mdc, case)
            if variants:
                case["variants"] = variants
        except Exception as exc:
            print(f"ERROR on case {case_id}: {exc}")

    save_cases(payload)

    print("\n=== VARIANT GENERATION REPORT ===")
    for case_id in case_ids:
        case = by_id[case_id]
        variants = case.get("variants") or []
        print(f"Case {case_id}: {len(variants)} variants")
        for variant in variants:
            print(f"  {variant['code']} [{variant['difficulty']}]")
            print(f"    {variant['hpi']}")
    print(f"\nSaved: {CASES_FILE}")


if __name__ == "__main__":
    main()
