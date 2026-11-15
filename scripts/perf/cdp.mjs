// scripts/perf/cdp.mjs
// A minimal Chrome DevTools Protocol client: launch a headless Chrome that is already on this machine, open one
// page, evaluate scripts, send input, take screenshots. No npm dependency: Node's built-in WebSocket (Node 22+)
// talks to Chrome's debugging port.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

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
export async function launch({ width = 1440, height = 900, gl = 'auto' } = {}, injected = {}) {
  // Optional primitives make process/filesystem races testable without starting a browser.
  const io = { findChrome, mkdtempSync, tmpdir, spawn, readFileSync, rmSync, fetch: globalThis.fetch,
    connect, sleep, warn: message => console.warn(message), ...injected };
  const limits = { startupAttempts: 200, retryMs: 50, operationMs: 10000, closeMs: 1000,
    exitMs: 2000, cleanupAttempts: 20, ...injected.limits };
  const glFlags = {
    auto: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],   // hardware if Chrome finds it, else SwiftShader
    swiftshader: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    vulkan: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'],
    egl: ['--use-gl=egl', '--ignore-gpu-blocklist'],
  }[gl];
  if (!glFlags) throw new Error(`Unknown --gl ${gl}`);
  const binary = io.findChrome();
  const tempRoot = resolve(io.tmpdir());
  const profile = resolve(io.mkdtempSync(join(tempRoot, 'encore-perf-')));
  // Cleanup is restricted to precisely this launch's mkdtemp directory, never a caller-supplied path.
  if (dirname(profile) !== tempRoot || !basename(profile).startsWith('encore-perf-')) {
    throw new Error(`Refusing cleanup outside the generated Chrome profile: ${profile}`);
  }
  const args = [
    '--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', `--window-size=${width},${height}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
    // Without these, a page that is not focused (headless) may be throttled, which would understate fps.
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    ...glFlags, 'about:blank',
  ];
  let child;
  let browser;
  let childError;
  let exited = false;
  let closing;
  let stderr = '';
  const onError = error => { childError = error; };
  const onExit = () => { exited = true; };
  const onData = chunk => { stderr = (stderr + chunk).slice(-800); };
  const isExited = () => exited || (child && (child.exitCode !== null || child.signalCode !== null));
  const waitExit = async () => {
    if (!child || isExited()) return true;
    return new Promise(resolveWait => {
      const finish = () => { clearTimeout(timer); child.removeListener('exit', finish); resolveWait(isExited()); };
      const timer = setTimeout(finish, limits.exitMs);
      child.once('exit', finish);
    });
  };
  const close = () => closing ??= (async () => {
    try {
      if (browser && !isExited()) {
        try { await bounded(browser.send('Browser.close'), limits.closeMs, 'Browser.close'); } catch { /* terminate below */ }
      }
    } finally {
      try { browser?.dispose?.(); } catch (error) { io.warn(`Chrome websocket cleanup failed: ${error.message}`); }
    }
    if (child && !isExited()) {
      child.kill();
      if (!await waitExit()) { child.kill('SIGKILL'); await waitExit(); }
    }
    if (child && !isExited()) {
      io.warn(`Chrome did not exit after bounded termination; profile retained: ${profile}`);
      // Do not pin an otherwise finished recorder forever if the OS cannot terminate this child.
      child.unref?.();
      child.stderr?.destroy?.();
      return;
    }
    child?.removeListener('error', onError);
    child?.removeListener('exit', onExit);
    child?.removeListener('close', onExit);
    child?.stderr?.removeListener('data', onData);
    for (let attempt = 0; attempt < limits.cleanupAttempts; attempt++) {
      try { io.rmSync(profile, { recursive: true, force: true }); return; }
      catch (error) {
        if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error.code)) throw error;
        if (attempt + 1 === limits.cleanupAttempts) {
          io.warn(`Chrome exited but profile cleanup remained locked (${error.code}): ${profile}`);
          return;
        }
        await io.sleep(limits.retryMs);
      }
    }
  })();
  try {
    child = io.spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    child.on('error', onError);
    child.on('exit', onExit);
    child.on('close', onExit);
    child.stderr?.on('data', onData);
    const portFile = join(profile, 'DevToolsActivePort');
    let port;
    let last = 'port file missing or incomplete';
    for (let attempt = 0; attempt < limits.startupAttempts; attempt++) {
      if (childError) throw childError;
      if (isExited()) throw new Error(`Chrome exited before startup (${child.exitCode ?? child.signalCode})`);
      try {
        const [line, endpoint] = io.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
        const candidate = Number(line);
        if (/^\d+$/.test(line) && Number.isInteger(candidate) && candidate > 0 && candidate <= 65535 && endpoint?.startsWith('/devtools/browser/')) {
          port = candidate; break;
        }
        last = 'DevToolsActivePort is incomplete or invalid';
      } catch (error) {
        if (!['ENOENT', 'EBUSY', 'EPERM'].includes(error.code)) throw error;
        last = `${error.code} reading DevToolsActivePort`;
      }
      if (attempt + 1 < limits.startupAttempts) await io.sleep(limits.retryMs);
    }
    if (!port) throw new Error(`Chrome startup exhausted ${limits.startupAttempts} attempts: ${last}`);
    const controller = new AbortController();
    let version;
    try {
      version = await bounded((async () => {
        const response = await io.fetch(`http://127.0.0.1:${port}/json/version`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Chrome version endpoint returned HTTP ${response.status}`);
        return response.json();
      })(), limits.operationMs, 'Chrome version endpoint');
    } finally { controller.abort(); }
    browser = await io.connect(version.webSocketDebuggerUrl, { timeout: limits.operationMs });
    return { browser, binary, version: version.Browser, args, close };
  } catch (error) {
    try { await close(); } catch (cleanupError) {
      io.warn(`Chrome startup cleanup failed: ${cleanupError.message}`);
    }
    throw new Error(`Chrome did not start: ${error.message}${stderr ? `\n${stderr}` : ''}`, { cause: error });
  }
}

