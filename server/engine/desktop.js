import path from 'node:path';
import fs from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { FILES_DIR } from '../config.js';

const DISPLAY = process.env.CASCADE_DISPLAY || ':99';
let xvfb = null;

function exec(cmd, args, { timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, env: { ...process.env, DISPLAY }, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message));
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

let available = null;
export async function desktopStatus() {
  if (available) return available;
  const has = (bin) => new Promise((res) => execFile('bash', ['-lc', `command -v ${bin}`], (e, out) => res(!e && Boolean(out.trim()))));
  const [xdotool, xvfbBin, imagemagick] = await Promise.all([has('xdotool'), has('Xvfb'), has('import')]);
  available = {
    display: DISPLAY,
    xdotool, xvfb: xvfbBin, imagemagick,
    platform: process.platform,
    supported: process.platform === 'linux' && xdotool,
  };
  return available;
}

async function displayAlive() {
  try { await exec('xdotool', ['getdisplaygeometry'], { timeout: 4000 }); return true; } catch { return false; }
}

export async function ensureDisplay() {
  const status = await desktopStatus();
  if (!status.supported) {
    throw new Error(`Desktop automation needs Linux with xdotool (found platform ${status.platform}, xdotool=${status.xdotool}). On macOS/Windows use the browser nodes, or run Cascade inside Linux.`);
  }
  if (await displayAlive()) return DISPLAY;
  if (!status.xvfb) throw new Error(`No X display at ${DISPLAY} and Xvfb is not installed.`);
  if (!xvfb) {
    xvfb = spawn('Xvfb', [DISPLAY, '-screen', '0', '1440x900x24', '-nolisten', 'tcp'], { detached: true, stdio: 'ignore' });
    xvfb.unref();
  }
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 150));
    if (await displayAlive()) return DISPLAY;
  }
  throw new Error(`Could not start a virtual display on ${DISPLAY}.`);
}

export async function desktopScreenshot(prefix = 'desktop') {
  await ensureDisplay();
  const status = await desktopStatus();
  if (!status.imagemagick) throw new Error('Screenshot capture needs ImageMagick (import).');
  const name = `${prefix}-${Date.now()}.png`;
  await exec('import', ['-display', DISPLAY, '-window', 'root', path.join(FILES_DIR, name)], { timeout: 20000 });
  return { path: path.join(FILES_DIR, name), url: `/files/${name}` };
}

async function findWindow(titleRegex) {
  const { stdout } = await exec('xdotool', ['search', '--onlyvisible', '--name', titleRegex]);
  const ids = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!ids.length) throw new Error(`No visible window matching "${titleRegex}".`);
  return ids[ids.length - 1];
}

export async function runDesktopAction(config) {
  await ensureDisplay();
  const action = config.action || 'screenshot';

  switch (action) {
    case 'screenshot':
      return desktopScreenshot(`desktop-${String(config.runId || '').slice(0, 6) || 'shot'}`);
    case 'move':
      await exec('xdotool', ['mousemove', String(config.x ?? 0), String(config.y ?? 0)]);
      return { movedTo: [config.x ?? 0, config.y ?? 0] };
    case 'click':
    case 'doubleClick':
    case 'rightClick': {
      const button = action === 'rightClick' ? '3' : '1';
      const repeat = action === 'doubleClick' ? '--repeat' : '';
      const args = ['mousemove', String(config.x ?? 0), String(config.y ?? 0), 'click'];
      if (action === 'doubleClick') args.push('--repeat', '2', '--delay', '120');
      args.push(button);
      await exec('xdotool', args.filter(Boolean));
      return { clicked: [config.x ?? 0, config.y ?? 0], button };
    }
    case 'type': {
      if (config.windowTitle) {
        const id = await findWindow(config.windowTitle);
        await exec('xdotool', ['windowactivate', '--sync', id]);
      }
      await exec('xdotool', ['type', '--clearmodifiers', '--delay', '35', '--', String(config.text ?? '')], { timeout: 60000 });
      return { typed: String(config.text ?? '').length };
    }
    case 'key': {
      if (config.windowTitle) {
        const id = await findWindow(config.windowTitle);
        await exec('xdotool', ['windowactivate', '--sync', id]);
      }
      await exec('xdotool', ['key', '--clearmodifiers', String(config.key || 'Return')]);
      return { pressed: config.key || 'Return' };
    }
    case 'scroll': {
      const amount = Number(config.amount) || 3;
      const button = amount < 0 ? '4' : '5';
      await exec('xdotool', ['mousemove', String(config.x ?? 0), String(config.y ?? 0)]);
      for (let i = 0; i < Math.min(Math.abs(amount), 50); i += 1) {
        await exec('xdotool', ['click', button]);
      }
      return { scrolled: amount };
    }
    case 'launch': {
      if (!config.command) throw new Error('Launch action needs a command.');
      const child = spawn('bash', ['-lc', config.command], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, DISPLAY },
      });
      child.unref();
      await new Promise((r) => setTimeout(r, 1200));
      return { launched: config.command, pid: child.pid };
    }
    case 'activateWindow': {
      const id = await findWindow(config.windowTitle);
      await exec('xdotool', ['windowactivate', '--sync', id]);
      return { activated: id };
    }
    case 'waitForWindow': {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        try {
          const id = await findWindow(config.windowTitle);
          return { found: id, windowTitle: config.windowTitle };
        } catch {
          await new Promise((r) => setTimeout(r, 400));
        }
      }
      throw new Error(`Timed out waiting for a window matching "${config.windowTitle}".`);
    }
    default:
      throw new Error(`Unknown desktop action "${action}".`);
  }
}
