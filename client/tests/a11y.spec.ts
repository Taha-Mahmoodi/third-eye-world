import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Accessibility (axe-core)', () => {
  test('home screen has 0 axe violations', async ({ page }) => {
    await page.goto('/');

    const recordButton = page.getByRole('button', { name: /start recording a memo/i });
    await expect(recordButton).toBeVisible();

    const liveRegion = page.locator('#status');
    await expect(liveRegion).toHaveAttribute('role', 'status');
    await expect(liveRegion).toHaveAttribute('aria-live', 'polite');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
