import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dataDir = process.env.PIWAKE_DATA_DIR || path.join(os.homedir(), '.piwake');

function fileFor(name) {
  return path.join(dataDir, `${name}.json`);
}

export function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(fileFor(name), 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(name, value) {
  fs.mkdirSync(dataDir, { recursive: true });
  const target = fileFor(name);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, target);
}

export { dataDir };
