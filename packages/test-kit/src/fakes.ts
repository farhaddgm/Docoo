import type { Clock, IdGenerator } from '@docoo/application';

export class FixedClock implements Clock {
  constructor(private readonly current: Date) {}

  now(): Date {
    return new Date(this.current);
  }
}

export class SequenceIdGenerator implements IdGenerator {
  private index = 0;

  constructor(private readonly values: readonly string[]) {}

  uuid(): string {
    const value = this.values[this.index];
    if (!value) {
      throw new Error('SequenceIdGenerator has no values left.');
    }
    this.index += 1;
    return value;
  }
}
