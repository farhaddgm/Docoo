// k6 load test of the back-office main path (SRE-002, NFR-PERF-001/003).
// 25 concurrent administrators (the agent-run baseline) read the dashboard, project list and
// detail, audit log, usage report and Brain reports over a 1,000-project workspace.
// Thresholds are the SLOs: p95 < 500 ms for normal reads and < 0.5 % failed requests.
import http from 'k6/http';
import { check, fail, sleep } from 'k6';

const API = (__ENV.API_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const ORIGIN = __ENV.WEB_ORIGIN || 'http://localhost:3000';
const EMAIL = __ENV.E2E_ADMIN_EMAIL || 'e2e-admin@example.test';
const PASSWORD = __ENV.E2E_ADMIN_PASSWORD || 'e2e-admin-password-1';

export const options = {
  scenarios: {
    administrators: {
      executor: 'constant-vus',
      vus: Number(__ENV.LOAD_VUS || 25),
      duration: __ENV.LOAD_DURATION || '60s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.005'],
    'http_req_duration{kind:read}': ['p(95)<500'],
    'http_req_duration{name:dashboard}': ['p(95)<500'],
    'http_req_duration{name:projects}': ['p(95)<500'],
    'http_req_duration{name:audit}': ['p(95)<500'],
    checks: ['rate>0.995'],
  },
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
};

/** One sign-in shared by every virtual user (the login route is rate limited by design). */
export function setup() {
  const response = http.post(
    `${API}/v1/auth/login`,
    JSON.stringify({ identifier: EMAIL, password: PASSWORD }),
    {
      headers: {
        'content-type': 'application/json',
        origin: ORIGIN,
        'sec-fetch-site': 'same-origin',
      },
    },
  );
  if (response.status !== 200) fail(`login failed: ${response.status}`);
  const cookie = String(response.headers['Set-Cookie']).split(';')[0];
  const workspaceId = response.json('workspaces.0.id');
  const projects = http.get(`${API}/v1/workspaces/${workspaceId}/projects?limit=100`, {
    headers: { cookie },
  });
  const ids = (projects.json('items') || []).map((item) => item.id);
  if (ids.length === 0) fail('no projects to read; run the load seed first');
  return { cookie, workspaceId, ids };
}

export default function (data) {
  const params = (name) => ({ headers: { cookie: data.cookie }, tags: { name, kind: 'read' } });
  const base = `${API}/v1/workspaces/${data.workspaceId}`;
  const project = data.ids[Math.floor(Math.random() * data.ids.length)];
  const responses = {
    dashboard: http.get(`${base}/dashboard`, params('dashboard')),
    projects: http.get(`${base}/projects?limit=25`, params('projects')),
    project: http.get(`${base}/projects/${project}`, params('project')),
    timeline: http.get(`${base}/projects/${project}/timeline?limit=25`, params('timeline')),
    audit: http.get(`${base}/audit-events?limit=25&severity=warning`, params('audit')),
    usage: http.get(`${base}/reports/usage?groupBy=stage`, params('usage')),
    brain: http.get(`${base}/brain-reports?limit=10`, params('brain')),
    me: http.get(`${API}/v1/me`, params('me')),
  };
  for (const [name, response] of Object.entries(responses)) {
    check(response, { [`${name} 200`]: (value) => value.status === 200 });
  }
  sleep(0.5 + Math.random());
}
