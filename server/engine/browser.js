import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { FILES_DIR } from '../config.js';

const sessions = new Map(); // `${runId}:${session}` -> { browser, context, page }

async function getPage(runId, sessionName) {
  const key = `${runId}:${sessionName || 'main'}`;
  let entry = sessions.get(key);
  if (entry?.browser?.isConnected()) return entry.page;

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'CascadeAutomation/1.0 (+playwright)',
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  entry = { browser, context, page };
  sessions.set(key, entry);
  return page;
}

export async function closeRunSessions(runId) {
  for (const [key, entry] of sessions) {
    if (!key.startsWith(`${runId}:`)) continue;
    try { await entry.browser.close(); } catch { /* already gone */ }
    sessions.delete(key);
  }
}

function saveScreenshot(buffer, runId) {
  const name = `browser-${String(runId).slice(0, 8)}-${Date.now()}.png`;
  fs.writeFileSync(path.join(FILES_DIR, name), buffer);
  return { path: path.join(FILES_DIR, name), url: `/files/${name}` };
}

export async function runBrowserAction(config, { runId }) {
  const session = config.session || 'main';
  const action = config.action || 'goto';
  const timeout = Number(config.timeoutMs) || 20000;

  if (action === 'close') {
    const key = `${runId}:${session}`;
    const entry = sessions.get(key);
    if (entry) { try { await entry.browser.close(); } catch { /* ignore */ } sessions.delete(key); }
    return { closed: true, session };
  }

  const page = await getPage(runId, session);
  page.setDefaultTimeout(timeout);

  switch (action) {
    case 'goto': {
      if (!config.url) throw new Error('Browser node needs a URL for the goto action.');
      const response = await page.goto(config.url, { waitUntil: 'domcontentloaded', timeout });
      await page.waitForLoadState('networkidle', { timeout: Math.min(timeout, 5000) }).catch(() => {});
      return { url: page.url(), title: await page.title(), status: response ? response.status() : null };
    }
    case 'click': {
      await page.locator(config.selector).first().click({ timeout });
      return { url: page.url(), title: await page.title() };
    }
    case 'fill': {
      await page.locator(config.selector).first().fill(String(config.value ?? ''), { timeout });
      return { selector: config.selector, filled: true };
    }
    case 'type': {
      await page.locator(config.selector).first().pressSequentially(String(config.value ?? ''), { timeout });
      return { selector: config.selector, typed: String(config.value ?? '').length };
    }
    case 'press': {
      await page.locator(config.selector || 'body').first().press(config.value || 'Enter', { timeout });
      return { pressed: config.value || 'Enter' };
    }
    case 'waitFor': {
      await page.locator(config.selector).first().waitFor({ state: 'visible', timeout });
      return { selector: config.selector, visible: true };
    }
    case 'extractText': {
      return { selector: config.selector, text: (await page.locator(config.selector).first().innerText({ timeout })).trim() };
    }
    case 'extractHtml': {
      return { selector: config.selector, html: await page.locator(config.selector).first().innerHTML({ timeout }) };
    }
    case 'extractAttribute': {
      const value = await page.locator(config.selector).first().getAttribute(config.attribute || 'href', { timeout });
      return { selector: config.selector, attribute: config.attribute || 'href', value };
    }
    case 'evaluate': {
      const result = await page.evaluate(config.expression || 'document.title');
      return { result, url: page.url(), title: await page.title() };
    }
    case 'screenshot': {
      const file = saveScreenshot(await page.screenshot({ fullPage: config.fullPage !== false }), runId);
      return { ...file, url: page.url(), title: await page.title() };
    }
    case 'scroll': {
      await page.mouse.wheel(0, Number(config.value) || 600);
      return { scrolled: Number(config.value) || 600 };
    }
    case 'hover': {
      await page.locator(config.selector).first().hover({ timeout });
      return { hovered: config.selector };
    }
    case 'selectOption': {
      const selected = await page.locator(config.selector).first().selectOption(String(config.value ?? ''), { timeout });
      return { selected };
    }
    case 'setViewport': {
      await page.setViewportSize({ width: Number(config.width) || 1280, height: Number(config.height) || 800 });
      return { viewport: { width: Number(config.width) || 1280, height: Number(config.height) || 800 } };
    }
    default:
      throw new Error(`Unknown browser action "${action}".`);
  }
}

export async function shutdownAllBrowsers() {
  await Promise.all([...sessions.values()].map((e) => e.browser.close().catch(() => {})));
  sessions.clear();
}
