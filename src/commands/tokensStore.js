import fs from 'fs';
import path from 'path';

const dataDir = path.resolve('data');
const tokensFile = path.join(dataDir, 'tokens.json');

function ensureStore() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(tokensFile)) fs.writeFileSync(tokensFile, JSON.stringify({}, null, 2));
}

export function loadTokens() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(tokensFile, 'utf8'));
  } catch {
    return {};
  }
}

export function saveTokens(tokensObj) {
  ensureStore();
  fs.writeFileSync(tokensFile, JSON.stringify(tokensObj, null, 2));
}