import type { PolicySection } from '@docoo/contracts';

import type { SessionIdentity } from './signed-in';

/**
 * What the owner's per-account settings leave open to the signed-in account (ADR-0042). This only
 * decides what the screens show; the API refuses the same things on its own. Without a policy
 * (administrators, or a session older than this release) nothing is hidden.
 */
export function sectionOpen(
  identity: SessionIdentity | null | undefined,
  section: PolicySection,
): boolean {
  const level = identity?.user.access?.sections[section];
  return level === undefined || level !== 'none';
}

export function canCreateProjects(identity: SessionIdentity | null | undefined): boolean {
  if (!identity) return true;
  return identity.user.access
    ? identity.user.access.canCreateProjects
    : identity.user.role !== 'viewer';
}

export function canCreateTopics(identity: SessionIdentity | null | undefined): boolean {
  if (!identity) return true;
  return identity.user.access
    ? identity.user.access.canCreateTopics
    : identity.user.role !== 'viewer';
}

export function canUploadFiles(identity: SessionIdentity | null | undefined): boolean {
  if (!identity) return true;
  return identity.user.access
    ? identity.user.access.canUploadFiles
    : identity.user.role !== 'viewer';
}

export function aiEnabled(identity: SessionIdentity | null | undefined): boolean {
  if (!identity) return true;
  return identity.user.access ? identity.user.access.ai.enabled : identity.user.role !== 'viewer';
}
