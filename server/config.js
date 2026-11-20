import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.CASCADE_DATA_DIR || path.join(ROOT, 'data');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const FILES_DIR = path.join(DATA_DIR, 'files');
export const PORT = Number(process.env.PORT || 5177);

for (const dir of [DATA_DIR, FILES_DIR]) fs.mkdirSync(dir, { recursive: true });
