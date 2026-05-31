(() => {
  'use strict';

  const API_BASE = window.CLINICAL_SCENE_API || 'http://127.0.0.1:3002';
  const FALLBACK_REPLY = "I'm having trouble speaking right now.";

  let sessionId = null;
  let chatOpen = false;

  const els = {
    panel: document.getElementById('chat-panel'),
    messages: document.getElementById('chat-messages'),
    form: document.getElementById('chat-form'),
    input: document.getElementById('chat-input'),
    toggleBtn: document.querySelector('[data-action="toggle-chat"]'),
  };

  function chatStorageKey() {
    const caseData = window.ClinicalCases?.getActiveCase();
    const variant = window.ClinicalCases?.getActiveVariant();
    const id = caseData?.id ?? 'unknown';
    const variantCode = variant?.code ?? 'base';
    return `chat_history_case_${id}_${variantCode}`;
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(chatStorageKey());
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveHistory(history) {
    localStorage.setItem(chatStorageKey(), JSON.stringify(history));
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

    const caseData = window.ClinicalCases?.getActiveCase();
    if (!caseData) throw new Error('No active case');

    const response = await fetch(`${API_BASE}/api/case-chat/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseContext: {
          id: String(caseData.id),
          title: caseData.title,
          playRole: 'patient',
          systemPrompt: window.ClinicalCases.buildPatientPrompt(caseData),
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
    localStorage.removeItem(chatStorageKey());
    sessionId = null;
    renderHistory([]);
  }

  function confirmClearOnReset() {
    const history = loadHistory();
    if (history.length === 0) return false;
    return window.confirm('Clear chat history for this case? (yes/no)') === true;
  }

  function onCaseChanged() {
    sessionId = null;
    if (chatOpen) renderHistory(loadHistory());
  }

  function onVariantChanged() {
    sessionId = null;
    if (chatOpen) renderHistory(loadHistory());
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
      onCaseChanged,
      onVariantChanged,
      open: () => setChatOpen(true),
      close: () => setChatOpen(false),
    };

    window.addEventListener('variant-changed', onVariantChanged);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChat);
  } else {
    initChat();
  }
})();