async function bounded(promise, timeout, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeout} ms`)), timeout);
    })]);
  } finally { clearTimeout(timer); }
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

export async function connect(url, { timeout = 10000, WebSocketImpl = WebSocket } = {}) {
  const ws = new WebSocketImpl(url);
  try {
    await bounded(new Promise((resolveOpen, reject) => {
      ws.onopen = resolveOpen;
      ws.onerror = () => reject(new Error(`Cannot connect to ${url}`));
      ws.onclose = () => reject(new Error(`Connection closed before opening ${url}`));
    }), timeout, 'Chrome websocket connection');
  } catch (error) {
    ws.onopen = ws.onerror = ws.onclose = null;
    try { ws.close(); } catch { /* already closed */ }
    throw error;
  }
  ws.onopen = null;
  let nextId = 1;
  let closed = false;
  const pending = new Map();
  const listeners = new Set();
  const waiters = new Set();
  const dispose = () => {
    if (closed) return;
    closed = true;
    const error = new Error('Chrome websocket closed');
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    pending.clear();
    for (const entry of waiters) { clearTimeout(entry.timer); entry.reject(error); }
    waiters.clear(); listeners.clear();
    ws.onmessage = ws.onerror = ws.onclose = null;
    try { ws.close(); } catch { /* already closed */ }
  };
  ws.onerror = ws.onclose = dispose;
  ws.onmessage = event => {
    let message;
    try { message = JSON.parse(event.data); } catch { dispose(); return; }
    if (message.id !== undefined) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}${message.error.data ? ` (${message.error.data})` : ''}`)); else entry.resolve(message.result);
    } else for (const fn of listeners) fn(message);
  };
  const send = (sessionId) => (method, params = {}) => new Promise((resolve, reject) => {
    if (closed) { reject(new Error('Chrome websocket closed')); return; }
    const id = nextId++;
    // Evaluations include callers' multi-second RAF measurements / tick waits. Preserve their own
    // duration policy; disconnect/dispose still rejects them. Lifecycle and ordinary CDP requests are bounded.
    const timer = method === 'Runtime.evaluate' ? undefined
      : setTimeout(() => { pending.delete(id); reject(new Error(`Timed out waiting for ${method}`)); }, timeout);
    pending.set(id, { resolve, reject, method, timer });
    try { ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
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
        if (closed) { reject(new Error('Chrome websocket closed')); return; }
        const entry = { reject, timer: undefined };
        const clear = () => { clearTimeout(entry.timer); listeners.delete(listener); waiters.delete(entry); };
        entry.timer = setTimeout(() => { clear(); reject(new Error(`Timed out waiting for ${method}`)); }, timeout);
        const listener = m => { if (m.method === method && m.sessionId === sessionId) { clear(); resolve(m.params); } };
        waiters.add(entry);
        listeners.add(listener);
      });
    },
  });
  return { send: send(undefined), session, dispose };
}

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
