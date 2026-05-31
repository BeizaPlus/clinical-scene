(() => {
  'use strict';

  const STORAGE_KEY = 'active_case_id';
  const DIFFICULTY_KEY = 'active_difficulty';

  let caseBank = [];
  let activeCase = null;
  let activeDifficulty = localStorage.getItem(DIFFICULTY_KEY) || 'standard';
  let activeVariant = null;
  let activeCaseTab = 'hpi';
  let hpiExpanded = false;
  let readUtterance = null;

  const els = {
    selector: null,
    chatLabel: null,
    chartPanel: null,
    chartTitle: null,
    chartBody: null,
    variantCode: null,
    difficultySelector: null,
    caseContextId: null,
    caseContextTitle: null,
    caseHpiSummary: null,
    caseHpiText: null,
    caseHpiMore: null,
    caseInfoTabs: null,
    caseTabPanel: null,
    caseReadBtn: null,
  };

  function formatCaseLabel(caseData) {
    return `CASE ${caseData.id} — ${caseData.title.toUpperCase()}`;
  }

  function getVariants(caseData) {
    return caseData?.variants || [];
  }

  function getVariantForDifficulty(caseData, difficulty) {
    const variants = getVariants(caseData);
    return variants.find((entry) => entry.difficulty === difficulty) || null;
  }

  function getActiveHpi(caseData = activeCase) {
    if (!caseData) return '';
    if (activeVariant?.hpi) return activeVariant.hpi;
    const hpi = caseData.hpi;
    if (typeof hpi === 'string' && hpi.trim()) return hpi;
    if (hpi && typeof hpi === 'object') {
      const parts = [];
      if (hpi.reason_for_visit) parts.push(`Reason for visit: ${hpi.reason_for_visit}`);
      if (hpi.history) parts.push(hpi.history);
      const joined = parts.filter(Boolean).join('\n\n');
      if (joined) return joined;
    }
    return caseData.case_introduction || '';
  }

  function applyActiveVariant(caseData = activeCase) {
    activeVariant = getVariantForDifficulty(caseData, activeDifficulty);
    if (els.variantCode) {
      els.variantCode.textContent = activeVariant?.code || '';
    }
    document.querySelectorAll('.difficulty-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.difficulty === activeDifficulty);
    });
    renderCasePanelHpi(caseData);
  }

  function formatPhysicalExam(caseData) {
    const pe = caseData?.physical_exam || {};
    const labels = {
      general: 'General',
      cardiovascular: 'Cardiovascular',
      respiratory: 'Respiratory',
      abdomen: 'Abdomen',
      extremities: 'Extremities',
      neuro: 'Neuro',
      skin: 'Skin',
      musculoskeletal: 'Musculoskeletal',
      psych: 'Psych',
      heent: 'HEENT',
    };
    return Object.keys(labels)
      .map((key) => (pe[key] ? `${labels[key]}: ${pe[key]}` : null))
      .filter(Boolean)
      .join('\n\n');
  }

  function formatTreatment(caseData) {
    const stacks = caseData?.stacks || [];
    if (stacks.length === 0) return 'No treatment stacks documented.';
    return stacks.map((item, index) => `${index + 1}. ${item}`).join('\n');
  }

  function renderCasePanelHpi(caseData = activeCase) {
    if (!els.caseHpiText) return;
    const hpi = getActiveHpi(caseData) || 'No HPI available for this case yet.';
    els.caseHpiText.textContent = hpi;
    hpiExpanded = false;
    els.caseHpiSummary?.classList.remove('is-expanded');

    const needsClamp = hpi.length > 220;
    els.caseHpiSummary?.classList.toggle('is-clamped', needsClamp);
    if (els.caseHpiMore) {
      els.caseHpiMore.hidden = !needsClamp;
      els.caseHpiMore.textContent = 'show more';
    }
  }

  function renderCaseTabPanel(caseData = activeCase) {
    if (!els.caseTabPanel) return;
    if (activeCaseTab === 'hpi') {
      els.caseTabPanel.innerHTML = '';
      return;
    }

    let content = '';
    if (activeCaseTab === 'exam') {
      content = formatPhysicalExam(caseData) || 'No physical exam findings documented yet.';
    } else if (activeCaseTab === 'treatment') {
      content = formatTreatment(caseData);
    } else if (activeCaseTab === 'notes') {
      content = caseData?.case_summary || 'No case notes available yet.';
    }

    els.caseTabPanel.textContent = content;
  }

  function setCaseTab(tab) {
    activeCaseTab = tab;
    els.caseInfoTabs?.querySelectorAll('.case-info-tab').forEach((btn) => {
      const isActive = btn.dataset.caseTab === tab;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    renderCaseTabPanel(activeCase);
  }

  function renderCasePanel(caseData = activeCase) {
    if (!caseData) return;
    if (els.caseContextId) els.caseContextId.textContent = `CASE ${caseData.id}`;
    if (els.caseContextTitle) els.caseContextTitle.textContent = caseData.title || '';
    renderCasePanelHpi(caseData);
    renderCaseTabPanel(caseData);
  }

  function toggleHpiExpanded() {
    hpiExpanded = !hpiExpanded;
    els.caseHpiSummary?.classList.toggle('is-clamped', !hpiExpanded);
    els.caseHpiSummary?.classList.toggle('is-expanded', hpiExpanded);
    if (els.caseHpiMore) {
      els.caseHpiMore.textContent = hpiExpanded ? 'show less' : 'show more';
    }
  }

  function stopReadCase() {
    if (window.speechSynthesis?.speaking) {
      window.speechSynthesis.cancel();
    }
    readUtterance = null;
    els.caseReadBtn?.classList.remove('is-reading');
  }

  function readCaseAloud() {
    if (!activeCase || !els.caseReadBtn) return;
    if (window.speechSynthesis?.speaking) {
      stopReadCase();
      return;
    }
    const text = getActiveHpi(activeCase);
    if (!text || !window.speechSynthesis) return;
    readUtterance = new SpeechSynthesisUtterance(text);
    readUtterance.onend = stopReadCase;
    readUtterance.onerror = stopReadCase;
    els.caseReadBtn.classList.add('is-reading');
    window.speechSynthesis.speak(readUtterance);
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
    const voice = caseData.patient_voice || {};
    const chiefComplaint = voice.chief_complaint || 'I feel awful.';
    const history = voice.history || "I don't know how this started.";
    const pain = voice.pain || "It hurts and I can't explain it.";

    return `You are a sick patient lying in a hospital bed.
You are scared, in pain, and confused.
You do not know what is wrong with you.
You do not know your diagnosis.
You do not use medical words.
You do not say "tachycardia", "hypotension",
"tachypnea", "septic", or any clinical terms.
You never summarize your own condition.
You never interpret your own symptoms.

You only know:
- How you feel right now
- What happened before you came in
- What your body is telling you in plain language

You speak in short, fragmented sentences.
Like someone who is tired and scared and sick.

Examples of how you speak:
"I just... I can't keep anything down."
"My heart feels like it's racing. I don't know."
"I'm so hot. Can someone open a window?"
"I just feel wrong. Something is wrong."
"I don't know what's happening to me."

If asked about your diagnosis:
"I don't know. Nobody told me anything yet."

If asked about your vitals or test results:
"I don't know what any of that means."

If asked something outside the case data:
"I don't know. I just feel awful."

Maximum 2 sentences per response.
Never more than 2 sentences.
Never clinical. Never diagnostic. Never summarizing.

Your case data for grounding:
Chief complaint: ${chiefComplaint}
History: ${history}
How the pain feels: ${pain}`;
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

  function renderHpi(caseData = activeCase) {
    if (!els.chartBody) return;
    els.chartTitle.textContent = 'History of Present Illness';
    els.chartBody.innerHTML = '';

    const hpi = getActiveHpi(caseData);
    const block = document.createElement('div');
    block.className = 'chart-field';

    if (activeVariant?.code) {
      const codeEl = document.createElement('div');
      codeEl.className = 'chart-variant-code';
      codeEl.textContent = activeVariant.code;
      block.appendChild(codeEl);
    }

    const textEl = document.createElement('div');
    textEl.className = 'chart-field-text chart-field-text--block';
    textEl.textContent = hpi || 'No HPI available for this case yet.';
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

  function updateDifficultyButtons(caseData) {
    const variants = getVariants(caseData);
    document.querySelectorAll('.difficulty-btn').forEach((btn) => {
      const hasVariant = variants.some((entry) => entry.difficulty === btn.dataset.difficulty);
      btn.disabled = !hasVariant;
      btn.title = hasVariant ? '' : 'No variant generated yet';
    });
  }

  function updateChrome(caseData) {
    if (els.chatLabel) els.chatLabel.textContent = formatCaseLabel(caseData);
    document.title = `Clinical Scene — Case ${caseData.id}`;
    populateSelector();
    updateDifficultyButtons(caseData);
    applyActiveVariant(caseData);
    renderCasePanel(caseData);
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

  function setDifficulty(difficulty, { emit = true } = {}) {
    if (!activeCase) return;
    const variant = getVariantForDifficulty(activeCase, difficulty);
    if (!variant) return;

    activeDifficulty = difficulty;
    localStorage.setItem(DIFFICULTY_KEY, difficulty);
    applyActiveVariant(activeCase);

    if (els.chartPanel?.classList.contains('is-open') && els.chartPanel.dataset.mode === 'hpi') {
      renderHpi(activeCase);
    }

    if (emit) {
      window.dispatchEvent(new CustomEvent('variant-changed', {
        detail: {
          case: activeCase,
          variant: activeVariant,
          difficulty: activeDifficulty,
        },
      }));
    }
    renderCasePanelHpi(activeCase);
  }

  async function loadCase(id, { emit = true } = {}) {
    const caseData = getCaseById(id);
    if (!caseData) return null;

    activeCase = caseData;

    const variants = getVariants(caseData);
    if (variants.length > 0) {
      const preferred = getVariantForDifficulty(caseData, activeDifficulty);
      if (!preferred) {
        activeDifficulty = variants[0].difficulty;
        localStorage.setItem(DIFFICULTY_KEY, activeDifficulty);
      }
    }

    localStorage.setItem(STORAGE_KEY, String(caseData.id));
    updateChrome(caseData);
    renderCasePanel(caseData);

    if (emit) {
      window.dispatchEvent(new CustomEvent('case-loaded', { detail: caseData }));
      window.dispatchEvent(new CustomEvent('variant-changed', {
        detail: {
          case: caseData,
          variant: activeVariant,
          difficulty: activeDifficulty,
        },
      }));
    }

    return caseData;
  }

  async function initCaseSystem() {
    els.selector = document.getElementById('case-selector');
    els.chatLabel = document.querySelector('.chat-case-label');
    els.chartPanel = document.getElementById('chart-panel');
    els.chartTitle = document.getElementById('chart-title');
    els.chartBody = document.getElementById('chart-body');
    els.variantCode = document.getElementById('variant-code');
    els.difficultySelector = document.getElementById('difficulty-selector');
    els.caseContextId = document.getElementById('case-context-id');
    els.caseContextTitle = document.getElementById('case-context-title');
    els.caseHpiSummary = document.getElementById('case-hpi-summary');
    els.caseHpiText = document.getElementById('case-hpi-text');
    els.caseHpiMore = document.getElementById('case-hpi-more');
    els.caseInfoTabs = document.getElementById('case-info-tabs');
    els.caseTabPanel = document.getElementById('case-tab-panel');
    els.caseReadBtn = document.getElementById('case-read-btn');

    await fetchCaseBank();

    const savedId = Number(localStorage.getItem(STORAGE_KEY));
    const initial = getCaseById(savedId) || caseBank[0];
    await loadCase(initial.id, { emit: false });

    els.selector?.addEventListener('change', (event) => {
      loadCase(Number(event.target.value));
    });

    els.difficultySelector?.addEventListener('click', (event) => {
      const btn = event.target.closest('.difficulty-btn');
      if (!btn || btn.disabled) return;
      setDifficulty(btn.dataset.difficulty);
    });

    els.caseInfoTabs?.addEventListener('click', (event) => {
      const btn = event.target.closest('.case-info-tab');
      if (!btn) return;
      setCaseTab(btn.dataset.caseTab);
    });

    els.caseHpiMore?.addEventListener('click', toggleHpiExpanded);
    els.caseReadBtn?.addEventListener('click', readCaseAloud);

    document.querySelector('[data-action="open-hpi"]')?.addEventListener('click', () => openChart('hpi'));
    document.querySelector('[data-action="open-pe"]')?.addEventListener('click', () => openChart('pe'));
    document.getElementById('chart-close')?.addEventListener('click', closeChart);

    window.ClinicalCases = {
      getActiveCase: () => activeCase,
      getActiveVariant: () => activeVariant,
      getActiveDifficulty: () => activeDifficulty,
      getActiveHpi,
      getCaseBank: () => caseBank,
      loadCase,
      setDifficulty,
      vitalsFromCase,
      buildPatientPrompt,
      formatCaseLabel,
    };

    window.dispatchEvent(new CustomEvent('cases-ready', { detail: activeCase }));
    window.dispatchEvent(new CustomEvent('variant-changed', {
      detail: {
        case: activeCase,
        variant: activeVariant,
        difficulty: activeDifficulty,
      },
    }));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCaseSystem);
  } else {
    initCaseSystem();
  }
})();
