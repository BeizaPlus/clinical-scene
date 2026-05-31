import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/icons');
const names = fs.readdirSync(dir).filter((f) => f.startsWith('ti-') && f.endsWith('.svg'));

for (const file of names) {
  const raw = fs.readFileSync(path.join(dir, file), 'utf8');
  const paths = [...raw.matchAll(/<path[^>]*\/>/g)].map((m) => m[0]);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\n${paths.map((p) => `  ${p}`).join('\n')}\n</svg>\n`;
  fs.writeFileSync(path.join(dir, file), svg);
  console.log(`normalized ${file} (${paths.length} paths)`);
}
