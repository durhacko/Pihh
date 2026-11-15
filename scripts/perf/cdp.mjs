// scripts/perf/cdp.mjs
// A minimal Chrome DevTools Protocol client: launch a headless Chrome that is already on this machine, open one
// page, evaluate scripts, send input, take screenshots. No npm dependency: Node's built-in WebSocket (Node 22+)
// talks to Chrome's debugging port.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

/** Finds a Chrome or Chromium binary: $CHROME_PATH, then Playwright's and Puppeteer's caches, then the PATH. */
export function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const home = homedir();
  const candidates = [];
  const scan = (dir, tail) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir).sort().reverse()) candidates.push(join(dir, entry, ...tail));
  };
  scan(join(home, '.cache', 'ms-playwright'), ['chrome-linux64', 'chrome']);
  scan(join(home, '.cache', 'ms-playwright'), ['chrome-linux', 'chrome']);
  scan(join(home, '.cache', 'puppeteer', 'chrome'), ['chrome-linux64', 'chrome']);
  candidates.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
  const found = candidates.find(path => existsSync(path));
  if (!found) throw new Error('No Chrome found. Set CHROME_PATH, or install one with: npx playwright install chromium');
  return found;
}

/** Launches headless Chrome with a throwaway profile. `gl` picks the graphics path (see QA.md). */
export async function launch({ width = 1440, height = 900, gl = 'auto' } = {}) {
  const binary = findChrome();
  const profile = mkdtempSync(join(tmpdir(), 'encore-perf-'));
  const glFlags = {
    auto: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],   // hardware if Chrome finds it, else SwiftShader
    swiftshader: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    vulkan: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'],
    egl: ['--use-gl=egl', '--ignore-gpu-blocklist'],
  }[gl];
  if (!glFlags) throw new Error(`Unknown --gl ${gl}`);
  const args = [
    '--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', `--window-size=${width},${height}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
    // Without these, a page that is not focused (headless) may be throttled, which would understate fps.
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    ...glFlags, 'about:blank',
  ];
  const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 200 && !existsSync(portFile); i++) await sleep(50);
  if (!existsSync(portFile)) { child.kill(); throw new Error(`Chrome did not start: ${stderr.slice(-800)}`); }
  const [port] = readFileSync(portFile, 'utf8').split('\n');
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const browser = await connect(version.webSocketDebuggerUrl);
  const close = async () => {
    try { await browser.send('Browser.close'); } catch { /* already gone */ }
    child.kill();
    await sleep(200);
    rmSync(profile, { recursive: true, force: true });
  };
  return { browser, binary, version: version.Browser, args, close };
}

/** Opens a page target and returns a session bound to it. */
export async function openPage(browser, { width, height }) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const page = browser.session(sessionId);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  return {
    send: page.send,
    on: page.on,
    async goto(url, timeout = 30000) {
      const loaded = page.once('Page.loadEventFired', timeout);
      await page.send('Page.navigate', { url });
      await loaded;
    },
    /** Evaluates an expression in the page (awaiting promises) and returns its JSON value. Throws page errors. */
    async eval(expression) {
      const result = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(`Page error: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
      return result.result.value;
    },
    async key(key) {
      const code = /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : /^\d$/.test(key) ? `Digit${key}` : key;
      const keyCode = key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0;
      for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: keyCode, text: type === 'keyDown' && key.length === 1 ? key : undefined });
    },
    async click(x, y) {
      for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    },
    async screenshot() {
      const { data } = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      return Buffer.from(data, 'base64');
    },
    close: () => browser.send('Target.closeTarget', { targetId }),
  };
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error(`Cannot connect to ${url}`)); });
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}${message.error.data ? ` (${message.error.data})` : ''}`)); else entry.resolve(message.result);
    } else for (const fn of listeners) fn(message);
  };
  const send = (sessionId) => (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, method });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const session = sessionId => ({
    send: send(sessionId),
    on(method, fn) {
      const listener = m => { if (m.method === method && m.sessionId === sessionId) fn(m.params); };
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    once(method, timeout) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { listeners.delete(listener); reject(new Error(`Timed out waiting for ${method}`)); }, timeout);
        const listener = m => { if (m.method === method && m.sessionId === sessionId) { clearTimeout(timer); listeners.delete(listener); resolve(m.params); } };
        listeners.add(listener);
      });
    },
  });
  return { send: send(undefined), session };
}

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
