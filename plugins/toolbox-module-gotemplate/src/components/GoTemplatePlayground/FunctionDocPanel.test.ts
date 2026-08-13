import { buildUsage, parseParams } from './FunctionDocPanel';

describe('parseParams', () => {
  it('reads a simple parameter list', () => {
    expect(parseParams('trunc(int, string) string')).toEqual(['int', 'string']);
  });

  it('returns nothing for a niladic function', () => {
    expect(parseParams('now() time.Time')).toEqual([]);
  });

  // A naive split on "," would cut `map[string]any` in half.
  it('does not split inside a bracketed type', () => {
    expect(parseParams('merge(map[string]any, []string) map[string]any')).toEqual(
      ['map[string]any', '[]string'],
    );
  });

  it('keeps the variadic marker', () => {
    expect(parseParams('add(...any) int64')).toEqual(['...any']);
  });

  it('handles multiple return values', () => {
    expect(parseParams('pkcs12key(string) (string, error)')).toEqual(['string']);
  });
});

describe('buildUsage', () => {
  const doc = (name: string, signature: string) => ({
    name,
    signature,
    category: 'Strings',
  });

  it('renders a bare action for a niladic function', () => {
    expect(buildUsage(doc('now', 'now() time.Time'))).toEqual(['{{ now }}']);
  });

  // Go pipes the value in as the *last* argument, so the pipeline form has to
  // move the final parameter to the front rather than just prefixing the call.
  it('moves the final argument to the front in the pipeline form', () => {
    const [direct, piped] = buildUsage(doc('trunc', 'trunc(int, string) string'));
    expect(direct).toBe('{{ trunc int1 string2 }}');
    expect(piped).toBe('{{ string2 | trunc int1 }}');
  });

  it('marks a variadic parameter', () => {
    const [direct] = buildUsage(doc('add', 'add(...any) int64'));
    expect(direct).toContain('…');
  });

  it('names list and map parameters readably', () => {
    const [direct] = buildUsage(
      doc('merge', 'merge(map[string]any, []string) map[string]any'),
    );
    expect(direct).toBe('{{ merge dict1 list2 }}');
  });
});
