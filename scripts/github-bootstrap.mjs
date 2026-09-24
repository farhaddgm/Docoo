import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

function gh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
}

function section(markdown, start, end) {
  const afterStart = markdown.split(start)[1];
  if (!afterStart) throw new Error(`Missing backlog section: ${start}`);
  return afterStart.split(end)[0];
}

function taskRows(markdown, phase) {
  const [start, end] =
    phase === 0
      ? ['## فاز ۰ — foundation', '## فاز ۱ — control plane']
      : ['## فاز ۱ — control plane', '## epicهای فازهای بعد'];
  return section(markdown, start, end)
    .split('\n')
    .filter((line) => /^\|\s*[A-Z]{2,4}-\d{3}\s*\|/.test(line))
    .map((line) => {
      const [id, title, requirements, dependencies, acceptance] = line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim());
      if (!id || !title || !requirements || !dependencies || !acceptance) {
        throw new Error(`Malformed backlog row: ${line}`);
      }
      return { id, title, requirements, dependencies, acceptance, phase };
    });
}

const epicTitles = new Map([
  ['ING-*', ['upload، quarantine، parsing و lineage', 2]],
  ['KNO-*', ['دانش، Brain و retrieval', 2]],
  ['WF-*', ['Temporal workflows و human gate', 3]],
  ['AI-*', ['provider orchestration', 3]],
  ['SOL-*/DOC-*/EVA-*', ['راه‌حل، سند و ارزیابی', 4]],
  ['REP-*', ['dashboard، Brain report و audit explorer', 5]],
  ['SEC-*/SRE-*/REL-*', ['hardening و private beta', 6]],
]);

function epicRows(markdown) {
  return section(markdown, '## epicهای فازهای بعد', '## traceability rule')
    .split('\n')
    .filter((line) => line.startsWith('- `'))
    .map((line) => {
      const separator = line.indexOf(':');
      if (separator < 0) throw new Error(`Malformed epic row: ${line}`);
      const ids = [...line.slice(0, separator).matchAll(/`([^`]+)`/g)].map((match) => match[1]);
      const key = ids.join('/');
      const specification = epicTitles.get(key);
      if (!specification) throw new Error(`Unknown epic group: ${key}`);
      return {
        key,
        title: `${key} — ${specification[0]}`,
        phase: specification[1],
        description: line.slice(separator + 1).trim(),
      };
    });
}

const backlog = await readFile(
  new URL('../docs/06-delivery/06-implementation-backlog.md', import.meta.url),
  'utf8',
);
const milestoneNames = [
  ...section(backlog, '## milestoneها', '## تعریف مشترک Done').matchAll(/^\d+\. `([^`]+)`$/gm),
].map((match) => match[1]);
if (milestoneNames.length !== 7) throw new Error('Expected seven backlog milestones.');

const tasks = [...taskRows(backlog, 0), ...taskRows(backlog, 1)];
const taskIds = new Set(tasks.map((task) => task.id));
if (taskIds.size !== tasks.length) throw new Error('Duplicate task IDs in backlog.');
const epics = epicRows(backlog);
if (epics.length !== epicTitles.size) throw new Error('Epic rows and title map differ.');
if (process.argv.includes('--dry-run')) {
  console.log(`Backlog parsed: ${tasks.length} tasks and ${epics.length} epics.`);
  process.exit(0);
}

gh(['auth', 'status']);
const repo =
  process.env.GITHUB_REPOSITORY ??
  gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
const labels = [
  ...Array.from({ length: 7 }, (_, phase) => [`phase:${phase}`, '0369a1']),
  ['kind:task', '1d4ed8'],
  ['kind:epic', '7c3aed'],
];
for (const [name, color] of labels) {
  gh(['label', 'create', name, '--repo', repo, '--color', color, '--force']);
}

const existingMilestones = JSON.parse(
  gh(['api', `repos/${repo}/milestones?state=all&per_page=100`]),
);
for (const title of milestoneNames) {
  if (existingMilestones.some((milestone) => milestone.title === title)) continue;
  gh(['api', '--method', 'POST', `repos/${repo}/milestones`, '-f', `title=${title}`]);
}

const existingIssues = JSON.parse(gh(['api', `repos/${repo}/issues?state=all&per_page=100`]));
const issueById = new Map();
for (const issue of existingIssues) {
  if (issue.pull_request) continue;
  const id = issue.title.match(/^([A-Z]{2,4}-\d{3}) — /)?.[1];
  if (id) issueById.set(id, issue.html_url);
}

let created = 0;
for (const task of tasks) {
  if (issueById.has(task.id)) continue;
  const dependencies = task.dependencies.replace(/[A-Z]{2,4}-\d{3}/g, (id) => {
    const url = issueById.get(id);
    return url ? `[${id}](${url})` : id;
  });
  const body = [
    `**ID:** ${task.id}`,
    `**Requirement:** ${task.requirements}`,
    `**Dependencies:** ${dependencies}`,
    '',
    '## Acceptance criteria',
    task.acceptance,
    '',
    '## Definition of Done',
    'کد، تست، مجوزدهی/RLS مرتبط، telemetry بدون دادهٔ حساس، مستندات و evidence پذیرش در PR ثبت شوند.',
    '',
    `[Backlog source](https://github.com/${repo}/blob/main/docs/06-delivery/06-implementation-backlog.md)`,
  ].join('\n');
  const url = gh([
    'issue',
    'create',
    '--repo',
    repo,
    '--title',
    `${task.id} — ${task.title}`,
    '--body',
    body,
    '--milestone',
    milestoneNames[task.phase],
    '--label',
    `phase:${task.phase},kind:task`,
  ]);
  issueById.set(task.id, url);
  created += 1;
}

for (const epic of epics) {
  if (existingIssues.some((issue) => issue.title.startsWith(`${epic.key} — `))) continue;
  const body = [
    epic.description,
    '',
    '## Acceptance criteria',
    'قبل از شروع اجرا، spike این epic را به vertical sliceهای کوچک با requirement، وابستگی، معیار پذیرش و evidence قابل‌ردیابی بشکند.',
    '',
    `[Backlog source](https://github.com/${repo}/blob/main/docs/06-delivery/06-implementation-backlog.md)`,
  ].join('\n');
  gh([
    'issue',
    'create',
    '--repo',
    repo,
    '--title',
    epic.title,
    '--body',
    body,
    '--milestone',
    milestoneNames[epic.phase],
    '--label',
    `phase:${epic.phase},kind:epic`,
  ]);
  created += 1;
}

console.log(
  `GitHub backlog ready for ${repo}: ${tasks.length} tasks, ${epics.length} epics; ${created} newly created.`,
);
