import { describe, expect, it } from 'vitest';
import { greet } from './index.js';

describe('greet', () => {
  it('formats the greeting', () => {
    expect(greet('World')).toBe('Hello, World!');
  });
});

