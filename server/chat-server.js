import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PORT = Number(process.env.CLINICAL_SCENE_PORT || 3002);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CASE_FILE = path.join(ROOT, '..', 'assets', 'data', 'case-143.json');
const sessions = new Map();

function loadCaseData() {
  return JSON.parse(readFileSync(CASE_FILE, 'utf8'));
}

function buildPatientPrompt(caseContext) {
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
${JSON.stringify(caseContext, null, 2)}`;
}

async function callOpenAI(messages) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not configured');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
      max_tokens: 120,
      temperature: 0.55,
      messages,
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  try {
    if (req.method === 'GET' && req.url === '/api/health') {
      sendJson(res, 200, { ok: true, openai: Boolean(process.env.OPENAI_API_KEY) });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/case-chat/start') {
      const body = await readBody(req);
      const caseContext = body.caseContext || loadCaseData();
      const sessionId = crypto.randomUUID().replace(/-/g, '');
      sessions.set(sessionId, {
        messages: [{ role: 'system', content: buildPatientPrompt(caseContext) }],
      });
      sendJson(res, 200, { ok: true, sessionId, caseId: caseContext.id });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/case-chat/message') {
      const body = await readBody(req);
      const session = sessions.get(body.sessionId);
      const text = String(body.message || '').trim();
      if (!session) {
        sendJson(res, 404, { error: 'Chat session expired' });
        return;
      }
      if (!text) {
        sendJson(res, 400, { error: 'Missing message' });
        return;
      }

      session.messages.push({ role: 'user', content: text });
      const window = session.messages.slice(0, 1).concat(session.messages.slice(-24));
      const reply = await callOpenAI(window);
      session.messages.push({ role: 'assistant', content: reply });
      sendJson(res, 200, { ok: true, reply });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    sendJson(res, 500, { error: String(error.message || error) });
  }
});

server.listen(PORT, () => {
  console.log(`Clinical scene chat server on http://127.0.0.1:${PORT}`);
});
