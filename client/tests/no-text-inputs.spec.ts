import { test, expect } from '@playwright/test';

// Phase 6 task 2 per INSTRUCTIONS.md § 9 + § 2 hard rule #8 + § 6.2.
//
// "No `<input type="text">` anywhere in the app." This test crashes CI if
// one ever sneaks in — for the home screen and the voice-selection page.
// Adding new pages that introduce a text input is a fail at audit, not
// just a unit-test oversight.
//
// Why we don't allow them: the listener is blind by default. A text input
// implies a sighted-user-with-keyboard interaction model that crowds out
// the voice + button + spoken-feedback contract. The exact rule is
// strict, not "minimize" — see INSTRUCTIONS.md § 19.

const PAGES = ['/', '/_internal/voices/'];

const FORBIDDEN_INPUT_TYPES = [
  'text',
  // The intent of the rule is no free-form keyboard text. Variants:
  'search',
  'email',
  'tel',
  'url',
  'password',
];

for (const path of PAGES) {
  test(`${path} has zero free-form text inputs`, async ({ page }) => {
    await page.goto(path);
    for (const type of FORBIDDEN_INPUT_TYPES) {
      const count = await page.locator(`input[type="${type}"]`).count();
      expect(count, `${path} contains <input type="${type}">`).toBe(0);
    }
    // Bare <input> defaults to type="text" on submit; also forbidden.
    const bareInputs = await page.locator('input:not([type])').count();
    expect(bareInputs, `${path} contains a bare <input>`).toBe(0);
    // <textarea> is also disallowed — same rationale.
    const textareas = await page.locator('textarea').count();
    expect(textareas, `${path} contains a <textarea>`).toBe(0);
    // contenteditable elements are similarly disallowed.
    const editables = await page.locator('[contenteditable="true"]').count();
    expect(editables, `${path} contains a contenteditable element`).toBe(0);
  });
}
