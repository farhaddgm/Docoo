import { describe, expect, it } from 'vitest';

import {
  accountPolicySchema,
  aiBlock,
  defaultPolicy,
  resolveAccess,
  sectionAllows,
  sectionOfPermission,
} from './account-policy.js';

describe('effective access of an account', () => {
  it('leaves the owner and administrators unrestricted whatever the policy says', () => {
    const policy = { ...defaultPolicy(), sections: { knowledge: 'none' as const } };
    const access = resolveAccess('super_admin', policy);
    expect(access.unrestricted).toBe(true);
    expect(access.sections.knowledge).toBe('edit');
    expect(access.canCreateProjects).toBe(true);
  });

  it('makes an editor change everything but create nothing until the owner allows it', () => {
    const access = resolveAccess('editor', null);
    expect(access.canCreateProjects).toBe(false);
    expect(access.canCreateTopics).toBe(false);
    expect(access.sections.documents).toBe('edit');
    const allowed = resolveAccess('editor', { ...defaultPolicy(), canCreateProjects: true });
    expect(allowed.canCreateProjects).toBe(true);
  });

  it('keeps a viewer looking only, however much it was given', () => {
    const access = resolveAccess('viewer', {
      ...defaultPolicy(),
      canCreateProjects: true,
      canUploadFiles: true,
      sections: { knowledge: 'edit', business: 'none' },
    });
    expect(access.sections.knowledge).toBe('view');
    expect(access.sections.business).toBe('none');
    expect(access.sections.agents).toBe('view');
    expect(access.canCreateProjects).toBe(false);
    expect(access.canUploadFiles).toBe(false);
    expect(access.ai.enabled).toBe(false);
  });
});

describe('sections and permissions', () => {
  it('maps permissions onto sections and leaves the rest alone', () => {
    expect(sectionOfPermission('knowledge.update')).toBe('knowledge');
    expect(sectionOfPermission('analysis.answer')).toBe('workflow');
    expect(sectionOfPermission('project.run')).toBe('workflow');
    expect(sectionOfPermission('project.update')).toBeNull();
    expect(sectionOfPermission('workspace.read')).toBeNull();
  });

  it('lets a view section be read and a hidden one not even that', () => {
    const access = resolveAccess('editor', {
      ...defaultPolicy(),
      sections: { documents: 'view', business: 'none' },
    });
    expect(sectionAllows(access, 'document.read', true)).toBe(true);
    expect(sectionAllows(access, 'document.edit', false)).toBe(false);
    expect(sectionAllows(access, 'business.read', true)).toBe(false);
    expect(sectionAllows(access, 'project.update', false)).toBe(true);
  });
});

describe('AI limits', () => {
  const ai = { enabled: true, monthlyTokens: 1000, monthlyCostUsd: 2, dailyCalls: 5 };
  const used = { monthTokens: 10, monthCostUsd: 0.1, todayCalls: 1 };

  it('lets an account with room left go on', () => {
    expect(aiBlock(ai, used)).toBeNull();
    expect(
      aiBlock({ ...ai, monthlyTokens: null, monthlyCostUsd: null, dailyCalls: null }, used),
    ).toBeNull();
  });

  it('names the first limit that is reached', () => {
    expect(aiBlock({ ...ai, enabled: false }, used)).toBe('disabled');
    expect(aiBlock(ai, { ...used, monthTokens: 1000 })).toBe('tokens');
    expect(aiBlock(ai, { ...used, monthCostUsd: 2 })).toBe('cost');
    expect(aiBlock(ai, { ...used, todayCalls: 5 })).toBe('calls');
  });
});

describe('policy schema', () => {
  it('accepts the default policy and refuses unknown sections or negative limits', () => {
    expect(accountPolicySchema.safeParse(defaultPolicy()).success).toBe(true);
    expect(
      accountPolicySchema.safeParse({ ...defaultPolicy(), sections: { secrets: 'edit' } }).success,
    ).toBe(false);
    expect(
      accountPolicySchema.safeParse({
        ...defaultPolicy(),
        ai: { ...defaultPolicy().ai, monthlyTokens: -1 },
      }).success,
    ).toBe(false);
  });
});
