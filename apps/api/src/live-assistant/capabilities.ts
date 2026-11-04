import type { CapabilityMeta } from '@docoo/contracts';
import type { z } from 'zod';

import type { WorkspaceRequestContext } from '../common/request-context.js';

/**
 * The capability registry of the live assistant (ADR-0055 §4-3). It is default-deny: a name that
 * is not registered here does not exist for the assistant, whatever a model asks. Each entry says
 * how risky it is, where it acts, what its parameters look like, how to describe it to the owner
 * before they confirm, and how to run it. Models never reach an executor except through the
 * gateway, and the gateway reaches it only after a confirmation the ledger recorded.
 */
export const LIVE_CAPABILITIES = Symbol('docoo.live_capabilities');

export type LiveLocale = 'fa' | 'en';

export interface LivePreview {
  /** What will happen, in the owner's language. Shown and read back before they confirm. */
  readonly summary: string;
  /** The name an irreversible change must be confirmed by. Required for T3. */
  readonly targetName?: string | undefined;
}

export interface LiveExecution {
  /** The administrator's own identity: the change is made as them and audited as them. */
  readonly context: WorkspaceRequestContext;
  readonly sessionId: string;
  readonly actionId: string;
}

export interface LiveCapability<P = unknown> {
  readonly meta: CapabilityMeta;
  readonly params: z.ZodType<P>;
  /** Which project the call acts on. Required when `meta.area` is `project`. */
  readonly projectOf?: ((params: P) => string | null) | undefined;
  readonly describe: (params: P, locale: LiveLocale) => LivePreview;
  readonly execute: (execution: LiveExecution, params: P) => Promise<unknown>;
}

/** Erases the parameter type so capabilities with different parameters sit in one list. */
export function defineCapability<P>(capability: LiveCapability<P>): LiveCapability {
  return capability as unknown as LiveCapability;
}

const NAME = /^[a-z][a-z0-9_.]{1,99}$/u;

export class LiveCapabilityRegistry {
  private readonly byName = new Map<string, LiveCapability>();

  constructor(capabilities: readonly LiveCapability[]) {
    for (const capability of capabilities) {
      const { meta } = capability;
      if (!NAME.test(meta.name)) throw new Error(`Capability name ${meta.name} is not allowed.`);
      if (this.byName.has(meta.name))
        throw new Error(`Capability ${meta.name} is registered twice.`);
      if (meta.klass === 'forbidden') {
        throw new Error(`Capability ${meta.name} is forbidden and must not be registered.`);
      }
      if (meta.write !== (meta.klass !== 'T0')) {
        throw new Error(`Capability ${meta.name}: only a read is T0, every change is T1 or above.`);
      }
      if (meta.area === 'project' && !capability.projectOf) {
        throw new Error(`Capability ${meta.name} acts on a project and must say which one.`);
      }
      if (meta.klass === 'T3' && meta.t3Category === undefined) {
        throw new Error(`Capability ${meta.name} is irreversible and must name its category.`);
      }
      this.byName.set(meta.name, capability);
    }
  }

  get(name: string): LiveCapability | undefined {
    return this.byName.get(name);
  }

  names(): string[] {
    return [...this.byName.keys()].sort();
  }
}

/** Production capabilities. None are connected yet: the first ones arrive with the executor step. */
export const liveCapabilityDefinitions: readonly LiveCapability[] = [];
