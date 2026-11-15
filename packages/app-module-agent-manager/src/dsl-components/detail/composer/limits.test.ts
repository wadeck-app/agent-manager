import { describe, expect, it } from 'vitest';
import { base64Length, formatBytes, imageBudget, requestBodyBytes, sendProblem } from './limits.js';
import type { AttachedImage, ComposerLimits } from './types.js';

const limits: ComposerLimits = { maxTextChars: 100, maxImages: 2, maxImageBytes: 500_000, maxBodyBytes: 1_048_576 };
const image = (bytes: number): AttachedImage => ({ id: `i${bytes}`, name: 'a.png', mime: 'image/png', bytes, dataBase64: 'A'.repeat(base64Length(bytes)) });

describe('limits', () => {
  it('computes the base64 length', () => {
    expect(base64Length(3)).toBe(4);
    expect(base64Length(4)).toBe(8);
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(1_572_864)).toBe('1.5 MB');
  });

  it('counts the base64 of the images in the body', () => {
    const empty = requestBodyBytes('hi', []);
    expect(requestBodyBytes('hi', [image(3000)]) - empty).toBeGreaterThanOrEqual(4000);
  });

  it('gives an image the room left, never more than the image cap', () => {
    expect(imageBudget('', [], limits)).toBe(500_000);
    expect(imageBudget('', [image(400_000), image(100_000)], limits)).toBeLessThan(300_000);
  });

  it('refuses early, with what to do', () => {
    expect(sendProblem('', [], limits)).toMatch(/Type a message/);
    expect(sendProblem('x'.repeat(101), [], limits)).toMatch(/limit is 100.*Shorten it by 1 characters/);
    expect(sendProblem('a', [image(10), image(10), image(10)], limits)).toMatch(/limit is 2\. Remove 1/);
    expect(sendProblem('a', [image(10)], { ...limits, maxBodyBytes: 150 })).toMatch(/limit is 150 B/);
    expect(sendProblem('a', [image(10)], limits)).toBeUndefined();
    expect(sendProblem('', [image(10)], limits)).toBeUndefined();
  });
});
