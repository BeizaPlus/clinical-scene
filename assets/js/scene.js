(() => {
  'use strict';

  const TOTAL_ORDERS = 5;
  const TIMER_START_SEC = 5 * 60;
  const DRIFT_MS = 10_000;
  const TREATMENT_PAUSE_MS = 8_000;
  const WIN_ANIM_MS = 5_000;

  const ORDERS = [
    'Supplemental O₂',
    'IV Fluids',
    'Cardiac Monitor',
    'Blood Cultures',
    'Broad-Spectrum Abx',
  ];

  const NORMAL = { hr: 88, spo2: 98, sbp: 118, dbp: 72, rr: 16 };

  const state = {
    phase: 'playing',
    secondsLeft: TIMER_START_SEC,
    driftPausedUntil: 0,
    placedCount: 0,
    vitals: { hr: 98, spo2: 96, sbp: 142, dbp: 88, rr: 18 },
    intervals: { timer: null, drift: null, beep: null },
    dragging: null,
    ghost: null,
    audio: null,
  };

  const els = {
    timer: document.getElementById('timer'),
    videoLayer: document.getElementById('video-layer'),
    idleVideo: document.getElementById('idle'),
    deteriorationVideo: document.getElementById('deterioration'),
    dropZone: document.getElementById('patient-drop'),
    ordersRail: document.getElementById('orders-rail'),
    loseOverlay: document.getElementById('lose-overlay'),
    winOverlay: document.getElementById('win-overlay'),
    loseSubtitle: document.getElementById('lose-subtitle'),
    vitals: {
      hr: document.getElementById('vital-hr'),
      spo2: document.getElementById('vital-spo2'),
      nibp: document.getElementById('vital-nibp'),
      rr: document.getElementById('vital-rr'),
    },
  };

  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function formatTimer(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function flashVital(el) {
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  function vitalClassHr(hr) {
    if (hr > 140) return 'red';
    if (hr > 120) return 'amber';
    return '';
  }

  function vitalClassSpo2(spo2) {
    if (spo2 < 90) return 'red';
    if (spo2 < 94) return 'amber';
    return '';
  }

  function renderVitals() {
    const { hr, spo2, sbp, dbp, rr } = state.vitals;
    els.vitals.hr.textContent = String(Math.round(hr));
    els.vitals.spo2.textContent = `${Math.round(spo2)}%`;
    els.vitals.nibp.textContent = `${Math.round(sbp)}/${Math.round(dbp)}`;
    els.vitals.rr.textContent = String(Math.round(rr));

    els.vitals.hr.className = `vital-value ${vitalClassHr(hr)}`;
    els.vitals.spo2.className = `vital-value ${vitalClassSpo2(spo2)}`;
    els.vitals.nibp.className = 'vital-value';
    els.vitals.rr.className = 'vital-value';
  }

  function updateTimerDisplay() {
    els.timer.textContent = formatTimer(state.secondsLeft);
    els.timer.classList.remove('amber', 'red');
    if (state.secondsLeft <= 60) els.timer.classList.add('red');
    else if (state.secondsLeft <= 120) els.timer.classList.add('amber');
  }

  function clearIntervals() {
    Object.keys(state.intervals).forEach((k) => {
      if (state.intervals[k]) {
        clearInterval(state.intervals[k]);
        state.intervals[k] = null;
      }
    });
  }

  function initAudio() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      state.audio = { ctx, ambient: null, beepGain: null };

      const ambientGain = ctx.createGain();
      ambientGain.gain.value = 0.035;
      ambientGain.connect(ctx.destination);

      const ambientOsc = ctx.createOscillator();
      ambientOsc.type = 'sine';
      ambientOsc.frequency.value = 58;
      const ambientOsc2 = ctx.createOscillator();
      ambientOsc2.type = 'sine';
      ambientOsc2.frequency.value = 116;
      ambientOsc.connect(ambientGain);
      ambientOsc2.connect(ambientGain);
      ambientOsc.start();
      ambientOsc2.start();
      state.audio.ambient = { ambientGain, ambientOsc, ambientOsc2 };

      const beepGain = ctx.createGain();
      beepGain.gain.value = 0;
      beepGain.connect(ctx.destination);
      state.audio.beepGain = beepGain;
    } catch {
      state.audio = null;
    }
  }

  function resumeAudio() {
    state.audio?.ctx?.resume?.();
  }

  function playBeep() {
    if (!state.audio?.ctx || state.phase !== 'playing') return;
    const { ctx, beepGain } = state.audio;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
    osc.connect(g);
    g.connect(beepGain);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  }

  function playFlatline() {
    if (!state.audio?.ctx) return;
    const { ctx } = state.audio;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 440;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.05);
    g.gain.setValueAtTime(0.08, ctx.currentTime + 2.5);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 3.2);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 3.3);
  }

  function scheduleBeep() {
    if (state.intervals.beep) clearInterval(state.intervals.beep);
    if (state.phase !== 'playing') return;
    const intervalMs = clamp(60_000 / state.vitals.hr, 350, 1200);
    playBeep();
    state.intervals.beep = setInterval(playBeep, intervalMs);
  }

  function tickDrift() {
    if (state.phase !== 'playing') return;
    if (Date.now() < state.driftPausedUntil) return;

    const prev = { ...state.vitals };
    state.vitals.hr = clamp(state.vitals.hr + randInt(2, 4), 0, 160);
    state.vitals.spo2 = clamp(state.vitals.spo2 - 1, 82, 100);
    state.vitals.sbp = clamp(state.vitals.sbp + 3, 0, 180);
    state.vitals.rr = clamp(state.vitals.rr + 1, 0, 34);

    renderVitals();
    if (prev.hr !== state.vitals.hr) flashVital(els.vitals.hr);
    if (prev.spo2 !== state.vitals.spo2) flashVital(els.vitals.spo2);
    if (prev.sbp !== state.vitals.sbp || prev.dbp !== state.vitals.dbp) flashVital(els.vitals.nibp);
    if (prev.rr !== state.vitals.rr) flashVital(els.vitals.rr);

    scheduleBeep();
  }

  function tickTimer() {
    if (state.phase !== 'playing') return;
    state.secondsLeft -= 1;
    updateTimerDisplay();
    if (state.secondsLeft <= 0) triggerLose();
  }

  function buildOrders() {
    els.ordersRail.innerHTML = '';
    ORDERS.forEach((label, i) => {
      const el = document.createElement('div');
      el.className = 'order-stack';
      el.textContent = label;
      el.dataset.orderId = String(i);
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.addEventListener('pointerdown', (e) => startDrag(e, el));
      els.ordersRail.appendChild(el);
    });
  }

  function startDrag(e, el) {
    if (state.phase !== 'playing' || el.classList.contains('placed')) return;
    resumeAudio();
    e.preventDefault();
    state.dragging = el;
    el.classList.add('dragging');
    el.setPointerCapture(e.pointerId);

    const ghost = document.createElement('div');
    ghost.className = 'order-ghost';
    ghost.textContent = el.textContent;
    document.body.appendChild(ghost);
    state.ghost = ghost;
    moveGhost(e.clientX, e.clientY);

    el.addEventListener('pointermove', onDragMove);
    el.addEventListener('pointerup', onDragEnd);
    el.addEventListener('pointercancel', onDragEnd);
  }

  function moveGhost(x, y) {
    if (!state.ghost) return;
    state.ghost.style.left = `${x}px`;
    state.ghost.style.top = `${y}px`;
  }

  function onDragMove(e) {
    moveGhost(e.clientX, e.clientY);
    const rect = els.dropZone.getBoundingClientRect();
    const over =
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom;
    els.dropZone.classList.toggle('drag-over', over);
  }

  function onDragEnd(e) {
    const el = state.dragging;
    if (!el) return;

    const rect = els.dropZone.getBoundingClientRect();
    const dropped =
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom;

    el.classList.remove('dragging');
    els.dropZone.classList.remove('drag-over');
    el.removeEventListener('pointermove', onDragMove);
    el.removeEventListener('pointerup', onDragEnd);
    el.removeEventListener('pointercancel', onDragEnd);

    state.ghost?.remove();
    state.ghost = null;
    state.dragging = null;

    if (dropped && !el.classList.contains('placed')) placeOrder(el);
  }

  function placeOrder(el) {
    el.classList.add('placed');
    state.placedCount += 1;
    state.driftPausedUntil = Date.now() + TREATMENT_PAUSE_MS;

    if (state.placedCount >= TOTAL_ORDERS) triggerWin();
  }

  function triggerDeteriorationVideo() {
    els.videoLayer.classList.add('deteriorating');
    els.idleVideo.pause();
    els.deteriorationVideo.currentTime = 0;
    els.deteriorationVideo.play().catch(() => {});
  }

  function triggerLose() {
    if (state.phase !== 'playing') return;
    state.phase = 'lose';
    clearIntervals();
    document.body.classList.add('game-ended');

    triggerDeteriorationVideo();
    playFlatline();

    els.loseSubtitle.textContent = `Orders placed: ${state.placedCount}/${TOTAL_ORDERS}`;
    els.loseOverlay.classList.add('visible');
  }

  function animateVitalsToNormal(durationMs) {
    const start = { ...state.vitals };
    const startTime = performance.now();

    function frame(now) {
      const t = clamp((now - startTime) / durationMs, 0, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      state.vitals.hr = start.hr + (NORMAL.hr - start.hr) * ease;
      state.vitals.spo2 = start.spo2 + (NORMAL.spo2 - start.spo2) * ease;
      state.vitals.sbp = start.sbp + (NORMAL.sbp - start.sbp) * ease;
      state.vitals.dbp = start.dbp + (NORMAL.dbp - start.dbp) * ease;
      renderVitals();
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function triggerWin() {
    if (state.phase !== 'playing') return;
    state.phase = 'win';
    clearIntervals();
    document.body.classList.add('game-ended');
    els.winOverlay.classList.add('visible');
    animateVitalsToNormal(WIN_ANIM_MS);
  }

  function hideOverlays() {
    els.loseOverlay.classList.remove('visible');
    els.winOverlay.classList.remove('visible');
  }

  function resetCase() {
    clearIntervals();
    hideOverlays();
    document.body.classList.remove('game-ended');

    state.phase = 'playing';
    state.secondsLeft = TIMER_START_SEC;
    state.driftPausedUntil = 0;
    state.placedCount = 0;
    state.vitals = { hr: 98, spo2: 96, sbp: 142, dbp: 88, rr: 18 };

    els.videoLayer.classList.remove('deteriorating');
    els.deteriorationVideo.pause();
    els.deteriorationVideo.currentTime = 0;
    els.idleVideo.currentTime = 0;
    els.idleVideo.play().catch(() => {});

    updateTimerDisplay();
    renderVitals();
    buildOrders();

    state.intervals.timer = setInterval(tickTimer, 1000);
    state.intervals.drift = setInterval(tickDrift, DRIFT_MS);
    scheduleBeep();
  }

  function initVideos() {
    els.idleVideo.loop = true;
    els.idleVideo.muted = true;
    els.idleVideo.playsInline = true;
    els.deteriorationVideo.loop = false;
    els.deteriorationVideo.muted = true;
    els.deteriorationVideo.playsInline = true;
    els.idleVideo.play().catch(() => {});
  }

  function wireToolbar() {
    document.querySelectorAll('.toolbar-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'restart') {
          resetCase();
          return;
        }
        btn.classList.toggle('active');
      });
    });

    document.getElementById('btn-try-again')?.addEventListener('click', resetCase);
    document.getElementById('btn-review')?.addEventListener('click', () => {
      els.loseOverlay.classList.remove('visible');
    });
    document.getElementById('btn-win-dismiss')?.addEventListener('click', resetCase);
  }

  function init() {
    initAudio();
    initVideos();
    buildOrders();
    updateTimerDisplay();
    renderVitals();
    wireToolbar();

    document.body.addEventListener('pointerdown', resumeAudio, { once: true });

    state.intervals.timer = setInterval(tickTimer, 1000);
    state.intervals.drift = setInterval(tickDrift, DRIFT_MS);
    scheduleBeep();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
