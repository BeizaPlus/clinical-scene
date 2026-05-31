import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'assets/icons');

function inlineSvg(name) {
  const raw = fs.readFileSync(path.join(dir, `${name}.svg`), 'utf8');
  const paths = [...raw.matchAll(/<path[^>]*\/>/g)].map((m) => m[0]).join('\n        ');
  return `<svg class="toolbar-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        ${paths}
      </svg>`;
}

const buttons = [
  { action: 'open-pe', label: 'Physical exam', icon: 'ti-stethoscope' },
  { action: '', label: 'Vitals', icon: 'ti-activity-heartbeat', title: 'Vitals' },
  { action: 'open-hpi', label: 'Patient chart', icon: 'ti-clipboard-pulse' },
  { action: '', label: 'Medical record', icon: 'ti-file-medical' },
  'sep',
  { action: 'toggle-chat', label: 'Chat', icon: 'ti-message-2' },
  { action: '', label: 'Voice input', icon: 'ti-microphone-2' },
  { action: 'trigger-death', label: 'Skip to deterioration', icon: 'ti-player-skip-forward' },
  { action: 'restart', label: 'Restart case', icon: 'ti-rotate' },
  'sep',
  { action: '', label: 'Hide cues', icon: 'ti-eye-off' },
  { action: '', label: 'Dark mode', icon: 'ti-moon' },
  { action: '', label: 'Free drop mode', icon: 'ti-lock-open' },
];

const lines = ['  <nav class="toolbar" aria-label="Scene controls">'];
for (const b of buttons) {
  if (b === 'sep') {
    lines.push('    <span class="toolbar-sep" aria-hidden="true"></span>');
    continue;
  }
  const data = b.action ? ` data-action="${b.action}"` : '';
  const title = b.title || b.label;
  lines.push(`    <button type="button" class="toolbar-btn"${data} title="${title}" aria-label="${b.label}">`);
  lines.push(`      ${inlineSvg(b.icon)}`);
  lines.push('    </button>');
}
lines.push('  </nav>');

fs.writeFileSync(path.join(root, '_toolbar_snippet.txt'), `${lines.join('\n')}\n`);
console.log('Wrote toolbar snippet');
