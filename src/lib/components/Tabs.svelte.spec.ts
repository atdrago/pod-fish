import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Tabs from './Tabs.svelte';

describe('the tabs', () => {
  it('names both tabs and marks the current one', async () => {
    const screen = await render(Tabs, { pathname: '/live' });

    await expect.element(screen.getByRole('link', { name: 'Feed' })).toHaveAttribute('href', '/');
    await expect
      .element(screen.getByRole('link', { name: 'Feed' }))
      .not.toHaveAttribute('aria-current');
    await expect
      .element(screen.getByRole('link', { name: 'Live' }))
      .toHaveAttribute('aria-current', 'page');
  });
});
