import { formatByteSize, parseByteSize } from './bytes';

describe('parseByteSize', () => {
  it.each([
    ['512B', 512],
    ['1KB', 1024],
    ['4MB', 4 * 1024 * 1024],
    ['1GB', 1024 * 1024 * 1024],
    ['1.5MB', Math.floor(1.5 * 1024 * 1024)],
    [' 100 MB ', 100 * 1024 * 1024],
    ['2mb', 2 * 1024 * 1024],
  ])('parses %s', (value, expected) => {
    expect(parseByteSize(value)).toBe(expected);
  });

  it.each(['', '100', 'MB', '100TB', '-1MB', '0MB', '1e3MB'])('rejects %s', value => {
    expect(() => parseByteSize(value)).toThrow(/Invalid byte size/);
  });
});

describe('formatByteSize', () => {
  it.each([
    [0, '0B'],
    [512, '512B'],
    [1024, '1KB'],
    [1536, '1.5KB'],
    [4 * 1024 * 1024, '4MB'],
  ])('formats %s as %s', (bytes, expected) => {
    expect(formatByteSize(bytes)).toBe(expected);
  });
});
