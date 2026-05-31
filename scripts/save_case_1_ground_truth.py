#!/usr/bin/env python3
"""Insert verbatim Case 1 ground truth into cases.json."""

from __future__ import annotations

import json
from pathlib import Path

CASES_FILE = Path(r"C:\Users\steve\Downloads\clinical-scene\data\cases.json")

CASE_1 = {
    "id": 1,
    "title": "Chest Pain",
    "specialty": "Emergency Medicine",
    "diagnosis": "Tension Pneumothorax",
    "setting": "Emergency Department",
    "timing": "Day 1 @ 16:00",
    "max_real_time_minutes": 8,
    "case_introduction": "A 65-year-old white man is brought in to the emergency department because of sharp chest pain and difficulty breathing. At bedside, he currently is in acute distress, and is moaning and holding his hands over the right side of his chest",
    "hpi": {
        "reason_for_visit": "Chest pain; respiratory distress",
        "history": "The patient, a 65-year-old accountant, is brought to the emergency department by ambulance from the trucking company, where he works. Ten minutes prior to the ambulance's arrival, the patient developed excruciating, sharp pain on the right side of his chest accompanied by marked respiratory distress. He rates the pain as an 8 on a 10-point scale. The pain increases on respiration, and he is unable to answer questions. A coworker who accompanied the patient to the hospital says that this has never happened to the patient in the past. Coworker mentions patient has a past medical history of emphysema and asthma. Oxygen was administered during transport.",
    },
    "physical_exam": {
        "general": "Well-developed, overweight. He appears in marked respiratory distress. He is moaning and holding his hands over the right side of chest.",
        "skin": "Pale, cool, and diaphoretic. Normal turgor. No lesions. Hair normal.",
        "breast": "Normal.",
        "lymph_nodes": "No abnormal lymph nodes.",
        "heent_neck": "Normocephalic. Eyes, ears, nose, and mouth normal. Neck supple; slight tracheal deviation to the left; no masses or bruits; thyroid normal.",
        "chest_lungs": "Chest wall normal. Hyperresonance to percussion on right; no breath sounds. Breath sounds present on the left.",
        "cardiovascular": "Tachycardia; heart sounds faint. No murmurs, rubs, gallops, or extra sounds. Bilateral central and peripheral pulses weak but equal. No jugular venous distention.",
        "abdomen": "Bowel sounds normal; no bruits. No masses or tenderness. Liver and spleen not palpable. No hernias.",
        "genital": "Normal circumcised penis; normal scrotum; testes without masses. No inguinal hernia.",
        "rectal": "Sphincter tone normal. No masses or abnormalities. Prostate normal. Stool brown; no occult blood.",
        "extremities_spine": "Extremities symmetric without deformity, cyanosis, or clubbing. No edema. Bilateral peripheral pulses weak but equal. No joint deformity or warmth; full range of motion. Spine examination normal.",
        "neuro_psych": "Unable to answer questions due to respiratory distress. Deep tendon reflexes normal. Moves all extremities.",
    },
    "vitals": {
        "spo2": 92,
        "spo2_normal_range": "94-100",
        "spo2_flag": "abnormal",
    },
    "patient_updates": [
        {"time": "Day 1 @ 16:35", "update": "The patient is having severe chest pain."},
        {"time": "Day 1 @ 16:55", "update": "The patient is restless and agitated."},
    ],
    "lab_results": {
        "cbc": {
            "time_ordered": "Day 1 @ 16:15",
            "time_reported": "Day 1 @ 16:45",
            "leukocyte_count": "8500 mm3 (nl=3500-10500)",
            "erythrocyte_count": "3.9 million/mm3 (nl=3.5-5.5)",
            "hemoglobin": "15.0 g/dL (nl=12.0-16.0)",
            "hematocrit": "45% (nl=36-46)",
            "platelet_count": "300000 /mm3 (nl=150000-400000)",
            "mcv": "88 cc micron (nl=80-100)",
            "mch": "30 pg/RBC (nl=27-31)",
            "mchc": "35.1 g Hb/dL (nl=31.0-36.0)",
            "rdw": "12.1% (nl=11.5-13.6)",
            "differential": {
                "segmented_neutrophils": "56% (42-81)",
                "band_neutrophils": "4% (0-5)",
                "lymphocytes": "32% (10-47)",
                "monocytes": "5% (0-10)",
                "eosinophils": "2% (0-8)",
                "basophils": "1% (0-2)",
            },
            "peripheral_smear": "Normochromic-normocytic erythrocytes; leukocytes and platelets normal in number and morphology.",
        },
        "bmp": {
            "time_ordered": "Day 1 @ 16:15",
            "time_reported": "Day 1 @ 16:45",
            "creatinine_ranges": {
                "normal": "Cr <= 1.2 (eGFR >= 90)",
                "mild": "1.2 < Cr <= 1.5 (eGFR 60-89)",
                "moderate": "1.5 < Cr <= 3.0 (eGFR 30-59)",
                "severe": "3.0 < Cr <= 5.0 (eGFR 15-29)",
                "failure": "Cr > 5.0 (eGFT < 15)",
            },
            "note": "eGFR ranges based on a 45-year-old man",
        },
        "urinalysis": {
            "time_ordered": "Day 1 @ 16:15",
            "time_reported": "Day 1 @ 16:45",
            "appearance": "Clear, light yellow",
            "ph": "6.0 pH Unit (nl=4.6-8.0)",
            "specific_gravity": "1.015 (nl=1.003-1.030)",
            "ketones": "Negative",
            "bilirubin": "Negative",
            "blood": "Negative",
            "nitrate": "Negative",
            "leukocyte_esterase": "Negative",
            "glucose": "Negative",
            "protein": "Negative",
        },
        "ecg": {
            "time": "Day 1 @ 16:35",
            "rhythm": "Regular sinus tachycardia, rate 120 bpm",
            "axis": "+30 degree",
            "p_waves": "Normal morphology, upright in I and II",
            "qrs": "Normal",
            "st_t_waves": "Normal",
            "other": "None",
            "interpretation": "Sinus tachycardia",
        },
        "chest_xray": {
            "time": "Day 1 @ 16:45",
            "findings": "Radiology shows a complete collapse of the right lung. The cardiomediastinal contents are shifted to the left. The left lung is normal. No pulmonary or pleural lesion or mediastinal lymphadenopathy. Vascular structures are normal.",
            "impression": "Right tension pneumothorax",
        },
    },
    "orders_placed_by_student": [
        "CBC with differential",
        "Basic metabolic profile",
        "X-ray, chest, PA/lateral",
        "Urinalysis",
        "Spirometry",
        "Spirometry, incentive",
        "Serology, Lyme disease",
        "Glucose, oral",
        "Nitroglycerin, sublingual",
        "Electrocardiography, 12 lead",
        "Aspirin, therapy",
        "Duplex ultrasonography, lower extremities, venous",
        "Intubation, endotracheal",
        "Mechanical ventilation",
        "Needle thoracostomy",
    ],
    "procedure_responses": {
        "intubation_endotracheal": "After discussion of potential benefits and risks with the patient, appropriate family members, or guardian, the procedure is declined at this time.",
        "needle_thoracostomy": "selected from order verification list",
    },
    "answer_key": {
        "diagnosis_orders_score": "87.5%",
        "treatment_orders_score": "100%",
        "timing_score": "0%",
        "appropriate_orders_score": "0%",
        "location_sequence_score": "50%",
        "your_score": 68.75,
        "average_first_attempt": 74.3,
        "correctly_ordered": [
            {
                "order": "Physical Exam: General Appearance",
                "rationale": "It is always important to see how the patient looks in general to assess how sick the patient is",
            },
            {
                "order": "Physical Exam: Chest / Lungs",
                "rationale": "Important to evaluate chest/lungs in a patient with respiratory distress",
            },
            {
                "order": "Physical Exam: Heart / Cardiovascular",
                "rationale": "Evaluation of the cardiovascular system can give you a lot of information in a patient with respiratory distress. As this is an emergency, only selected portions of the physical exam should be performed",
            },
            {
                "order": "Physical Exam: Extremities / Spine",
                "rationale": "Patient has symptoms that could be the result of a pulmonary embolism. It is important to evaluate extremities to determine whether patient demonstrates symptoms of DVT",
            },
            {
                "order": "X-ray, chest, left lateral decubitus / X-ray, chest, right lateral decubitus / X-ray, chest, PA / X-ray, chest, PA/lateral / X-ray, chest, AP portable",
                "rationale": "Radiological study must be used to verify correct placement of the chest tube. Tension pneumothorax should be diagnosed by a physical exam. A thoracentesis and a chest tube should be placed after this diagnosis is made. Then a chest x-ray should be ordered to verify the chest tube placement. You should not make the diagnosis by chest x-ray or other imaging; if a chest x-ray is done first and then a chest tube is placed, you will lose points",
            },
            {
                "order": "Pulse oximetry",
                "rationale": "The patient appears to be in respiratory distress, so it's important to check a pulse oximetry",
            },
            {
                "order": "Electrocardiography, 12 lead",
                "rationale": "An initial EKG should be taken to rule out a myocardial infarction",
            },
        ],
        "should_have_ordered": [
            {
                "order": "Cardiac Troponin I serum / Cardiac enzymes, serum",
                "rationale": "Initial troponins should be evaluated as patient is experiencing chest pain, and a myocardial infarction should be ruled out",
            },
        ],
        "treatment_correctly_ordered": [
            {
                "order": "Tube thoracostomy / Needle thoracostomy",
                "rationale": "A chest tube should be done soon after a needle thoracostomy is performed and placed to suction",
            },
        ],
        "treatment_optional": [
            {
                "order": "Thoracentesis",
                "rationale": "This would be a good diagnostic step to determine a tension pneumothorax. However, once this is done a chest tube must be placed to prevent the pneumothorax from reoccurring",
                "affects_grade": False,
            },
        ],
        "inappropriate_orders": [
            {
                "order": "Intubation, endotracheal",
                "time": "Day 1 @ 16:27 AM Actual / Day 1 @ 04:40 PM Virtual",
                "reason": "This was considered invasive for this case",
            },
            {
                "order": "Mechanical ventilation",
                "time": "Day 1 @ 11:10:29 AM Actual / Day 1 @ 04:40 PM Virtual",
                "reason": "This was considered invasive for this case",
            },
            {
                "order": "Thoracostomy",
                "time": "Day 1 @ 11:10:31 AM Actual / Day 1 @ 04:45 PM Virtual",
                "reason": "This was considered invasive for this case",
            },
        ],
        "location_sequence_notes": [
            "Correct location @ Day 0 00:20",
            "Correct location @ Day 0 00:40",
            "Correct location @ Day 0 00:55",
            "Correct location @ Day 0 01:10",
            "Ordered imaging before treatment — diagnosis made through physical exam; chest tube should be placed before radiological study",
        ],
        "case_summary": "Differential: Aortic dissection, Tension pneumothorax, Asthma exacerbation, Pneumothorax, Pulmonary embolism, Angina. The patient has a tension pneumothorax. This is a medical emergency. No time should be wasted in this case. The tension pneumothorax should be diagnosed through the physical exam and not through radiology. A thoracentesis is a good diagnostic procedure to confirm your physical exam findings of a tension pneumothorax. This is a short term fix and a chest tube must be placed. After a chest tube is placed, it is important to get an X-ray to confirm the correct placement of the chest tube. After the chest tube is in place and the placement is confirmed, the patient should be transferred to the ward for monitoring.",
        "average_orders": {
            "your_count": 17,
            "all_users_average_first_attempt": 15.34,
            "average_users_scoring_35_plus": 15.34,
            "your_z_score": -0.87,
        },
    },
    "patient_voice": {
        "chief_complaint": "Something snapped in my chest. I can't breathe. It's getting worse.",
        "history": "I was just at work. It came out of nowhere. Sharp. Right here.",
        "pain": "Like something is tearing inside. Every breath makes it worse.",
    },
    "distractors": [],
    "source": {
        "screenshots": "case_1/",
        "multicare_case_ids": [],
        "derived_fields": [],
    },
}


def main() -> None:
    payload = json.loads(CASES_FILE.read_text(encoding="utf-8"))
    cases = payload.get("cases", [])
    replaced = False
    for i, case in enumerate(cases):
        if case.get("id") == 1:
            cases[i] = CASE_1
            replaced = True
            break
    if not replaced:
        cases.insert(0, CASE_1)
    cases.sort(key=lambda c: c["id"])
    payload["cases"] = cases
    CASES_FILE.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Saved Case 1 ground truth -> {CASES_FILE}")
    print(f"  title: {CASE_1['title']}")
    print(f"  diagnosis: {CASE_1['diagnosis']}")
    print(f"  top-level fields: {len(CASE_1)}")
    print(f"  answer_key fields: {len(CASE_1['answer_key'])}")
    print(f"  total cases in file: {len(cases)}")


if __name__ == "__main__":
    main()
