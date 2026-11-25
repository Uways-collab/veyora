import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent) &&
    !('standalone' in window.navigator && (window.navigator as Navigator & { standalone?: boolean }).standalone);
}

export function PWAInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    setIos(isIosDevice());
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallEvent(null);
      setDismissed(true);
      setShowIosHelp(false);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === 'accepted') setDismissed(true);
    setInstallEvent(null);
  };

  if (dismissed || (!installEvent && !ios)) return null;

  return (
    <aside className="fixed bottom-4 left-4 right-4 z-[100] mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-xl" aria-label="Install Veyora">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
          <Download className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">Install Veyora</p>
          <p className="mt-1 text-xs leading-5 text-slate-600">Add Veyora to your device for quick, app-like access from your home screen or app launcher.</p>
          {showIosHelp && ios && (
            <p className="mt-2 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-700">
              In Safari, tap the Share button, choose “Add to Home Screen”, then tap “Add”.
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            {installEvent ? (
              <button type="button" onClick={() => void install()} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800">Install app</button>
            ) : (
              <button type="button" onClick={() => setShowIosHelp((value) => !value)} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800">{showIosHelp ? 'Hide instructions' : 'How to install'}</button>
            )}
            <button type="button" onClick={() => setDismissed(true)} className="rounded-lg px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-100">Not now</button>
          </div>
        </div>
        <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss install prompt" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
