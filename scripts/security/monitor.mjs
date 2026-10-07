import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/** Only opaque alert codes leave the application; never identities or audit payloads. */
export async function collectSignals(base, token, fetcher = fetch, since) {
  const alerts = [];
  try {
    const response = await fetcher(new URL('/api/health/ready', base), {
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
    const data = await response.json();
    if (!response.ok || data.status !== 'ready' || data.checks?.database?.status !== 'up')
      alerts.push('service_not_ready');
  } catch {
    alerts.push('service_unreachable');
  }
  if (!token) alerts.push('security_monitor_not_configured');
  else
    try {
      const response = await fetcher(new URL('/api/health/security', base), {
        headers: {
          authorization: `Bearer ${token}`,
          ...(since ? { 'x-docoo-monitor-since': since } : {}),
        },
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      });
      if (!response.ok) alerts.push('security_monitor_unavailable');
      else {
        const data = await response.json();
        if (!Array.isArray(data.signals)) throw new Error();
        const allowed = new Set([
          'repeated_login_failures',
          'account_access_changed',
          'backup_overdue',
        ]);
        for (const code of data.signals) if (allowed.has(code)) alerts.push(code);
      }
    } catch {
      alerts.push('security_monitor_unavailable');
    }
  return [...new Set(alerts)].sort();
}

async function main() {
  const base = process.env.DOCOO_MONITOR_URL;
  if (!base || new URL(base).protocol !== 'https:')
    throw new Error('HTTPS monitoring URL is required.');
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) throw new Error('GitHub monitoring credentials are required.');
  const api = async (path, method = 'GET', body) => {
    const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20_000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('Monitoring notification failed: ' + response.status);
    return response.status === 204 ? null : response.json();
  };
  // A successful earlier workflow run is durable outside the application host. Do not
  // advance this checkpoint when the security endpoint or the service is unreachable.
  const history = await api(
    'actions/workflows/service-monitor.yml/runs?branch=main&status=success&per_page=20',
  );
  const previous = history.workflow_runs.find(
    (run) =>
      String(run.id) !== process.env.GITHUB_RUN_ID &&
      ['schedule', 'workflow_dispatch'].includes(run.event),
  );
  const since = previous?.run_started_at ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  let alerts = await collectSignals(base, process.env.SECURITY_MONITOR_TOKEN, fetch, since);
  if (alerts.some((code) => ['service_not_ready', 'service_unreachable'].includes(code))) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    alerts = await collectSignals(base, process.env.SECURITY_MONITOR_TOKEN, fetch, since);
  }
  if (
    alerts.some((code) =>
      [
        'service_not_ready',
        'service_unreachable',
        'security_monitor_unavailable',
        'security_monitor_not_configured',
      ].includes(code),
    )
  )
    process.exitCode = 1;
  const title = 'Docoo service security monitor';
  const issues = await api('issues?state=open&creator=github-actions%5Bbot%5D&per_page=100');
  const existing = issues.find((issue) => issue.title === title && !issue.pull_request);
  const marker = `<!-- signals:${alerts.join(',')} -->`;
  if (alerts.length) {
    const body =
      marker +
      '\n\nThe independent Docoo monitor detected: ' +
      alerts.map((code) => '`' + code + '`').join(', ') +
      '.\n\nChecked at ' +
      new Date().toISOString() +
      '. No account identities, credentials or source content are included. Check the deployment readiness and security audit before closing this alert.\n\nMonitoring is best effort on the GitHub Actions schedule; SMTP delivery is separate.';
    if (!existing) await api('issues', 'POST', { title, body, assignees: [repo.split('/')[0]] });
    else if (!existing.body?.includes(marker))
      await api(`issues/${existing.number}`, 'PATCH', { body });
  } else if (existing) {
    await api(`issues/${existing.number}/comments`, 'POST', {
      body: 'The independent monitor reports recovery; readiness and security signals are clear.',
    });
    await api(`issues/${existing.number}`, 'PATCH', { state: 'closed', state_reason: 'completed' });
  }
  console.log(JSON.stringify({ alerts }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
