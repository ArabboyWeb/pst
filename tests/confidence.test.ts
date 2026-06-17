import { describe, it, expect } from 'vitest';
import { conf, combineConfidences, levelFromScore, maxConfidence } from '../src/utils/confidence.js';

describe('Confidence utilities', () => {
  it('clamps scores to [0,1]', () => {
    expect(conf(-0.5, 'x').score).toBe(0);
    expect(conf(1.5, 'x').score).toBe(1);
  });

  it('maps scores to levels', () => {
    expect(levelFromScore(0.9)).toBe('high');
    expect(levelFromScore(0.6)).toBe('medium');
    expect(levelFromScore(0.2)).toBe('low');
  });

  it('combines confidences by averaging', () => {
    const c = combineConfidences([conf(0.8, 'a'), conf(0.6, 'b')], 'avg');
    expect(c.score).toBeCloseTo(0.7, 2);
  });

  it('returns 0 confidence for empty list', () => {
    const c = combineConfidences([], 'none');
    expect(c.score).toBe(0);
  });

  it('maxConfidence picks the highest', () => {
    const items = [
      { id: 'a', confidence: conf(0.5, 'a') },
      { id: 'b', confidence: conf(0.9, 'b') },
      { id: 'c', confidence: conf(0.7, 'c') },
    ];
    const best = maxConfidence(items);
    expect(best?.id).toBe('b');
  });
});
