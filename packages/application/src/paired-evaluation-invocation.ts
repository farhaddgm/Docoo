import type { EvaluationInvocationIntent, EvaluationInvocationReceipt } from '@docoo/contracts';

/** Implementations must commit begin() before returning; an existing intent never authorizes replay. */
export interface EvaluationInvocationJournal {
  begin(intent: EvaluationInvocationIntent): Promise<void>;
  returned(intent: EvaluationInvocationIntent, receipt: EvaluationInvocationReceipt): Promise<void>;
  unknown(intent: EvaluationInvocationIntent): Promise<void>;
}

export class EvaluationInvocationError extends Error {
  constructor(
    readonly code:
      'NOT_FOUND' | 'ALREADY_STARTED' | 'RECEIPT_CHANGED' | 'OUT_OF_ORDER' | 'FORBIDDEN',
  ) {
    super(`EVALUATION_INVOCATION_${code}`);
    this.name = 'EvaluationInvocationError';
  }
}
