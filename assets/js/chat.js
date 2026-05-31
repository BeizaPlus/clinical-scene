(() => {
  'use strict';

  const CASE_ID = '143';
  const CASE_HEADER = 'CASE 143 — POOR FEEDING';
  const CHAT_STORAGE_KEY = `chat_history_case_${CASE_ID}`;
  const API_BASE = window.CLINICAL_SCENE_API || 'http://127.0.0.1:3002';
  const FALLBACK_REPLY = "I'm having trouble speaking right now.";

  let caseData = null;
  let sessionId = null;
  let chatOpen = false;

  const els = {
    panel: document.getElementById('chat-panel'),
    messages: document.getElementById('chat-messages'),
    form: document.getElementById('chat-form'),
    input: document.getElementById('chat-input'),
    toggleBtn: document.querySelector('[data-action="toggle-chat"]'),
  };

  function buildSystemPrompt(context) {
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
${JSON.stringify(context, null, 2)}`;
  }

  async function loadCaseData() {
    if (caseData) return caseData;
    const response = await fetch('assets/data/case-143.json');
    caseData = await response.json();
    return caseData;
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(CHAT_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveHistory(history) {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(history));
  }

  function formatTimestamp(iso) {
    const date = new Date(iso);
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function scrollToBottom() {
    if (!els.messages) return;
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function renderHistory(history) {
    if (!els.messages) return;
    els.messages.innerHTML = '';

    history.forEach((entry) => {
      const row = document.createElement('div');
      row.className = `chat-message chat-message--${entry.role}`;

      const time = document.createElement('time');
      time.className = 'chat-message-time';
      time.dateTime = entry.timestamp;
      time.textContent = formatTimestamp(entry.timestamp);

      if (entry.role === 'patient') {
        const avatar = document.createElement('span');
        avatar.className = 'chat-avatar';
        avatar.setAttribute('aria-hidden', 'true');

        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble chat-bubble--patient';
        bubble.textContent = entry.content;

        const inner = document.createElement('div');
        inner.className = 'chat-message-inner';
        inner.append(avatar, bubble);
        row.append(time, inner);
      } else {
        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble chat-bubble--student';
        bubble.textContent = entry.content;
        row.append(time, bubble);
      }

      els.messages.appendChild(row);
    });

    scrollToBottom();
  }

  function appendMessage(role, content) {
    const history = loadHistory();
    const entry = {
      role,
      content,
      timestamp: new Date().toISOString(),
    };
    history.push(entry);
    saveHistory(history);
    renderHistory(history);
    return entry;
  }

  async function ensureSession() {
    if (sessionId) return sessionId;

    const context = await loadCaseData();
    const response = await fetch(`${API_BASE}/api/case-chat/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseContext: {
          ...context,
          playRole: 'patient',
        },
      }),
    });

    if (!response.ok) throw new Error('Chat session unavailable');

    const data = await response.json();
    sessionId = data.sessionId;
    return sessionId;
  }

  async function requestPatientReply(message) {
    try {
      const id = await ensureSession();
      const response = await fetch(`${API_BASE}/api/case-chat/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: id, message }),
      });

      if (!response.ok) throw new Error('Chat request failed');

      const data = await response.json();
      return data.reply || FALLBACK_REPLY;
    } catch {
      return FALLBACK_REPLY;
    }
  }

  function setTyping(active) {
    els.panel?.classList.toggle('is-typing', active);
    const typingEl = document.getElementById('chat-typing');
    if (typingEl) typingEl.hidden = !active;
  }

  async function handleSend(event) {
    event.preventDefault();
    const text = els.input?.value.trim();
    if (!text) return;

    els.input.value = '';
    els.input.disabled = true;
    appendMessage('student', text);
    setTyping(true);

    const reply = await requestPatientReply(text);
    setTyping(false);
    appendMessage('patient', reply);

    els.input.disabled = false;
    els.input.focus();
  }

  function setChatOpen(open) {
    chatOpen = open;
    document.body.classList.toggle('chat-open', open);
    els.panel?.classList.toggle('is-open', open);
    els.toggleBtn?.classList.toggle('active', open);
    els.toggleBtn?.classList.toggle('is-amber', open);

    if (open) {
      renderHistory(loadHistory());
      els.input?.focus();
    }
  }

  function toggleChat() {
    setChatOpen(!chatOpen);
  }

  function clearHistory() {
    localStorage.removeItem(CHAT_STORAGE_KEY);
    sessionId = null;
    renderHistory([]);
  }

  function confirmClearOnReset() {
    const history = loadHistory();
    if (history.length === 0) return false;
    return window.confirm('Clear chat history for this case? (yes/no)') === true;
  }

  function initChat() {
    if (!els.panel) return;

    els.form?.addEventListener('submit', handleSend);
    els.toggleBtn?.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleChat();
    });

    window.ClinicalChat = {
      clearHistory,
      confirmClearOnReset,
      open: () => setChatOpen(true),
      close: () => setChatOpen(false),
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChat);
  } else {
    initChat();
  }
})();
