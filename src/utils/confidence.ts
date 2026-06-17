import type { Confidence, ConfidenceLevel } from '../types/index.js';

/**
 * Convert a numeric score in [0,1] to a bucketed level.
 */
export function levelFromScore(score: number): ConfidenceLevel {
  if (score >= 0.75) return 'high';
  if (score >= 0.45) return 'medium';
  return 'low';
}

/**
 * Build a Confidence object from a score and a reason string.
 */
export function conf(score: number, reason: string): Confidence {
  const clamped = Math.max(0, Math.min(1, score));
  return {
    score: Number(clamped.toFixed(2)),
    level: levelFromScore(clamped),
    reason,
  };
}

/**
 * Combine several confidences by averaging their scores. Used when a detection
 * decision depends on multiple signals.
 */
export function combineConfidences(
  confidences: Confidence[],
  reason: string,
): Confidence {
  if (confidences.length === 0) return conf(0, reason);
  const avg =
    confidences.reduce((sum, c) => sum + c.score, 0) / confidences.length;
  return conf(avg, reason);
}

/**
 * Take the maximum-confidence item from a list. Returns undefined for empty.
 */
export function maxConfidence<T extends { confidence: Confidence }>(
  items: T[],
): T | undefined {
  if (items.length === 0) return undefined;
  return items.reduce((best, item) =>
    item.confidence.score > best.confidence.score ? item : best,
  );
}
