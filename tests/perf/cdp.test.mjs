import { EventEmitter } from 'node:events';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connect, launch } from '../../scripts/perf/cdp.mjs';

const fileError = code => Object.assign(new Error(`filesystem ${code}`), { code });
function fixture() {
  const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, stderr: new EventEmitter() });
  child.unref = vi.fn(); child.stderr.destroy = vi.fn();
  const browser = { send: vi.fn(async () => ({})), dispose: vi.fn() };
  child.kill = vi.fn(() => { child.exitCode = 0; child.emit('exit', 0); return true; });
  const root = resolve('mock-temp');
  const profile = join(root, 'encore-perf-owned');
  const io = {
    findChrome: () => 'mock-chrome', tmpdir: () => root, mkdtempSync: vi.fn(() => profile),
    spawn: vi.fn(() => child), readFileSync: vi.fn(() => '9222\n/devtools/browser/owned\n'),
    rmSync: vi.fn(), sleep: vi.fn(async () => {}), warn: vi.fn(),
    fetch: vi.fn(async () => ({ ok: true, json: async () => ({ Browser: 'Mock Chrome', webSocketDebuggerUrl: 'ws://mock' }) })),
    connect: vi.fn(async () => browser),
    limits: { startupAttempts: 4, cleanupAttempts: 3, retryMs: 1, operationMs: 15, closeMs: 2, exitMs: 3 },
  };
  return { io, child, browser, profile };
}
afterEach(() => vi.useRealTimers());

