#!/usr/bin/env python3
import base64
import json
from pathlib import Path

import ollama

path = Path(r"C:\Users\steve\Step 3\ccs_screenshots\case_145_Facial_Pain.png")
image_data = base64.b64encode(path.read_bytes()).decode()
prompt = """Extract all clinical data from this CCS review page. Return JSON only. No other text.
Fields required:
{
  "diagnosis": "",
  "your_score": 0,
  "average_score": 0,
  "correctly_ordered": [{"order": "", "rationale": ""}],
  "should_have_ordered": [{"order": "", "rationale": ""}],
  "correctly_avoided": [{"order": "", "rationale": ""}],
  "inappropriate_orders": [{"order": "", "reason": ""}],
  "case_summary": ""
}"""
response = ollama.chat(
    model="llava",
    messages=[{"role": "user", "content": prompt, "images": [image_data]}],
)
raw = response["message"]["content"]
print("RAW LENGTH:", len(raw))
print(raw[:2000])
