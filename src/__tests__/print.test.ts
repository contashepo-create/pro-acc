/**
 * Regression tests for the shared print helpers.
 *
 * The original print buttons passed `noopener,noreferrer` as window features,
 * which makes `window.open()` return `null` in modern browsers — the button
 * then silently did nothing. These tests pin the behaviour of the corrected
 * helper without needing a browser.
 */
import { openPrintWindow, printCurrentPage } from '@/lib/print';

interface FakeDocument {
  readyState: string;
  open: jest.Mock;
  write: jest.Mock;
  close: jest.Mock;
  images: Array<Record<string, unknown>>;
  fonts: unknown;
}

interface FakeWin {
  opener: unknown;
  setTimeout: (fn: () => void) => number;
  requestAnimationFrame: (fn: () => void) => number;
  focus: jest.Mock;
  print: jest.Mock;
  open: jest.Mock;
  addEventListener: (event: string, callback: () => void) => void;
  document: FakeDocument;
}

function installFakeWindow(openImpl?: () => unknown) {
  const fakeWin: FakeWin = {
    opener: { irrelevant: true },
    setTimeout: (fn: () => void) => {
      fn();
      return 0;
    },
    requestAnimationFrame: (fn: () => void) => {
      fn();
      return 0;
    },
    focus: jest.fn(),
    print: jest.fn(),
    open:
      (openImpl as unknown as jest.Mock) ??
      jest.fn(function open(this: unknown) {
        return fakeWin;
      }),
    addEventListener: () => undefined,
    document: {
      readyState: 'complete',
      open: jest.fn(),
      write: jest.fn(),
      close: jest.fn(),
      images: [] as never[],
      fonts: undefined,
    },
  };
  (globalThis as { window?: unknown; document?: unknown }).window = fakeWin;
  (globalThis as { window?: unknown; document?: unknown }).document = fakeWin.document;
  return fakeWin;
}

describe('openPrintWindow', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown; document?: unknown }).window;
    delete (globalThis as { window?: unknown; document?: unknown }).document;
  });

  it('opens without noopener/noreferrer, writes the document and prints', () => {
    const fakeWin = installFakeWindow();

    const result = openPrintWindow('<h1>طباعة</h1>');

    expect(result).toEqual({ ok: true, blocked: false });
    const features = String(fakeWin.open.mock.calls[0][2]);
    expect(features).not.toMatch(/noopener/i);
    expect(features).not.toMatch(/noreferrer/i);
    expect(fakeWin.document.write).toHaveBeenCalledWith('<h1>طباعة</h1>');
    expect(fakeWin.opener).toBeNull();
    expect(fakeWin.print).toHaveBeenCalled();
  });

  it('waits for a loading print document and fires only once', () => {
    const fakeWin = installFakeWindow();
    fakeWin.document.readyState = 'loading';
    fakeWin.addEventListener = (_event: string, callback: () => void) => { callback(); callback(); };
    expect(openPrintWindow('<p>x</p>')).toEqual({ ok: true, blocked: false });
    expect(fakeWin.print).toHaveBeenCalledTimes(1);
  });

  it('handles popup and document API exceptions', () => {
    installFakeWindow(() => { throw new Error('open'); });
    expect(openPrintWindow('<p>x</p>')).toEqual({ ok: false, blocked: false });
    const fakeWin = installFakeWindow();
    fakeWin.document.open.mockImplementationOnce(() => { throw new Error('document'); });
    expect(openPrintWindow('<p>x</p>')).toEqual({ ok: false, blocked: false });
  });

  it('reports a blocked popup when window.open returns null', () => {
    installFakeWindow(() => null);
    expect(openPrintWindow('<h1>طباعة</h1>')).toEqual({ ok: false, blocked: true });
  });

  it('is safe when window is unavailable (server-side)', () => {
    expect(openPrintWindow('<h1>طباعة</h1>')).toEqual({ ok: false, blocked: false });
  });
});

describe('printCurrentPage', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown; document?: unknown }).window;
    delete (globalThis as { window?: unknown; document?: unknown }).document;
  });

  it('prints the current page after fonts and images are ready', async () => {
    const fakeWin = installFakeWindow();
    await printCurrentPage();
    expect(fakeWin.print).toHaveBeenCalled();
  });

  it('waits for incomplete images through load, error and timeout callbacks', async () => {
    const fakeWin = installFakeWindow();
    const callbacks: Record<string, Array<() => void>> = { load: [], error: [] };
    fakeWin.document.images = [
      { complete: true, naturalWidth: 100, addEventListener: jest.fn() },
      { complete: false, naturalWidth: 0, addEventListener: (event: string, cb: () => void) => callbacks[event].push(cb) },
    ];
    fakeWin.document.fonts = { ready: Promise.resolve() };
    const pending = printCurrentPage();
    // Let the fonts promise schedule waitForImages and register listeners.
    await Promise.resolve();
    await Promise.resolve();
    // Both browser outcomes are idempotent because Promise resolution is one-shot.
    callbacks.load.forEach((callback) => callback());
    callbacks.error.forEach((callback) => callback());
    await pending;
    expect(fakeWin.print).toHaveBeenCalled();
  });

  it('resolves without throwing when window is unavailable', async () => {
    await expect(printCurrentPage()).resolves.toBeUndefined();
  });
});
