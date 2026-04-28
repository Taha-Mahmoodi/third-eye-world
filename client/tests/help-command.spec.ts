import { test, expect } from '@playwright/test';

// Phase 2 task 6 per INSTRUCTIONS.md § 9: "Says the command list when user
// says 'help.'"
//
// The voice path (parseCommand("help") → dispatchCommand(HELP) → speak)
// already has unit + parser + dispatcher tests. This file is the
// integration-level proof that the keyboard equivalent ("?" per the
// voice-grammar skill) reaches the live region with the right text in a
// real browser, end-to-end.

const HELP_TEXT_PREFIX = 'Try record, post, next, like, comment, or stop';

test.describe('Help command', () => {
  test.beforeEach(async ({ page }) => {
    // Silence SpeechSynthesis so the test runner does not try to actually
    // speak, but still let our code call it. The keyboard path is what we
    // are exercising — the live region is the assertion surface.
    //
    // SpeechRecognition is stubbed with a black-hole class that never fires
    // any events. main.ts calls listener.start() on load; without this
    // stub, real Chromium fires spurious empty-transcript results that
    // race the keyboard handler and overwrite the live region with
    // STRINGS.UNKNOWN_COMMAND.
    await page.addInitScript(() => {
      class FakeUtterance {
        text: string;
        rate = 1;
        pitch = 1;
        constructor(text: string) {
          this.text = text;
        }
      }
      // window.speechSynthesis is a getter on the prototype in real
      // browsers — simple assignment doesn't replace it. Use
      // defineProperty to force-override.
      Object.defineProperty(window, 'speechSynthesis', {
        value: {
          speak: () => undefined,
          cancel: () => undefined,
        },
        configurable: true,
        writable: true,
      });
      Object.defineProperty(window, 'SpeechSynthesisUtterance', {
        value: FakeUtterance,
        configurable: true,
        writable: true,
      });

      class BlackHoleRecognition extends EventTarget {
        continuous = false;
        interimResults = false;
        lang = '';
        start(): void {
          /* no-op */
        }
        stop(): void {
          /* no-op */
        }
        abort(): void {
          /* no-op */
        }
      }
      Object.defineProperty(window, 'SpeechRecognition', {
        value: BlackHoleRecognition,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(window, 'webkitSpeechRecognition', {
        value: BlackHoleRecognition,
        configurable: true,
        writable: true,
      });
    });
  });

  test('pressing "?" announces the help list in the live region', async ({ page }) => {
    await page.goto('/');

    const status = page.locator('#status');
    await expect(status).toHaveAttribute('role', 'status');
    await expect(status).toHaveAttribute('aria-live', 'polite');

    // Dispatch a synthetic keydown directly so the test does not depend on
    // Playwright's translation from character to key event (which varies
    // across keyboard layouts in CI).
    await page.evaluate(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true }),
      );
    });

    await expect(status).toContainText(HELP_TEXT_PREFIX);
    await expect(status).toContainText('Say help any time');
  });

  test('pressing Escape cancels and announces "Cancelled."', async ({ page }) => {
    // Sanity check that the kill-switch keyboard equivalent (§ 2 #5) reaches
    // the live region too — this is the second-most-important keyboard
    // shortcut after help, and bundling it here keeps the spec compact.
    await page.goto('/');

    const status = page.locator('#status');
    await page.evaluate(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });

    await expect(status).toContainText('Cancelled');
  });

  test('Tab navigation reaches the record button', async ({ page }) => {
    // Phase 2 audit: voice + keyboard reach feature parity. The button must
    // be reachable by Tab so the keyboard-only user can also click it.
    await page.goto('/');

    await page.keyboard.press('Tab');
    const button = page.getByRole('button', { name: /start recording a memo/i });
    await expect(button).toBeFocused();
  });
});
