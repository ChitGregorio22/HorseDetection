import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Download, Printer, QrCode } from 'lucide-react';

/**
 * Stall QR plate. The QR holds ONLY the horse code in capitals (e.g. HTM-92578BC8), error correction M:
 * that is a version-1 QR (21 x 21 squares), the biggest squares for a given plate size, so the stall camera
 * reads it from farther away. thesisv2.py --qr makes the same plates.
 */
const QR_OPTIONS = { errorCorrectionLevel: 'M' as const, margin: 4, color: { dark: '#000000', light: '#ffffff' } };
const QUIET = 4; // white squares around the QR (standard quiet zone)

export const plateText = (code: string) => code.trim().toUpperCase();

export function qrPng(code: string, width = 1024) {
  return QRCode.toDataURL(plateText(code), { ...QR_OPTIONS, width });
}

/** Size choices: about 11 cm of QR per metre between camera and plate */
const SIZES = [
  { cm: 25, label: '25 cm (recommended, up to ~2.3 m away)' },
  { cm: 20, label: '20 cm (up to ~1.8 m away)' },
  { cm: 13, label: '13 cm (fits A4, up to ~1.2 m away)' },
];

const PAPERS = [
  { name: 'A4', w: 21, h: 29.7 },
  { name: 'A3', w: 29.7, h: 42 },
  { name: 'A2', w: 42, h: 59.4 },
];

/** Plate measurements in cm for a QR (black squares) `qrCm` wide */
export function plateSize(qrCm: number) {
  const module = qrCm / 21;
  const withQuiet = qrCm + 2 * QUIET * module; // white border included
  const textH = Math.max(3, qrCm * 0.28);
  const w = withQuiet + 1; // + 0.5 cm cutting edge each side
  const h = withQuiet + textH + 1;
  const paper = PAPERS.find((p) => w <= p.w - 1 && h <= p.h - 1);
  return { module, withQuiet, textH, w, h, paper: paper?.name ?? null };
}