describe('isolated Chrome launch lifecycle (no real filesystem, browser or network)', () => {
  it('retries missing/locked/partially written port files until both lines are complete', async () => {
    const { io, profile } = fixture();
    io.readFileSync.mockImplementationOnce(() => { throw fileError('ENOENT'); })
      .mockImplementationOnce(() => { throw fileError('EBUSY'); }).mockReturnValueOnce('9222\n');
    const result = await launch({}, io);
    expect(io.readFileSync).toHaveBeenCalledTimes(4);
    expect(io.fetch).toHaveBeenCalledWith('http://127.0.0.1:9222/json/version', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(io.sleep).toHaveBeenCalledTimes(3);
    await result.close();
    expect(io.rmSync).toHaveBeenCalledExactlyOnceWith(profile, { recursive: true, force: true });
  });
  it('bounds locked/invalid startup exhaustion, terminates its child and cleans only its own profile', async () => {
    const { io, child, profile } = fixture();
    io.readFileSync.mockImplementation(() => { throw fileError('EPERM'); });
    await expect(launch({}, io)).rejects.toThrow(/exhausted 4 attempts: EPERM/);
    expect(io.readFileSync).toHaveBeenCalledTimes(4);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(io.fetch).not.toHaveBeenCalled();
    expect(io.rmSync).toHaveBeenCalledExactlyOnceWith(profile, { recursive: true, force: true });
  });
  it('rejects an unexpected filesystem error immediately and preserves the original cause during cleanup failure', async () => {
    const { io, child } = fixture();
    const original = fileError('EIO');
    io.readFileSync.mockImplementation(() => { throw original; });
    io.rmSync.mockImplementation(() => { throw fileError('EACCES'); });
    const error = await launch({}, io).catch(error => error);
    expect(error.cause).toBe(original);
    expect(io.readFileSync).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(io.warn).toHaveBeenCalledWith(expect.stringContaining('startup cleanup failed'));
  });
  it('handles spawn exceptions and emitted spawn errors without leaked children/profiles', async () => {
    const first = fixture();
    first.io.spawn.mockImplementation(() => { throw new Error('spawn denied'); });
    await expect(launch({}, first.io)).rejects.toThrow('spawn denied');
    expect(first.io.rmSync).toHaveBeenCalledTimes(1);
    const second = fixture();
    second.io.readFileSync.mockImplementation(() => { throw fileError('ENOENT'); });
    second.io.sleep.mockImplementationOnce(async () => {
      second.child.emit('error', new Error('spawn ENOENT'));
      second.child.emit('close');
    });
    await expect(launch({}, second.io)).rejects.toThrow('spawn ENOENT');
    expect(second.io.rmSync).toHaveBeenCalledTimes(1);
    expect(second.child.listenerCount('error')).toBe(0);
  });
  it('validates graphics mode before allocating a profile and refuses an unexpected generated path', async () => {
    const { io } = fixture();
    await expect(launch({ gl: 'invalid' }, io)).rejects.toThrow('Unknown --gl');
    expect(io.mkdtempSync).not.toHaveBeenCalled();
    io.mkdtempSync.mockReturnValue(resolve('outside-profile'));
    await expect(launch({}, io)).rejects.toThrow('Refusing cleanup');
    expect(io.spawn).not.toHaveBeenCalled(); expect(io.rmSync).not.toHaveBeenCalled();
  });
  it('waits for child exit before deletion, retries Windows profile locks and closes idempotently', async () => {
    vi.useFakeTimers();
    const { io, child, browser } = fixture();
    io.limits.exitMs = 20;
    child.kill.mockImplementation(() => { setTimeout(() => { child.exitCode = 0; child.emit('exit', 0); }, 10); return true; });
    io.rmSync.mockImplementationOnce(() => { expect(child.exitCode).toBe(0); throw fileError('EPERM'); })
      .mockImplementationOnce(() => { throw fileError('EBUSY'); });
    const result = await launch({}, io);
    const closed = result.close(); expect(result.close()).toBe(closed);
    await vi.advanceTimersByTimeAsync(9); expect(io.rmSync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); await closed;
    expect(io.rmSync).toHaveBeenCalledTimes(3); expect(browser.dispose).toHaveBeenCalledTimes(1);
    expect(child.listenerCount('exit')).toBe(0); expect(io.warn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds a hanging Browser.close, escalates only its own child and retains profile if exit cannot be confirmed', async () => {
    vi.useFakeTimers();
    const { io, child, browser } = fixture();
    browser.send.mockImplementation(() => new Promise(() => {}));
    child.kill.mockReturnValue(true).mockImplementation(() => true);
    const result = await launch({}, io); const closed = result.close();
    await vi.advanceTimersByTimeAsync(8); await closed;
    expect(browser.dispose).toHaveBeenCalledTimes(1);
    expect(child.kill.mock.calls).toEqual([[], ['SIGKILL']]);
    expect(io.rmSync).not.toHaveBeenCalled();
    expect(io.warn).toHaveBeenCalledWith(expect.stringContaining('profile retained'));
    expect(child.unref).toHaveBeenCalledTimes(1); expect(child.stderr.destroy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('reports persistent cleanup locks without rejecting a successfully closed browser', async () => {
    const { io } = fixture();
    io.rmSync.mockImplementation(() => { throw fileError('ENOTEMPTY'); });
    const result = await launch({}, io); await expect(result.close()).resolves.toBeUndefined();
    expect(io.rmSync).toHaveBeenCalledTimes(3);
    expect(io.warn).toHaveBeenCalledWith(expect.stringContaining('cleanup remained locked'));
  });
  it('cleans the launched child/profile when version lookup or connection fails, including bounded fetch', async () => {
    const first = fixture(); first.io.connect.mockRejectedValue(new Error('handshake refused'));
    await expect(launch({}, first.io)).rejects.toThrow('handshake refused');
    expect(first.child.kill).toHaveBeenCalledTimes(1); expect(first.io.rmSync).toHaveBeenCalledTimes(1);
    vi.useFakeTimers();
    const second = fixture(); second.io.fetch.mockImplementation(() => new Promise(() => {}));
    const pending = expect(launch({}, second.io)).rejects.toThrow('version endpoint timed out');
    await vi.advanceTimersByTimeAsync(15); await pending;
    expect(second.io.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(second.child.kill).toHaveBeenCalledTimes(1); expect(second.io.rmSync).toHaveBeenCalledTimes(1);
  });
});

describe('CDP websocket lifetime (in-memory socket)', () => {
  function socketClass(open = true) {
    return class {
      static instance;
      constructor() { this.constructor.instance = this; if (open) queueMicrotask(() => this.onopen?.()); }
      close = vi.fn();
      send = vi.fn();
    };
  }
  it('bounds handshake failure and closes the socket', async () => {
    vi.useFakeTimers(); const Socket = socketClass(false);
    const pending = expect(connect('ws://mock', { WebSocketImpl: Socket, timeout: 5 })).rejects.toThrow('connection timed out');
    await vi.advanceTimersByTimeAsync(5); await pending;
    expect(Socket.instance.close).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects outstanding commands/events on dispose and clears their timers/listeners', async () => {
    vi.useFakeTimers(); const Socket = socketClass();
    const browser = await connect('ws://mock', { WebSocketImpl: Socket, timeout: 5 });
    const command = expect(browser.send('Runtime.enable')).rejects.toThrow('websocket closed');
    const event = expect(browser.session('one').once('Page.loadEventFired', 20)).rejects.toThrow('websocket closed');
    browser.dispose(); browser.dispose(); await command; await event;
    expect(Socket.instance.close).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    await expect(browser.send('Runtime.enable')).rejects.toThrow('websocket closed');
  });
  it('resolves replies, bounds unanswered commands and rejects on remote disconnect', async () => {
    vi.useFakeTimers(); const Socket = socketClass();
    const browser = await connect('ws://mock', { WebSocketImpl: Socket, timeout: 5 });
    const first = browser.send('Runtime.enable');
    Socket.instance.onmessage({ data: JSON.stringify({ id: 1, result: { enabled: true } }) });
    await expect(first).resolves.toEqual({ enabled: true });
    const timed = expect(browser.send('Page.enable')).rejects.toThrow('Timed out');
    await vi.advanceTimersByTimeAsync(5); await timed;
    const last = expect(browser.send('Runtime.evaluate')).rejects.toThrow('websocket closed');
    Socket.instance.onclose(); await last;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('preserves Runtime.evaluate measurements longer than ten seconds while lifecycle requests stay bounded', async () => {
    vi.useFakeTimers(); const Socket = socketClass();
    const browser = await connect('ws://mock', { WebSocketImpl: Socket, timeout: 10000 });
    const evaluation = browser.send('Runtime.evaluate', { expression: 'long caller-owned measurement' });
    const ordinary = expect(browser.send('Page.enable')).rejects.toThrow('Timed out');
    await vi.advanceTimersByTimeAsync(20000); await ordinary;
    Socket.instance.onmessage({ data: JSON.stringify({ id: 1, result: { result: { value: 42 } } }) });
    await expect(evaluation).resolves.toEqual({ result: { value: 42 } });
    browser.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
});
