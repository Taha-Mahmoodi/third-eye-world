import { test, expect } from '@playwright/test';

// Phase 3 task 5 per INSTRUCTIONS.md § 9: voice-selection test page.
//
// This file proves the page renders, the four candidate buttons are
// keyboard-reachable with accessible names, and the live region exists
// with the correct ARIA. It does NOT actually play audio — that requires
// the ElevenLabs API key and a real voice review (the human audit).

test.describe('/_internal/voices', () => {
  test('lists the four candidate voices with accessible names', async ({ page }) => {
    await page.goto('/_internal/voices/');

    await expect(page.getByRole('heading', { name: 'Voice selection' })).toBeVisible();

    for (const name of ['Rachel', 'Bella', 'Adam', 'Antoni']) {
      const btn = page.getByRole('button', { name: new RegExp(`Play ${name} voice`) });
      await expect(btn).toBeVisible();
    }

    const live = page.locator('#status');
    await expect(live).toHaveAttribute('role', 'status');
    await expect(live).toHaveAttribute('aria-live', 'polite');
  });

  test('all four candidates are reachable via Tab', async ({ page }) => {
    await page.goto('/_internal/voices/');

    // Focus moves through the four candidates in order.
    for (const name of ['Rachel', 'Bella', 'Adam', 'Antoni']) {
      await page.keyboard.press('Tab');
      const focused = page.getByRole('button', { name: new RegExp(`Play ${name} voice`) });
      await expect(focused).toBeFocused();
    }
  });
});
