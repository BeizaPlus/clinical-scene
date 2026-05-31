(() => {
  'use strict';

  const STORAGE_KEY = 'active_case_id';

  let caseBank = [];
  let activeCase = null;

  const els = {
    selector: null,
    chatLabel: null,
    chartPanel: null,
    chartTitle: null,
    chartBody: null,
  };

  function formatCaseLabel(caseData) {
    return `CASE ${caseData.id} — ${caseData.title.toUpperCase()}`;
  }

  function vitalsFromCase(caseData) {
    const v = caseData.vitals;
    return {
      hr: v.hr,
      spo2: v.spo2,
      sbp: v.bp_systolic,
      dbp: v.bp_diastolic,
      rr: v.rr,
      temp: v.temp,
      lactate: v.lactate,
    };
  }

  function buildPatientPrompt(caseData) {
    return `You are the patient in this clinical case. Speak in first person only.

Voice rules:
- You only know what is in the case file below. Never invent facts.
- You are scared, in pain, and confused — not clinical.
- Do not use medical terminology.
- Say things like "my head is killing me" not "headache rated 8/10".
- If asked something outside the case file, say: "I don't know... I just feel awful."
- Short answers. Fragmented. Like a sick person talks.
- Maximum 2 sentences per response.

CASE FILE:
${JSON.stringify(
      {
        title: caseData.title,
        diagnosis: caseData.diagnosis,
        hpi: caseData.hpi,
        physical_exam: caseData.physical_exam,
        patient_voice: caseData.patient_voice,
      },
      null,
      2
    )}`;
  }

  function renderPhysicalExam(caseData) {
    if (!els.chartBody) return;
    const pe = caseData.physical_exam;
    const labels = {
      general: 'General',
      cardiovascular: 'Cardiovascular',
      respiratory: 'Respiratory',
      abdomen: 'Abdomen',
      extremities: 'Extremities',
      neuro: 'Neuro',
      skin: 'Skin',
    };

    els.chartTitle.textContent = 'Physical Exam';
    els.chartBody.innerHTML = '';

    Object.keys(labels).forEach((key) => {
      const text = pe[key];
      if (!text) return;
      const block = document.createElement('div');
      block.className = 'chart-field';
      const labelEl = document.createElement('div');
      labelEl.className = 'chart-field-label';
      labelEl.textContent = labels[key];
      const textEl = document.createElement('div');
      textEl.className = 'chart-field-text';
      textEl.textContent = text;
      block.append(labelEl, textEl);
      els.chartBody.appendChild(block);
    });
  }

  function renderHpi(caseData) {
    if (!els.chartBody) return;
    els.chartTitle.textContent = 'History of Present Illness';
    els.chartBody.innerHTML = '';
    const block = document.createElement('div');
    block.className = 'chart-field';
    const textEl = document.createElement('div');
    textEl.className = 'chart-field-text chart-field-text--block';
    textEl.textContent = caseData.hpi;
    block.appendChild(textEl);
    els.chartBody.appendChild(block);
  }

  function openChart(mode) {
    if (!activeCase || !els.chartPanel) return;
    els.chartPanel.classList.add('is-open');
    els.chartPanel.dataset.mode = mode;
    if (mode === 'hpi') renderHpi(activeCase);
    else renderPhysicalExam(activeCase);
  }

  function closeChart() {
    els.chartPanel?.classList.remove('is-open');
  }

  function populateSelector() {
    if (!els.selector) return;
    els.selector.innerHTML = '';
    caseBank.forEach((caseData) => {
      const option = document.createElement('option');
      option.value = String(caseData.id);
      option.textContent = formatCaseLabel(caseData);
      els.selector.appendChild(option);
    });
    if (activeCase) els.selector.value = String(activeCase.id);
  }

  function updateChrome(caseData) {
    if (els.chatLabel) els.chatLabel.textContent = formatCaseLabel(caseData);
    document.title = `Clinical Scene — Case ${caseData.id}`;
    populateSelector();
  }

  async function fetchCaseBank() {
    const response = await fetch('data/cases.json');
    if (!response.ok) throw new Error('Could not load cases.json');
    const data = await response.json();
    caseBank = data.cases || [];
    if (caseBank.length === 0) throw new Error('cases.json is empty');
  }

  function getCaseById(id) {
    return caseBank.find((entry) => entry.id === Number(id));
  }

  async function loadCase(id, { emit = true } = {}) {
    const caseData = getCaseById(id);
    if (!caseData) return null;

    activeCase = caseData;
    localStorage.setItem(STORAGE_KEY, String(caseData.id));
    updateChrome(caseData);

    if (emit) {
      window.dispatchEvent(new CustomEvent('case-loaded', { detail: caseData }));
    }

    return caseData;
  }

  async function initCaseSystem() {
    els.selector = document.getElementById('case-selector');
    els.chatLabel = document.querySelector('.chat-case-label');
    els.chartPanel = document.getElementById('chart-panel');
    els.chartTitle = document.getElementById('chart-title');
    els.chartBody = document.getElementById('chart-body');

    await fetchCaseBank();

    const savedId = Number(localStorage.getItem(STORAGE_KEY));
    const initial = getCaseById(savedId) || caseBank[0];
    await loadCase(initial.id, { emit: false });

    els.selector?.addEventListener('change', (event) => {
      loadCase(Number(event.target.value));
    });

    document.querySelector('[data-action="open-hpi"]')?.addEventListener('click', () => openChart('hpi'));
    document.querySelector('[data-action="open-pe"]')?.addEventListener('click', () => openChart('pe'));
    document.getElementById('chart-close')?.addEventListener('click', closeChart);

    window.ClinicalCases = {
      getActiveCase: () => activeCase,
      getCaseBank: () => caseBank,
      loadCase,
      vitalsFromCase,
      buildPatientPrompt,
      formatCaseLabel,
    };

    window.dispatchEvent(new CustomEvent('cases-ready', { detail: activeCase }));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCaseSystem);
  } else {
    initCaseSystem();
  }
})();
