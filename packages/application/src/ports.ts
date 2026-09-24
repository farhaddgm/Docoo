export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  uuid(): string;
}

export interface TransactionContext {
  readonly workspaceId: string;
  readonly actorId: string;
}

export interface TransactionManager {
  inWorkspace<T>(context: TransactionContext, operation: () => Promise<T>): Promise<T>;
}
