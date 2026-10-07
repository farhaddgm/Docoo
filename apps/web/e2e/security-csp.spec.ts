import { expect, test } from '@playwright/test';

test('production CSP uses unpredictable per-response nonces and blocks an injected inline script', async ({
  page,
  request,
}) => {
  const first = await request.get('/fa/auth/login', {
    headers: { 'x-nonce': 'attacker-controlled' },
  });
  const second = await request.get('/fa/auth/login');
  const nonce = (policy: string | undefined) => /'nonce-([^']+)'/u.exec(policy ?? '')?.[1];
  const firstNonce = nonce(first.headers()['content-security-policy']);
  expect(firstNonce).toBeTruthy();
  expect(firstNonce).not.toBe('attacker-controlled');
  expect(firstNonce).not.toBe(nonce(second.headers()['content-security-policy']));
  expect(first.headers()['content-security-policy']).not.toMatch(/script-src[^;]*'unsafe-inline'/u);

  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/fa/auth/login');
  await expect(page.locator('.auth-card')).toBeVisible();
  const blocked = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        document.addEventListener(
          'securitypolicyviolation',
          (event) => {
            if (event.violatedDirective.startsWith('script-src')) resolve(true);
          },
          { once: true },
        );
        const script = document.createElement('script');
        script.textContent = 'window.__docooInjectedScriptRan = true';
        document.head.appendChild(script);
        setTimeout(() => resolve(false), 1000);
      }),
  );
  expect(blocked).toBe(true);
  expect(await page.evaluate(() => '__docooInjectedScriptRan' in window)).toBe(false);
  expect(errors).toEqual([]);
});
