import { useEffect, useRef, useState } from 'react';

const CONFIRM_WINDOW_MS = 4000;

/**
 * "Disconnect Google & delete my data" — destructive, so a two-step confirm (click once, button
 * becomes "Confirm delete?" for a few seconds, click again to actually fire) rather than a modal
 * dialog. Radix Popover is already a dependency here; Radix Dialog isn't, and pulling it in for
 * one confirm button isn't worth the extra package.
 */
export function DisconnectAccountButton({ onConfirm }: { onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  function handleClick() {
    if (confirming) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setConfirming(false);
      onConfirm();
      return;
    }
    setConfirming(true);
    timeoutRef.current = setTimeout(() => setConfirming(false), CONFIRM_WINDOW_MS);
  }

  return (
    <button
      onClick={handleClick}
      className={`rounded text-sm underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 ${
        confirming ? 'font-medium text-red-400 hover:text-red-300' : 'text-slate-500 hover:text-slate-300'
      }`}
    >
      {confirming ? 'Confirm delete?' : 'Delete my data'}
    </button>
  );
}
