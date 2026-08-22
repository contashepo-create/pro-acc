import '@testing-library/jest-dom';

// jsdom does not implement matchMedia; several UI components (theme, charts,
// layout) call it. Provide a per-test reset table so tests stay deterministic.
if (typeof window !== 'undefined' && !window.matchMedia) {
  (window as any).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// scrollIntoView is not implemented in jsdom.
if (typeof Element !== 'undefined' && !(Element.prototype as any).scrollIntoView) {
  (Element.prototype as any).scrollIntoView = () => {};
}
