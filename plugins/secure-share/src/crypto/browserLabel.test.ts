import { describeBrowser } from './browserLabel';

describe('describeBrowser', () => {
  it.each([
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
      'Chrome on macOS',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0', 'Firefox on Linux'],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      'Safari on macOS',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0',
      'Edge on Windows',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Safari/604.1',
      'Safari on iOS',
    ],
  ])('describes %s as %s', (userAgent, expected) => {
    expect(describeBrowser(userAgent)).toBe(expected);
  });

  it('prefers Edge over Chrome, which its user agent also claims', () => {
    expect(describeBrowser('Chrome/131.0 Edg/131.0 Windows')).toBe('Edge on Windows');
  });

  it('falls back to a generic label for an unrecognisable agent', () => {
    expect(describeBrowser('curl/8.4.0')).toBe('This browser');
  });
});
