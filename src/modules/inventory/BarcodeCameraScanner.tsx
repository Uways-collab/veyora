import { useEffect, useRef, useState } from 'react';
import { ScanLine, X } from 'lucide-react';

type BarcodeDetectorLike = {
  detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>;
};
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

export function BarcodeCameraScanner({ onDetected }: { onDetected: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    let frame = 0;
    let stream: MediaStream | null = null;

    const stop = () => {
      stopped = true;
      if (frame) cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    };

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError('Camera access is unavailable in this browser. Enter the barcode in the search field instead.');
          return;
        }
        const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
        if (!Detector) {
          setError('This browser does not support automatic barcode detection. Enter the barcode in the search field instead.');
          return;
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (stopped) { stream.getTracks().forEach((track) => track.stop()); return; }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        const detector = new Detector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'] });
        const scanFrame = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const results = await detector.detect(videoRef.current);
            const value = results.find((item) => item.rawValue?.trim())?.rawValue?.trim();
            if (value) {
              onDetectedRef.current(value);
              setOpen(false);
              return;
            }
          } catch {
            // A transient frame decode failure should not stop the camera loop.
          }
          if (!stopped) frame = requestAnimationFrame(() => { void scanFrame(); });
        };
        frame = requestAnimationFrame(() => { void scanFrame(); });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not open the camera. Check browser camera permission.');
      }
    };

    setError(null);
    void start();
    return stop;
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => { setError(null); setOpen(true); }} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50" aria-label="Scan barcode with camera">
        <ScanLine className="h-3.5 w-3.5" /> Scan barcode
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true" aria-label="Barcode scanner">
          <section className="w-full max-w-lg space-y-3 rounded-xl bg-white p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Scan product barcode</h2>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close scanner"><X className="h-4 w-4" /></button>
            </div>
            <video ref={videoRef} muted playsInline className="aspect-video w-full rounded-lg bg-slate-950 object-cover" />
            <p className="text-xs text-slate-600">Hold the barcode steady inside the camera view. A successful scan fills the product search automatically.</p>
            {error && <p role="alert" className="rounded-md bg-amber-50 p-3 text-xs text-amber-800">{error}</p>}
            <button type="button" onClick={() => setOpen(false)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700">Close scanner</button>
          </section>
        </div>
      )}
    </>
  );
}
