'use client';

/** Floating screen-only print button. Global @media print rules in
 *  globals.css hide it (and all app chrome) when printing. */
export function PrintButton({ label = '🖨️ طباعة / PDF' }: { label?: string }) {
  return (
    <div className="no-print fixed bottom-4 left-4 z-40">
      <button
        onClick={() => window.print()}
        className="bg-blue-600 hover:bg-blue-500 text-white rounded-xl px-4 py-2 text-sm shadow-lg"
      >
        {label}
      </button>
    </div>
  );
}
