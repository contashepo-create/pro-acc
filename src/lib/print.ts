/**
 * Client-side print helpers shared by every print button in the app.
 *
 * IMPORTANT: never pass `noopener` / `noreferrer` as `window.open` window
 * features. Modern browsers make `window.open()` return `null` when either of
 * those features is present, so the caller loses the handle it needs to write
 * and print the document — the button silently does nothing. We sever the
 * opener reference manually after opening instead, which keeps the same
 * security property (the print window cannot reach back into the app).
 */

export interface OpenPrintWindowOptions {
  width?: number;
  height?: number;
}

export interface OpenPrintWindowResult {
  ok: boolean;
  /** The popup was blocked by the browser (user action needed). */
  blocked: boolean;
}

export function openPrintWindow(
  html: string,
  options: OpenPrintWindowOptions = {},
): OpenPrintWindowResult {
  if (typeof window === 'undefined') return { ok: false, blocked: false };

  const { width = 800, height = 900 } = options;

  let printWindow: Window | null = null;
  try {
    printWindow = window.open(
      '',
      '_blank',
      `width=${width},height=${height},scrollbars=yes,resizable=yes`,
    );
  } catch {
    return { ok: false, blocked: false };
  }

  if (!printWindow) return { ok: false, blocked: true };
  const targetWindow = printWindow;

  try {
    targetWindow.document.open();
    targetWindow.document.write(html);
    targetWindow.document.close();
    try {
      targetWindow.opener = null;
    } catch {
      /* best-effort only */
    }
    targetWindow.focus();

    const trigger = () => {
      try {
        targetWindow.focus();
        targetWindow.print();
      } catch {
        /* ignore */
      }
    };

    const schedule = () => {
      window.setTimeout(trigger, 120);
    };

    // Wait for the freshly written document to finish loading before opening
    // the (blocking) print dialog, otherwise some browsers print a blank page.
    if (printWindow.document.readyState === 'complete') {
      schedule();
    } else {
      let fired = false;
      const fire = () => {
        if (fired) return;
        fired = true;
        schedule();
      };
      printWindow.addEventListener('load', fire, { once: true });
      // Safety net in case the load event was missed.
      window.setTimeout(fire, 1200);
    }
    return { ok: true, blocked: false };
  } catch {
    return { ok: false, blocked: false };
  }
}

/**
 * Prints the current page after web fonts and images have finished loading so
 * the printed output is complete (logos, ZATCA QR codes, and Arabic fonts
 * render instead of printing placeholders or blank squares).
 */
export function printCurrentPage(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();

  const waitForImages = () =>
    Promise.all(
      Array.from(document.images).map((img) => {
        if (img.complete && img.naturalWidth > 0) return Promise.resolve();
        return new Promise<void>((resolve) => {
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
          window.setTimeout(resolve, 3000);
        });
      }),
    );

  const fontsReady: Promise<unknown> =
    typeof document.fonts?.ready !== 'undefined'
      ? Promise.race([
          document.fonts.ready,
          new Promise<void>((resolve) => window.setTimeout(resolve, 1500)),
        ])
      : Promise.resolve();

  return fontsReady
    .then(waitForImages)
    .then(() => {
      // Give the browser one paint before the blocking print dialog opens.
      window.requestAnimationFrame(() => {
        window.setTimeout(() => window.print(), 60);
      });
    });
}
