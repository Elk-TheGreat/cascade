// Ensures Playwright's Chromium is available; harmless when it already is.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const path = chromium.executablePath();
if (!existsSync(path)) {
  console.log('[cascade] downloading Playwright Chromium...');
  try {
    execSync('npx playwright install chromium', { stdio: 'inherit' });
  } catch {
    console.warn('[cascade] Chromium download failed; browser nodes will report the error at run time.');
  }
}
