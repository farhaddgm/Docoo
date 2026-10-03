// Prepares an authenticated ZAP API scan (SEC-002): signs in as the E2E administrator,
// writes the OpenAPI document without the routes that would end the scan's own session,
// pins the administrator's workspace, and prints the ZAP replacer options that attach the session cookie and same-origin headers.
import { writeFileSync } from 'node:fs';

const api = process.env.DAST_API_URL ?? 'http://127.0.0.1:4000';
const origin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
const email = process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@example.test';
const password = process.env.E2E_ADMIN_PASSWORD ?? 'e2e-admin-password-1';
const output = process.argv[2] ?? 'openapi.json';

const login = await fetch(`${api}/v1/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin, 'sec-fetch-site': 'same-origin' },
  body: JSON.stringify({ identifier: email, password }),
});
if (!login.ok) throw new Error(`DAST login failed with ${login.status}`);
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
if (!cookie) throw new Error('DAST login returned no session cookie.');
const identity = await login.json();
const workspaceId = identity.workspaces?.[0]?.id;
if (!workspaceId) throw new Error('The DAST administrator has no workspace.');

const document = await (await fetch(`${api}/v1/openapi-json`)).json();
const sessionEnding = [
  ['/v1/auth/logout', 'post'],
  ['/v1/me/sessions', 'delete'],
  ['/v1/me/password', 'post'],
  ['/v1/me/password', 'put'],
];
for (const [path, method] of sessionEnding) delete document.paths?.[path]?.[method];
// Scan the administrator's real workspace so authorized handlers run, not only the 404 path.
document.paths = Object.fromEntries(
  Object.entries(document.paths ?? {}).map(([path, item]) => {
    const operations = Object.fromEntries(
      Object.entries(item).map(([method, operation]) => [
        method,
        typeof operation === 'object' && operation && Array.isArray(operation.parameters)
          ? {
              ...operation,
              parameters: operation.parameters.filter(
                (parameter) => !(parameter.in === 'path' && parameter.name === 'workspaceId'),
              ),
            }
          : operation,
      ]),
    );
    return [path.replace('{workspaceId}', workspaceId), operations];
  }),
);
document.servers = [{ url: api }];
writeFileSync(output, JSON.stringify(document));

const headers = [
  ['Cookie', cookie],
  ['Origin', origin],
  ['Sec-Fetch-Site', 'same-origin'],
];
const options = headers.flatMap(([name, value], index) => [
  `-config replacer.full_list(${index}).description=${name.toLowerCase()}`,
  `-config replacer.full_list(${index}).enabled=true`,
  `-config replacer.full_list(${index}).matchtype=REQ_HEADER`,
  `-config replacer.full_list(${index}).matchstr=${name}`,
  `-config replacer.full_list(${index}).regex=false`,
  `-config replacer.full_list(${index}).replacement=${value}`,
]);
process.stdout.write(options.join(' '));