export async function printQrPlate(name: string, code: string, qrCm: number) {
  const text = plateText(code);
  const svg = await QRCode.toString(text, { ...QR_OPTIONS, type: 'svg' });
  const s = plateSize(qrCm);
  const win = window.open('', '_blank');
  if (!win) throw new Error('Allow pop-ups for this site to print the plate.');
  const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>QR plate ${esc(text)}</title>
<style>
  @page { size: ${s.w.toFixed(1)}cm ${s.h.toFixed(1)}cm; margin: 0; }
  html, body { margin: 0; background: #fff; }
  .plate { box-sizing: border-box; width: ${s.w.toFixed(2)}cm; height: ${s.h.toFixed(2)}cm; padding: 0.5cm;
           border: 0.02cm dashed #bbb; font-family: Arial, Helvetica, sans-serif; text-align: center; }
  .qr svg { display: block; width: ${s.withQuiet.toFixed(2)}cm; height: ${s.withQuiet.toFixed(2)}cm; }
  .name { font-size: ${(s.textH * 0.42).toFixed(2)}cm; font-weight: bold; line-height: 1.1; margin-top: 0.1cm; }
  .code { font-family: "Courier New", monospace; font-size: ${(s.textH * 0.26).toFixed(2)}cm; letter-spacing: 0.05em; }
  .note { position: fixed; top: 8px; left: 8px; right: 8px; font: 14px Arial; background: #fff8d6; border: 1px solid #e0c44c;
          padding: 8px; }
  @media print { .note { display: none; } .plate { border-color: #ddd; } }
</style></head><body>
<div class="note">Print at <b>100% / Actual size</b> (not "Fit to page"). The black QR must measure <b>${qrCm} cm</b> wide.
Plate ${s.w.toFixed(1)} × ${s.h.toFixed(1)} cm${s.paper ? `, fits ${s.paper}` : ' – save as PDF and print at a print shop'}.</div>
<div class="plate"><div class="qr">${svg}</div>
<div class="name">${esc(name)}</div><div class="code">${esc(text)}</div></div>
<script>window.onload = () => setTimeout(() => window.print(), 300);</script>
</body></html>`);
  win.document.close();
}

/** QR preview + "Download QR" + "Print QR plate" with size choice. */
export function QrPlate({ name, code, compact = false }: { name: string; code: string; compact?: boolean }) {
  const [png, setPng] = useState('');
  const [size, setSize] = useState(25);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    qrPng(code, 600).then((url) => !cancelled && setPng(url));
    return () => {
      cancelled = true;
    };
  }, [code]);

  const download = async () => {
    const link = document.createElement('a');
    link.download = `${name.replace(/\s+/g, '-').toLowerCase()}-${plateText(code)}-qr.png`;
    link.href = await qrPng(code, 1200);
    link.click();
  };

  const print = async () => {
    setError('');
    try {
      await printQrPlate(name, code, size);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const s = plateSize(size);
  if (compact) {
    return (
      <div className="flex flex-col items-center text-center">
        {png && (
          <img src={png} alt={`QR code ${plateText(code)} for ${name}`} className="h-28 w-28 bg-white [image-rendering:pixelated]" />
        )}
        <div className="mt-1 font-mono text-sm">{plateText(code)}</div>
        <button
          type="button"
          onClick={print}
          className="mt-2 flex min-h-10 items-center gap-1.5 rounded-lg border-2 border-green-600 bg-white px-3 text-base font-semibold text-green-700 hover:bg-green-50"
        >
          <Printer className="h-4 w-4" /> Print QR plate
        </button>
        {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
      </div>
    );
  }
  return (
    <div className={`flex flex-col items-center text-center ${compact ? '' : 'w-full'}`}>
      <div className="mb-3 flex items-center gap-2 text-green-800">
        <QrCode className="h-6 w-6" />
        <span className="text-lg font-semibold">Stall QR plate</span>
      </div>
      {png && (
        <img
          src={png}
          alt={`QR code ${plateText(code)} for ${name}`}
          className="w-full max-w-[240px] rounded-xl border border-gray-200 bg-white p-2 [image-rendering:pixelated]"
        />
      )}
      <div className="mt-2 text-xl font-semibold">{name}</div>
      <div className="font-mono text-lg">{plateText(code)}</div>
      <p className="mt-2 text-base text-gray-600">
        Contains only the horse ID. Hang it on the stall the horse is in, facing the camera.
      </p>

      <label className="mt-4 w-full text-left text-base text-gray-700">
        QR size (about 11 cm per metre from the camera)
        <select
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          className="mt-1 min-h-12 w-full rounded-lg border-2 border-gray-300 bg-white px-3 text-lg"
        >
          {SIZES.map((o) => (
            <option key={o.cm} value={o.cm}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <p className="mt-1 w-full text-left text-sm text-gray-500">
        Plate {s.w.toFixed(1)} × {s.h.toFixed(1)} cm with white border:{' '}
        {s.paper ? `prints on ${s.paper}` : 'larger than A2, use a print shop'}
        {s.paper && s.paper !== 'A4' ? ' (or save as PDF for a print shop)' : ''}.
      </p>

      <div className="mt-4 grid w-full gap-3">
        <button
          type="button"
          onClick={print}
          className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-green-600 px-5 py-3 text-lg font-semibold text-white hover:bg-green-700"
        >
          <Printer className="h-5 w-5" /> Print QR plate
        </button>
        <button
          type="button"
          onClick={download}
          className="flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 border-gray-300 bg-white px-5 py-3 text-lg font-semibold text-gray-800 hover:bg-gray-100"
        >
          <Download className="h-5 w-5" /> Download QR image
        </button>
      </div>
      {error && <p className="mt-2 text-base text-red-700">{error}</p>}
    </div>
  );
}
