/**
 * Regression tests for the shared print helpers.
 *
 * The original print buttons passed `noopener,noreferrer` as window features,
 * which makes `window.open()` return `null` in modern browsers — the button
 * then silently did nothing. These tests pin the behaviour of the corrected
 * helper without needing a browser.
 */
import { openPrintWindow, printCurrentPage } from '@/lib/print';

function installFakeWindow(openImpl?: () => unknown) {
  const fakeWin: any = {
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
      openImpl ??
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
  (global as any).window = fakeWin;
  (global as any).document = fakeWin.document;
  return fakeWin;
}

describe('openPrintWindow', () => {
  afterEach(() => {
    delete (global as any).window;
    delete (global as any).document;
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
    delete (global as any).window;
    delete (global as any).document;
  });

  it('prints the current page after fonts and images are ready', async () => {
    const fakeWin = installFakeWindow();
    await printCurrentPage();
    expect(fakeWin.print).toHaveBeenCalled();
  });

  it('resolves without throwing when window is unavailable', async () => {
    await expect(printCurrentPage()).resolves.toBeUndefined();
  });
});
