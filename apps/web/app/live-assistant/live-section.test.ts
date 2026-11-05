import { describe, expect, it } from 'vitest';

import { ApiError } from '../api-client';
import { loadFailureCode } from './live-section';

describe('what the owner is told when the assistant state cannot be read', () => {
  it('gives the code the server gave, never nothing', () => {
    expect(loadFailureCode(new ApiError(403, 'AUTH_PERMISSION_DENIED'))).toBe(
      'AUTH_PERMISSION_DENIED',
    );
    expect(loadFailureCode(new ApiError(500, undefined))).toBe('HTTP_500');
    expect(loadFailureCode(new TypeError('Failed to fetch'))).toBe('NETWORK');
  });
});
