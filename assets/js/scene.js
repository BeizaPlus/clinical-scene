(() => {
  'use strict';

  let idleVideos = [];
  let DEATH_VIDEO = 'assets/video/death.mp4';
  let ORDERS = [];
  let TOTAL_ORDERS = 0;
  let START_VITALS = { hr: 98, spo2: 96, sbp: 120, dbp: 80, rr: 18, temp: 37, lactate: 1.5 };
  let PATHWAY_LABEL = '';
  let gameStarted = false;

  const IDLE_CROSSFADE_MS = 800;
  const PANEL_MODE_KEY = 'panel_mode';
  const PANEL_POSITION_KEY = 'panel_position';
  const PANEL_DOCKED_WIDTH = 340;
  const PANEL_MIN_WIDTH = 280;
  const PANEL_MAX_WIDTH = 600;
  const PANEL_MIN_HEIGHT = 300;
  const PANEL_HEADER_HEIGHT = 40;
  const NORMAL = { hr: 88, spo2: 98, sbp: 118, dbp: 72, rr: 16, temp: 37, lactate: 1.2 };
  const TIMER_START_SEC = 5 * 60;
  const DRIFT_MS = 10_000;
  const TREATMENT_PAUSE_MS = 8_000;
  const WIN_ANIM_MS = 5_000;

  const state = {
    phase: 'playing',
    secondsLeft: TIMER_START_SEC,
    driftPausedUntil: 0,
    placedCount: 0,
    vitals: { ...START_VITALS },
    intervals: { timer: null, drift: null, beep: null },
    dragging: null,
    ghost: null,
    touchDrag: null,
    audio: null,
  };

  const els = {
    timer: document.getElementById('timer'),
    videoLayer: document.getElementById('video-layer'),
    activeSlot: document.getElementById('active'),
    nextSlot: document.getElementById('next'),
    deathVideo: document.getElementById('death'),
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
    monitor: {
      hr: document.getElementById('mon-hr'),
      spo2: document.getElementById('mon-spo2'),
      nibp: document.getElementById('mon-nibp'),
      rr: document.getElementById('mon-rr'),
      temp: document.getElementById('mon-temp'),
      map: document.getElementById('mon-map'),
      lactate: document.getElementById('mon-lactate'),
      orders: document.getElementById('monitor-orders'),
      pathway: document.getElementById('monitor-pathway'),
      status: document.getElementById('monitor-status'),
    },
    patientLifeFill: document.getElementById('patient-life-fill'),
    casePanel: document.getElementById('case-panel'),
    casePanelHeader: document.getElementById('case-panel-header'),
    casePanelRefresh: document.getElementById('case-panel-refresh'),
    casePanelDock: document.getElementById('case-panel-dock'),
    casePanelFloat: document.getElementById('case-panel-float'),
    casePanelCollapse: document.getElementById('case-panel-collapse'),
    casePanelHide: document.getElementById('case-panel-hide'),
    casePanelResize: document.getElementById('case-panel-resize'),
    casePanelReveal: document.getElementById('case-panel-reveal'),
  };

  const panelState = {
    mode: 'docked',
    layout: 'docked',
    lastVisibleMode: 'docked',
    x: 0,
    y: 80,
    width: PANEL_DOCKED_WIDTH,
    height: Math.max(PANEL_MIN_HEIGHT, window.innerHeight - 100),
    drag: null,
    resize: null,
  };

  let frontSlot = els.activeSlot;
  let backSlot = els.nextSlot;
  let lastIdleSrc = '';
  let idleSwapping = false;
  let deathTriggered = false;
  let audioUnlocked = false;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

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

  function applyCaseData(caseData) {
    idleVideos = (caseData.videos?.idle || []).map((file) => `assets/video/${file}`);
    if (idleVideos.length === 0) {
      idleVideos = ['assets/video/breathing_01.mp4', 'assets/video/breathing_02.mp4'];
    }
    DEATH_VIDEO = `assets/video/${caseData.videos?.death || 'death.mp4'}`;
    ORDERS = [...(caseData.stacks || [])];
    TOTAL_ORDERS = ORDERS.length;
    START_VITALS = window.ClinicalCases.vitalsFromCase(caseData);
    PATHWAY_LABEL = caseData.specialty || '';
    resetCase(true);
  }

  function pickIdle(exclude) {
    const pool = exclude ? idleVideos.filter((src) => src !== exclude) : idleVideos;
    if (pool.length === 0) return idleVideos[0];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function slotSrc(slot) {
    const attr = slot.getAttribute('src');
    if (attr) return attr;
    const url = slot.currentSrc || slot.src;
    if (!url) return '';
    try {
      const path = new URL(url, window.location.href).pathname;
      return path.startsWith('/') ? path.slice(1) : path;
    } catch {
      return url;
    }
  }

  function loadSlot(slot, src) {
    slot.src = src;
    slot.loop = false;
    slot.muted = true;
    slot.playsInline = true;
    slot.load();
  }

  function bindFrontEnded() {
    frontSlot.removeEventListener('ended', onIdleEnded);
    frontSlot.addEventListener('ended', onIdleEnded);
  }

  async function crossfadeIdle() {
    if (idleSwapping || state.phase !== 'playing' || deathTriggered) return;
    idleSwapping = true;

    try {
      await backSlot.play().catch(() => {});
      els.videoLayer.classList.add('idle-crossfade');
      await sleep(IDLE_CROSSFADE_MS);

      frontSlot.pause();
      frontSlot.currentTime = 0;

      els.videoLayer.classList.remove('idle-crossfade');

      frontSlot.classList.remove('is-front');
      frontSlot.classList.add('is-back');
      backSlot.classList.remove('is-back');
      backSlot.classList.add('is-front');

      const tmp = frontSlot;
      frontSlot = backSlot;
      backSlot = tmp;

      lastIdleSrc = slotSrc(frontSlot);
      loadSlot(backSlot, pickIdle(lastIdleSrc));
      bindFrontEnded();
    } finally {
      idleSwapping = false;
    }
  }

  function onIdleEnded() {
    if (state.phase !== 'playing' || deathTriggered) return;
    crossfadeIdle();
  }

  async function startIdlePool() {
    idleSwapping = false;
    deathTriggered = false;

    els.videoLayer.classList.remove('deteriorating', 'idle-crossfade');

    frontSlot = els.activeSlot;
    backSlot = els.nextSlot;
    frontSlot.classList.add('is-front');
    frontSlot.classList.remove('is-back');
    backSlot.classList.add('is-back');
    backSlot.classList.remove('is-front');

    lastIdleSrc = pickIdle(null);
    loadSlot(frontSlot, lastIdleSrc);
    loadSlot(backSlot, pickIdle(lastIdleSrc));
    bindFrontEnded();

    await frontSlot.play().catch(() => {});
  }

  function holdDeathLastFrame() {
    const video = els.deathVideo;
    video.pause();
    if (Number.isFinite(video.duration) && video.duration > 0) {
      video.currentTime = Math.max(0, video.duration - 0.05);
    }
  }

  function calcMap(sbp, dbp) {
    return Math.round(dbp + (sbp - dbp) / 3);
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
    const { hr, spo2, sbp, dbp, rr, temp, lactate } = state.vitals;
    const map = calcMap(sbp, dbp);
    const hrClass = vitalClassHr(hr);
    const spo2Class = vitalClassSpo2(spo2);

    els.vitals.hr.textContent = String(Math.round(hr));
    els.vitals.spo2.textContent = `${Math.round(spo2)}%`;
    els.vitals.nibp.textContent = `${Math.round(sbp)}/${Math.round(dbp)}`;
    els.vitals.rr.textContent = String(Math.round(rr));

    els.vitals.hr.className = `hud-vital-value ${hrClass}`.trim();
    els.vitals.spo2.className = `hud-vital-value ${spo2Class}`.trim();
    els.vitals.nibp.className = 'hud-vital-value';
    els.vitals.rr.className = 'hud-vital-value';

    if (els.monitor.hr) {
      els.monitor.hr.textContent = String(Math.round(hr));
      els.monitor.hr.className = `monitor-value ${hrClass}`.trim();
    }
    if (els.monitor.spo2) {
      els.monitor.spo2.textContent = `${Math.round(spo2)}%`;
      els.monitor.spo2.className = `monitor-value ${spo2Class}`.trim();
    }
    if (els.monitor.nibp) els.monitor.nibp.textContent = `${Math.round(sbp)}/${Math.round(dbp)}`;
    if (els.monitor.rr) els.monitor.rr.textContent = String(Math.round(rr));
    if (els.monitor.temp) els.monitor.temp.textContent = `${temp.toFixed(1)}°C`;
    if (els.monitor.map) els.monitor.map.textContent = String(map);
    if (els.monitor.lactate) {
      els.monitor.lactate.textContent = lactate.toFixed(1);
      els.monitor.lactate.className = `monitor-value ${lactate >= 4 ? 'red' : lactate >= 2 ? 'amber' : ''}`.trim();
    }
    if (els.monitor.orders) {
      els.monitor.orders.textContent = `Orders placed: ${state.placedCount}/${TOTAL_ORDERS}`;
    }
    if (els.monitor.pathway) els.monitor.pathway.textContent = PATHWAY_LABEL;
  }

  function updatePatientLife() {
    if (!els.patientLifeFill) return;
    const pct = clamp((state.secondsLeft / TIMER_START_SEC) * 100, 0, 100);
    els.patientLifeFill.style.width = `${pct}%`;
  }

  function updateTimerDisplay() {
    els.timer.textContent = formatTimer(state.secondsLeft);
    els.timer.classList.remove('amber', 'red');
    if (state.secondsLeft <= 60) els.timer.classList.add('red');
    else if (state.secondsLeft <= 120) els.timer.classList.add('amber');
    updatePatientLife();
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
      beepGain.gain.value = 1;
      beepGain.connect(ctx.destination);
      state.audio.beepGain = beepGain;
    } catch {
      state.audio = null;
    }
  }

  async function unlockAudio() {
    if (audioUnlocked) return true;
    if (!state.audio?.ctx) return false;
    try {
      await state.audio.ctx.resume();
    } catch {
      return false;
    }
    if (state.audio.ctx.state !== 'running') return false;

    audioUnlocked = true;
    localStorage.setItem('audio_unlocked', '1');
    hideAudioStartOverlay();
    if (state.phase === 'playing') scheduleBeep();
    return true;
  }

  function resumeAudio() {
    unlockAudio();
  }

  async function tryAutoUnlockAudio() {
    if (audioUnlocked) return;
    if (localStorage.getItem('audio_unlocked') !== '1') return;
    await unlockAudio();
    hideAudioStartOverlay();
  }

  function showAudioStartOverlay() {
    if (audioUnlocked || localStorage.getItem('audio_unlocked') === '1') return;
    document.getElementById('audio-start-overlay')?.classList.add('visible');
  }

  function hideAudioStartOverlay() {
    document.getElementById('audio-start-overlay')?.classList.remove('visible');
  }

  function wireAudioStartOverlay() {
    const overlay = document.getElementById('audio-start-overlay');
    if (!overlay) return;

    overlay.addEventListener('pointerdown', async (event) => {
      event.preventDefault();
      await unlockAudio();
      hideAudioStartOverlay();
    });
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
    state.vitals.temp = clamp(state.vitals.temp + 0.1, 36, 41);
    state.vitals.lactate = clamp(state.vitals.lactate + 0.1, 1, 8);

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

  function createDragGhost(label) {
    cleanupDragGhosts();
    const ghost = document.createElement('div');
    ghost.className = 'stack-drag-ghost';
    ghost.textContent = label;
    ghost.setAttribute('aria-hidden', 'true');
    document.body.appendChild(ghost);
    return ghost;
  }

  function cleanupDragGhosts() {
    document.querySelectorAll('.stack-drag-ghost, .order-ghost').forEach((node) => node.remove());
  }

  function moveDragGhost(x, y) {
    if (!state.ghost) return;
    state.ghost.style.left = `${x}px`;
    state.ghost.style.top = `${y}px`;
  }

  function isPointerOverPatient(x, y) {
    const layer = els.videoLayer;
    if (!layer) return false;
    const rect = layer.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function setPatientDropHighlight(active) {
    els.videoLayer?.classList.toggle('patient-drop-active', active);
    document.body.classList.toggle('stack-drag-over-patient', active);
    document.body.style.cursor = active ? 'crosshair' : '';
  }

  function showPlacementFeedback(label, x, y) {
    const stage = els.videoLayer?.parentElement;
    if (!stage) return;
    const el = document.createElement('div');
    el.className = 'stack-placement-feedback';
    el.textContent = `${label} placed`;
    const sr = stage.getBoundingClientRect();
    el.style.left = `${x - sr.left}px`;
    el.style.top = `${y - sr.top}px`;
    stage.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-visible'));
    setTimeout(() => {
      el.classList.remove('is-visible');
      setTimeout(() => el.remove(), 1500);
    }, 40);
  }

  function snapStackHome(el) {
    el.classList.remove('dragging', 'stack-drag-source');
    el.style.transition = 'transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1)';
    el.style.transform = '';
    setTimeout(() => {
      el.style.transition = '';
    }, 300);
  }

  function buildOrders() {
    els.ordersRail.innerHTML = '';
    ORDERS.forEach((label, i) => {
      const el = document.createElement('div');
      el.className = 'order-stack';
      el.textContent = label;
      el.dataset.orderId = String(i);
      el.dataset.orderName = label;
      el.setAttribute('draggable', 'true');
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.addEventListener('dragstart', (e) => startOrderDrag(e, el));
      el.addEventListener('dragend', endOrderDrag);
      el.addEventListener('touchstart', (e) => startOrderTouch(e, el), { passive: false });
      els.ordersRail.appendChild(el);
    });

    wirePatientDropTarget();
  }

  function wirePatientDropTarget() {
    const layer = els.videoLayer;
    if (!layer || layer.dataset.dropWired === '1') return;
    layer.dataset.dropWired = '1';

    layer.addEventListener('dragover', (e) => {
      if (!state.dragging) return;
      e.preventDefault();
      setPatientDropHighlight(true);
    });
    layer.addEventListener('dragleave', (e) => {
      if (!state.dragging) return;
      if (layer.contains(e.relatedTarget)) return;
      setPatientDropHighlight(false);
    });
    layer.addEventListener('drop', (e) => {
      if (!state.dragging) return;
      e.preventDefault();
      setPatientDropHighlight(false);
      if (isPointerOverPatient(e.clientX, e.clientY)) {
        completeOrderDrop(e.clientX, e.clientY);
      } else {
        cancelOrderDrag();
      }
    });
  }

  function startOrderDrag(e, el) {
    if (state.phase !== 'playing' || el.classList.contains('placed')) {
      e.preventDefault();
      return;
    }
    resumeAudio();
    state.dragging = el;
    el.classList.add('dragging', 'stack-drag-source');

    const label = el.dataset.orderName || el.textContent.trim();
    state.ghost = createDragGhost(label);
    moveDragGhost(e.clientX, e.clientY);

    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', label);
      const img = new Image();
      img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      e.dataTransfer.setDragImage(img, 0, 0);
    }
  }

  function startOrderTouch(e, el) {
    if (state.phase !== 'playing' || el.classList.contains('placed')) return;
    if (e.touches.length !== 1) return;
    resumeAudio();

    const touch = e.touches[0];
    state.dragging = el;
    state.touchDrag = { startX: touch.clientX, startY: touch.clientY };
    el.classList.add('dragging', 'stack-drag-source');

    const label = el.dataset.orderName || el.textContent.trim();
    state.ghost = createDragGhost(label);
    moveDragGhost(touch.clientX, touch.clientY);

    const onTouchMove = (moveEvent) => {
      if (!state.dragging || moveEvent.touches.length !== 1) return;
      moveEvent.preventDefault();
      const t = moveEvent.touches[0];
      moveDragGhost(t.clientX, t.clientY);
      setPatientDropHighlight(isPointerOverPatient(t.clientX, t.clientY));
    };

    const onTouchEnd = (endEvent) => {
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onTouchEnd);
      const t = endEvent.changedTouches[0];
      setPatientDropHighlight(false);
      if (t && isPointerOverPatient(t.clientX, t.clientY)) {
        completeOrderDrop(t.clientX, t.clientY);
      } else {
        cancelOrderDrag();
      }
    };

    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
    document.addEventListener('touchcancel', onTouchEnd);
    e.preventDefault();
  }

  function endOrderDrag(e) {
    setPatientDropHighlight(false);
    if (!state.dragging) {
      cleanupDragGhosts();
      return;
    }
    if (isPointerOverPatient(e.clientX, e.clientY)) {
      completeOrderDrop(e.clientX, e.clientY);
    } else {
      cancelOrderDrag();
    }
  }

  function completeOrderDrop(clientX, clientY) {
    const el = state.dragging;
    if (!el || el.classList.contains('placed')) {
      cancelOrderDrag();
      return;
    }

    const label = el.dataset.orderName || el.textContent.trim();
    cleanupDragGhosts();
    el.classList.remove('stack-drag-source');
    el.classList.add('stack-dismiss-up');

    showPlacementFeedback(label, clientX, clientY);

    setTimeout(() => {
      placeOrder(el);
      el.classList.remove('dragging', 'stack-dismiss-up');
    }, 320);

    state.dragging = null;
    state.ghost = null;
    state.touchDrag = null;
    document.body.style.cursor = '';
  }

  function cancelOrderDrag() {
    const el = state.dragging;
    cleanupDragGhosts();
    if (el) snapStackHome(el);
    state.dragging = null;
    state.ghost = null;
    state.touchDrag = null;
    setPatientDropHighlight(false);
  }

  function placeOrder(el) {
    el.classList.add('placed');
    state.placedCount += 1;
    state.driftPausedUntil = Date.now() + TREATMENT_PAUSE_MS;

    if (state.placedCount >= TOTAL_ORDERS) triggerWin();
    renderVitals();
  }

  function triggerDeteriorationVideo() {
    if (deathTriggered) return;
    deathTriggered = true;

    frontSlot.pause();
    backSlot.pause();
    els.videoLayer.classList.remove('idle-crossfade');

    els.deathVideo.src = DEATH_VIDEO;
    els.deathVideo.loop = false;
    els.deathVideo.currentTime = 0;
    els.videoLayer.classList.add('deteriorating');
    els.deathVideo.play().catch(() => {});
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

  function manualTriggerDeath() {
    if (state.phase !== 'playing') return;
    triggerLose();
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
      state.vitals.rr = start.rr + (NORMAL.rr - start.rr) * ease;
      state.vitals.temp = start.temp + (NORMAL.temp - start.temp) * ease;
      state.vitals.lactate = start.lactate + (NORMAL.lactate - start.lactate) * ease;
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
    frontSlot.pause();
    backSlot.pause();
    els.winOverlay.classList.add('visible');
    animateVitalsToNormal(WIN_ANIM_MS);
  }

  function hideOverlays() {
    els.loseOverlay.classList.remove('visible');
    els.winOverlay.classList.remove('visible');
  }

  function resetCase(skipChatPrompt = false) {
    if (!skipChatPrompt && window.ClinicalChat?.confirmClearOnReset?.()) {
      window.ClinicalChat.clearHistory();
    }

    clearIntervals();
    hideOverlays();
    document.body.classList.remove('game-ended');

    state.phase = 'playing';
    state.secondsLeft = TIMER_START_SEC;
    state.driftPausedUntil = 0;
    state.placedCount = 0;
    state.vitals = { ...START_VITALS };

    els.deathVideo.pause();
    els.deathVideo.currentTime = 0;
    initVideos();

    updateTimerDisplay();
    renderVitals();
    buildOrders();

    state.intervals.timer = setInterval(tickTimer, 1000);
    state.intervals.drift = setInterval(tickDrift, DRIFT_MS);
    scheduleBeep();
  }

  function initVideos() {
    startIdlePool();
  }

  function clampPanel(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function readPanelPosition() {
    try {
      const raw = localStorage.getItem(PANEL_POSITION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return {
        x: Number.isFinite(parsed.x) ? parsed.x : null,
        y: Number.isFinite(parsed.y) ? parsed.y : null,
        width: Number.isFinite(parsed.width) ? parsed.width : PANEL_DOCKED_WIDTH,
        height: Number.isFinite(parsed.height) ? parsed.height : Math.max(PANEL_MIN_HEIGHT, window.innerHeight - 100),
        lastVisibleMode: parsed.lastVisibleMode || null,
      };
    } catch {
      return null;
    }
  }

  function writePanelPosition() {
    const payload = {
      x: panelState.layout === 'floating' ? panelState.x : null,
      y: panelState.layout === 'floating' ? panelState.y : null,
      width: panelState.width,
      height: panelState.height,
    };
    if (panelState.mode === 'hidden') {
      payload.lastVisibleMode = panelState.lastVisibleMode;
    }
    localStorage.setItem(PANEL_POSITION_KEY, JSON.stringify(payload));
  }

  function writePanelMode() {
    localStorage.setItem(PANEL_MODE_KEY, panelState.mode);
  }

  function defaultFloatingPosition() {
    const width = clampPanel(panelState.width, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH);
    const height = clampPanel(panelState.height, PANEL_MIN_HEIGHT, window.innerHeight - 20);
    return {
      x: Math.max(12, window.innerWidth - width - 20),
      y: Math.max(12, Math.round((window.innerHeight - height) / 2)),
      width,
      height,
    };
  }

  function applyPanelGeometry() {
    const panel = els.casePanel;
    if (!panel) return;

    panel.style.removeProperty('--panel-x');
    panel.style.removeProperty('--panel-y');
    panel.style.removeProperty('--panel-w');
    panel.style.removeProperty('--panel-h');

    if (panelState.layout === 'floating') {
      panel.style.setProperty('--panel-x', `${panelState.x}px`);
      panel.style.setProperty('--panel-y', `${panelState.y}px`);
      panel.style.setProperty('--panel-w', `${panelState.width}px`);
      panel.style.setProperty('--panel-h', `${panelState.height}px`);
    }
  }

  function updatePanelControlStates() {
    const isHidden = panelState.mode === 'hidden';
    const isCollapsed = panelState.mode === 'collapsed';
    const isDocked = !isHidden && panelState.layout === 'docked';
    const isFloating = !isHidden && panelState.layout === 'floating';

    els.casePanelDock?.classList.toggle('is-active', isDocked);
    els.casePanelFloat?.classList.toggle('is-active', isFloating);
    els.casePanelCollapse?.classList.toggle('is-active', isCollapsed);
  }

  function applyPanelState() {
    const panel = els.casePanel;
    if (!panel) return;

    const isHidden = panelState.mode === 'hidden';
    const isCollapsed = panelState.mode === 'collapsed';
    const isFloating = panelState.layout === 'floating';

    panel.classList.toggle('is-hidden', isHidden);
    panel.classList.toggle('is-collapsed', isCollapsed);
    panel.classList.toggle('is-docked', !isFloating);
    panel.classList.toggle('is-floating', isFloating);

    if (els.casePanelReveal) {
      els.casePanelReveal.hidden = !isHidden;
    }

    applyPanelGeometry();
    updatePanelControlStates();
    writePanelMode();
    writePanelPosition();
  }

  function setPanelMode(mode, { persist = true } = {}) {
    if (mode !== 'hidden') {
      panelState.lastVisibleMode = mode;
    }
    panelState.mode = mode;
    if (persist) applyPanelState();
  }

  function setPanelLayout(layout) {
    panelState.layout = layout;
    if (layout === 'docked') {
      panelState.width = PANEL_DOCKED_WIDTH;
      panelState.height = window.innerHeight;
    } else {
      const saved = readPanelPosition();
      if (saved?.x != null && saved?.y != null) {
        panelState.x = saved.x;
        panelState.y = saved.y;
        panelState.width = clampPanel(saved.width, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH);
        panelState.height = clampPanel(saved.height, PANEL_MIN_HEIGHT, window.innerHeight - 20);
      } else {
        const defaults = defaultFloatingPosition();
        panelState.x = defaults.x;
        panelState.y = defaults.y;
        panelState.width = defaults.width;
        panelState.height = defaults.height;
      }
    }
  }

  function dockPanel() {
    panelState.layout = 'docked';
    panelState.width = PANEL_DOCKED_WIDTH;
    panelState.height = window.innerHeight;
    if (panelState.mode === 'collapsed') {
      setPanelMode('collapsed');
    } else {
      setPanelMode('docked');
    }
  }

  function floatPanel() {
    setPanelLayout('floating');
    if (panelState.mode === 'collapsed') {
      setPanelMode('collapsed');
    } else {
      setPanelMode('floating');
    }
  }

  function togglePanelCollapsed() {
    if (panelState.mode === 'collapsed') {
      setPanelMode(panelState.layout === 'floating' ? 'floating' : 'docked');
      return;
    }
    if (panelState.mode === 'hidden') return;
    setPanelMode('collapsed');
  }

  function hidePanel() {
    if (panelState.mode !== 'hidden') {
      panelState.lastVisibleMode = panelState.mode;
    }
    setPanelMode('hidden');
  }

  function revealPanel() {
    const saved = readPanelPosition();
    const restore = saved?.lastVisibleMode || panelState.lastVisibleMode || 'docked';

    if (restore === 'floating' || (restore === 'collapsed' && saved?.x != null && saved?.y != null)) {
      setPanelLayout('floating');
    } else {
      setPanelLayout('docked');
    }

    setPanelMode(restore === 'hidden' ? 'docked' : restore);
  }

  function restorePanelState() {
    const legacyCollapsed = localStorage.getItem('panel_collapsed') === '1';
    let mode = localStorage.getItem(PANEL_MODE_KEY) || 'docked';
    const saved = readPanelPosition();

    if (!localStorage.getItem(PANEL_MODE_KEY) && legacyCollapsed) {
      mode = 'collapsed';
    }

    panelState.layout = 'docked';
    panelState.width = PANEL_DOCKED_WIDTH;
    panelState.height = window.innerHeight;

    const useFloatingLayout = mode === 'floating'
      || (mode === 'collapsed' && saved?.x != null && saved?.y != null);

    if (useFloatingLayout) {
      panelState.layout = 'floating';
      if (saved?.x != null && saved?.y != null) {
        panelState.x = clampPanel(saved.x, 0, Math.max(0, window.innerWidth - PANEL_MIN_WIDTH));
        panelState.y = clampPanel(saved.y, 0, Math.max(0, window.innerHeight - PANEL_HEADER_HEIGHT));
        panelState.width = clampPanel(saved.width, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH);
        panelState.height = clampPanel(saved.height, PANEL_MIN_HEIGHT, window.innerHeight - 20);
      } else {
        const defaults = defaultFloatingPosition();
        panelState.x = defaults.x;
        panelState.y = defaults.y;
        panelState.width = defaults.width;
        panelState.height = defaults.height;
      }
    }

    if (saved?.lastVisibleMode) {
      panelState.lastVisibleMode = saved.lastVisibleMode;
    } else if (mode !== 'hidden') {
      panelState.lastVisibleMode = mode;
    }

    panelState.mode = mode;
    applyPanelState();
  }

  function onPanelDragMove(event) {
    if (!panelState.drag) return;
    const dx = event.clientX - panelState.drag.startX;
    const dy = event.clientY - panelState.drag.startY;
    const maxX = Math.max(0, window.innerWidth - panelState.width);
    const maxY = Math.max(0, window.innerHeight - PANEL_HEADER_HEIGHT);
    panelState.x = clampPanel(panelState.drag.originX + dx, 0, maxX);
    panelState.y = clampPanel(panelState.drag.originY + dy, 0, maxY);
    applyPanelGeometry();
  }

  function stopPanelDrag() {
    if (!panelState.drag) return;
    panelState.drag = null;
    els.casePanel?.classList.remove('is-dragging');
    document.removeEventListener('pointermove', onPanelDragMove);
    document.removeEventListener('pointerup', stopPanelDrag);
    writePanelPosition();
  }

  function startPanelDrag(event) {
    if (panelState.layout !== 'floating' || panelState.mode === 'hidden') return;
    if (event.target.closest('.case-panel-controls, .case-panel-refresh')) return;
    if (event.button !== 0) return;

    panelState.drag = {
      startX: event.clientX,
      startY: event.clientY,
      originX: panelState.x,
      originY: panelState.y,
    };
    els.casePanel?.classList.add('is-dragging');
    document.addEventListener('pointermove', onPanelDragMove);
    document.addEventListener('pointerup', stopPanelDrag);
    event.preventDefault();
  }

  function onPanelResizeMove(event) {
    if (!panelState.resize) return;
    const dx = event.clientX - panelState.resize.startX;
    const dy = event.clientY - panelState.resize.startY;
    panelState.width = clampPanel(
      panelState.resize.originW + dx,
      PANEL_MIN_WIDTH,
      PANEL_MAX_WIDTH,
    );
    panelState.height = clampPanel(
      panelState.resize.originH + dy,
      PANEL_MIN_HEIGHT,
      window.innerHeight - panelState.y,
    );
    applyPanelGeometry();
  }

  function stopPanelResize() {
    if (!panelState.resize) return;
    panelState.resize = null;
    document.removeEventListener('pointermove', onPanelResizeMove);
    document.removeEventListener('pointerup', stopPanelResize);
    writePanelPosition();
  }

  function startPanelResize(event) {
    if (panelState.layout !== 'floating' || panelState.mode === 'collapsed' || panelState.mode === 'hidden') return;
    if (event.button !== 0) return;

    panelState.resize = {
      startX: event.clientX,
      startY: event.clientY,
      originW: panelState.width,
      originH: panelState.height,
    };
    document.addEventListener('pointermove', onPanelResizeMove);
    document.addEventListener('pointerup', stopPanelResize);
    event.preventDefault();
    event.stopPropagation();
  }

  function wireCasePanel() {
    els.casePanelDock?.addEventListener('click', (event) => {
      event.stopPropagation();
      dockPanel();
    });
    els.casePanelFloat?.addEventListener('click', (event) => {
      event.stopPropagation();
      floatPanel();
    });
    els.casePanelCollapse?.addEventListener('click', (event) => {
      event.stopPropagation();
      togglePanelCollapsed();
    });
    els.casePanelHide?.addEventListener('click', (event) => {
      event.stopPropagation();
      hidePanel();
    });
    els.casePanelReveal?.addEventListener('click', revealPanel);
    els.casePanelHeader?.addEventListener('pointerdown', startPanelDrag);
    els.casePanelResize?.addEventListener('pointerdown', startPanelResize);
    els.casePanelRefresh?.addEventListener('click', (event) => {
      event.stopPropagation();
      resetCase(false);
    });

    window.addEventListener('resize', () => {
      if (panelState.layout === 'docked' && panelState.mode !== 'hidden') {
        panelState.height = window.innerHeight;
        applyPanelGeometry();
        writePanelPosition();
      } else if (panelState.layout === 'floating') {
        const maxX = Math.max(0, window.innerWidth - panelState.width);
        const maxY = Math.max(0, window.innerHeight - PANEL_HEADER_HEIGHT);
        panelState.x = clampPanel(panelState.x, 0, maxX);
        panelState.y = clampPanel(panelState.y, 0, maxY);
        panelState.height = clampPanel(panelState.height, PANEL_MIN_HEIGHT, window.innerHeight - panelState.y);
        applyPanelGeometry();
        writePanelPosition();
      }
    });

    restorePanelState();
  }

  function wireAudioUnlock() {
    const unlock = () => {
      unlockAudio();
    };

    ['pointerdown', 'keydown', 'touchstart'].forEach((eventName) => {
      document.addEventListener(eventName, unlock, { passive: true });
    });

    document.getElementById('case-selector')?.addEventListener('change', unlock);
  }

  function wireToolbar() {
    document.querySelectorAll('.toolbar-btn[title="Vitals"]').forEach((btn) => {
      btn.addEventListener('click', unlockAudio);
    });

    document.querySelectorAll('.toolbar-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'restart') {
          resetCase(false);
          return;
        }
        if (action === 'trigger-death') {
          manualTriggerDeath();
          return;
        }
        if (action === 'toggle-chat') return;
        if (action === 'open-pe' || action === 'open-hpi') return;
        btn.classList.toggle('active');
      });
    });

    document.getElementById('btn-try-again')?.addEventListener('click', () => resetCase(false));
    document.getElementById('btn-review')?.addEventListener('click', () => {
      els.loseOverlay.classList.remove('visible');
    });
    document.getElementById('btn-win-dismiss')?.addEventListener('click', () => resetCase(false));
  }

  function init() {
    initAudio();
    cleanupDragGhosts();
    wireAudioUnlock();
    wireAudioStartOverlay();
    tryAutoUnlockAudio();
    els.deathVideo.muted = true;
    els.deathVideo.playsInline = true;
    els.deathVideo.addEventListener('ended', holdDeathLastFrame);
    wireToolbar();
    wireCasePanel();

    window.addEventListener('cases-ready', (event) => {
      applyCaseData(event.detail);
      gameStarted = true;
      tryAutoUnlockAudio().then(() => {
        if (!audioUnlocked) showAudioStartOverlay();
      });
    });

    window.addEventListener('case-loaded', (event) => {
      if (!gameStarted) return;
      applyCaseData(event.detail);
      window.ClinicalChat?.onCaseChanged?.();
      tryAutoUnlockAudio();
    });

    // Browsers block audio until a user gesture — unlock on first interaction anywhere.
    document.body.addEventListener('pointerdown', unlockAudio, { once: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
