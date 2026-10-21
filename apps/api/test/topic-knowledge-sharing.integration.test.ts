import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminUrl, createHarness, type Harness } from './support/harness.js';

interface ProjectBody {
  id: string;
  version: number;
  topics: { topicId: string; knowledgeSharing: string }[];
  sharedKnowledgeIds: string[];
}

let h: Harness;
let cookie: string;
let topicId: string;
let otherTopicId: string;
const api = (suffix: string) => `/v1/workspaces/${h.ids.workspaceA}${suffix}`;

async function createTopic(code: string): Promise<string> {
  const response = await h.request('POST', api('/topics'), {
    cookie,
    payload: { code, title: code, description: 'x' },
  });
  return response.json<{ topic: { id: string } }>().topic.id;
}

async function createProject(
  code: string,
  topics: { topicId: string; knowledgeSharing?: string }[],
): Promise<ProjectBody> {
  const response = await h.request('POST', api('/projects'), {
    cookie,
    payload: { code, title: code, initialProblem: 'Problem', topics },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ project: ProjectBody }>().project;
}

/** Own, approved knowledge of a project; the sentence is unique so searches find only it. */
async function createApproved(projectId: string, title: string, content: string): Promise<string> {
  const created = await h.request('POST', api('/knowledge'), {
    cookie,
    payload: {
      title,
      sourceType: 'admin_provided',
      provenance: { declaration: 'Approved by the committee' },
      content,
      scopes: [{ type: 'project', id: projectId }],
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json<{ knowledge: { id: string } }>().knowledge.id;
  const audited = await h.request('POST', api(`/knowledge/${id}/submit-audit`), { cookie });
  expect(audited.statusCode, audited.body).toBe(200);
  return id;
}

async function visibleTo(projectId: string, query: string): Promise<string[]> {
  const response = await h.request('POST', api('/knowledge/retrieve'), {
    cookie,
    payload: { projectId, query },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ results: { knowledgeId: string }[] }>().results.map((r) => r.knowledgeId);
}

async function setSharing(
  project: ProjectBody,
  topics: { topicId: string; knowledgeSharing: string }[],
  sharedKnowledgeIds?: string[],
) {
  const response = await h.request('PATCH', api(`/projects/${project.id}`), {
    cookie,
    headers: { 'if-match': `"${project.version}"` },
    payload: { topics, ...(sharedKnowledgeIds ? { sharedKnowledgeIds } : {}) },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ project: ProjectBody }>().project;
}

describe.skipIf(!adminUrl)("sharing a project's knowledge with its topic (ADR-0034)", () => {
  beforeAll(async () => {
    h = await createHarness('topicshare');
    cookie = await h.login(h.emails.a);
    topicId = await createTopic('shared-topic');
    otherTopicId = await createTopic('other-topic');
  }, 30_000);

  afterAll(async () => {
    await h?.close();
  });

  it('keeps project knowledge private by default, then shares all or only the selected items', async () => {
    const owner = await createProject('owner', [{ topicId }]);
    const peer = await createProject('peer', [{ topicId }]);
    const stranger = await createProject('stranger', [{ topicId: otherTopicId }]);
    expect(owner.topics[0]?.knowledgeSharing).toBe('none');

    const first = await createApproved(
      owner.id,
      'Sapphire margin rule',
      'Sapphire margins must stay above twelve percent because of the supplier contract.',
    );
    const second = await createApproved(
      owner.id,
      'Sapphire shipping rule',
      'Sapphire shipments go by sea because of the cost policy.',
    );

    // Default: private to its own project.
    expect(await visibleTo(owner.id, 'sapphire margins')).toContain(first);
    expect(await visibleTo(peer.id, 'sapphire margins')).not.toContain(first);

    // Selected items only: just the ticked one reaches the peer, never a project on another topic.
    let current = await setSharing(owner, [{ topicId, knowledgeSharing: 'selected' }], [first]);
    expect(current.sharedKnowledgeIds).toEqual([first]);
    expect(await visibleTo(peer.id, 'sapphire margins')).toContain(first);
    expect(await visibleTo(peer.id, 'sapphire shipments')).not.toContain(second);
    expect(await visibleTo(stranger.id, 'sapphire margins')).not.toContain(first);

    // All: everything of the project is shared.
    current = await setSharing(current, [{ topicId, knowledgeSharing: 'all' }]);
    expect(await visibleTo(peer.id, 'sapphire shipments')).toContain(second);
    expect(await visibleTo(stranger.id, 'sapphire shipments')).not.toContain(second);

    // Back to private: the list of selected items is kept but nothing is shared.
    current = await setSharing(current, [{ topicId, knowledgeSharing: 'none' }]);
    expect(await visibleTo(peer.id, 'sapphire margins')).not.toContain(first);
    expect(current.sharedKnowledgeIds).toEqual([first]);
  });

  it("shares only on the topic that was chosen and accepts only the project's own knowledge", async () => {
    const owner = await createProject('owner-two', [{ topicId }, { topicId: otherTopicId }]);
    const onShared = await createProject('on-shared', [{ topicId }]);
    const onOther = await createProject('on-other', [{ topicId: otherTopicId }]);
    const item = await createApproved(
      owner.id,
      'Topaz rule',
      'Topaz deliveries need a signed receipt because of the audit policy.',
    );
    await setSharing(
      owner,
      [
        { topicId, knowledgeSharing: 'all' },
        { topicId: otherTopicId, knowledgeSharing: 'none' },
      ],
      [],
    );
    expect(await visibleTo(onShared.id, 'topaz deliveries')).toContain(item);
    expect(await visibleTo(onOther.id, 'topaz deliveries')).not.toContain(item);

    // Knowledge of another project cannot be listed as this project's shared knowledge.
    const foreign = await createApproved(
      onOther.id,
      'Opal rule',
      'Opal packaging needs a seal because of the safety policy.',
    );
    const refused = await h.request('PATCH', api(`/projects/${owner.id}`), {
      cookie,
      headers: { 'if-match': `"${owner.version + 1}"` },
      payload: { sharedKnowledgeIds: [foreign] },
    });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json<{ code?: string }>().code ?? refused.body).toContain(
      'PROJECT_SHARED_KNOWLEDGE_INVALID',
    );
  });
});
