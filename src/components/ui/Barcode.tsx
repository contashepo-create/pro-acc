'use client';

import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

interface BarcodeProps {
  value: string;
  format?: 'CODE128' | 'EAN13' | 'EAN8' | 'UPC' | 'CODE39';
  displayValue?: boolean;
  className?: string;
  width?: number;
  height?: number;
}

export function Barcode({ value, format = 'CODE128', displayValue = true, className, width = 2, height = 60 }: BarcodeProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (svgRef.current && value) {
      try {
        JsBarcode(svgRef.current, value, {
          format,
          displayValue,
          width,
          height,
          fontSize: 14,
          margin: 5,
        });
      } catch (err) {
        console.warn('Barcode generation failed:', err);
      }
    }
  }, [value, format, displayValue, width, height]);

  return <svg ref={svgRef} className={className} />;
}
