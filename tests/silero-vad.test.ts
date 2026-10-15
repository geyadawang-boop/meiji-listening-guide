import { describe, expect, it } from 'vitest';
import { speechRanges } from '../src/main/silero-vad';
import { timestampedCues } from '../src/main/asr-inference';
describe('native ASR voice spans and timestamp completeness', () => {
  it('skips silence, preserves hysteresis, splits long gaps and pads speech in original coordinates', () => {
    const values = [...Array(10).fill(0), ...Array(30).fill(.8), ...Array(10).fill(.4), ...Array(100).fill(0), ...Array(40).fill(.8), ...Array(70).fill(0)];
    const ranges = speechRanges(values, values.length * 512);
    expect(ranges).toEqual([{ start: 0, end: 50 * 512 + 6400 }, { start: 150 * 512 - 6400, end: 190 * 512 + 6400 }]);
    expect(speechRanges(Array(100).fill(0), 51200)).toEqual([]);
    expect(() => speechRanges([NaN], 512)).toThrow('无效概率');
  });
  it('keeps a final open timestamp at the real audio end and rejects missing or outside timing', () => {
    expect(timestampedCues([{ text: ' 原句 ', timestamp: [1, null] }], 8)).toEqual([{ content: '原句', from: 1, to: 8 }]);
    expect(() => timestampedCues([{ text: '原句', timestamp: [null, 4] }], 8)).toThrow('可靠');
    expect(() => timestampedCues([{ text: '原句', timestamp: [2, 20] }], 8)).toThrow('可靠');
  });
});
