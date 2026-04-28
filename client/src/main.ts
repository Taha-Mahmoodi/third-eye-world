// Phase 0 client skeleton.
//
// The point of this file is to prove the wiring works: one accessible
// <button>, one polite live region, one click handler that announces
// state via aria-live. Real recording lands in Phase 1 (feature/audio-recorder)
// and real spoken feedback in Phase 1 task 7 (feature/spoken-feedback-fallback).
//
// Hard rules already enforced here (INSTRUCTIONS.md § 2):
// - No spoken phrase is inlined; the placeholder string below moves to
//   client/src/strings.ts in Phase 1 (feat/strings-file). The constant
//   sits at module scope as a stand-in until then.

const STATUS_RECORDING_PLACEHOLDER =
  'Recording will be wired up in Phase 1.';

function announce(message: string): void {
  const status = document.getElementById('status');
  if (!status) return;
  status.textContent = message;
}

function init(): void {
  const button = document.getElementById('record');
  if (!(button instanceof HTMLButtonElement)) return;

  button.addEventListener('click', () => {
    announce(STATUS_RECORDING_PLACEHOLDER);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
