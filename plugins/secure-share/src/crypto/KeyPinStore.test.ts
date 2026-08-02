import { KeyPinStore } from './KeyPinStore';

const ALICE = 'user:default/alice';

describe('KeyPinStore', () => {
  let store: KeyPinStore;

  beforeEach(() => {
    window.localStorage.clear();
    store = KeyPinStore.create(window.localStorage);
  });

  it('reports a recipient it has never seen as first seen', () => {
    const verdict = store.evaluate({ userEntityRef: ALICE, fingerprints: ['fp-1'] });

    expect(verdict).toEqual({
      userEntityRef: ALICE,
      status: 'first-seen',
      newFingerprints: ['fp-1'],
      pinnedFingerprints: [],
    });
  });

  it('reports an unchanged recipient once their keys are pinned', () => {
    store.trust({ userEntityRef: ALICE, fingerprints: ['fp-1', 'fp-2'] });

    const verdict = store.evaluate({ userEntityRef: ALICE, fingerprints: ['fp-1', 'fp-2'] });

    expect(verdict.status).toBe('unchanged');
    expect(verdict.newFingerprints).toEqual([]);
  });

  it('flags a key that was never pinned for a known recipient', () => {
    store.trust({ userEntityRef: ALICE, fingerprints: ['fp-1'] });

    const verdict = store.evaluate({ userEntityRef: ALICE, fingerprints: ['fp-1', 'fp-new'] });

    expect(verdict.status).toBe('new-keys');
    expect(verdict.newFingerprints).toEqual(['fp-new']);
    expect(verdict.pinnedFingerprints).toEqual(['fp-1']);
  });

  it('treats a recipient whose keys all disappeared as unchanged, since only new keys matter', () => {
    store.trust({ userEntityRef: ALICE, fingerprints: ['fp-1', 'fp-2'] });

    expect(store.evaluate({ userEntityRef: ALICE, fingerprints: ['fp-1'] }).status).toBe('unchanged');
  });

  it('keeps pins for each recipient separate', () => {
    store.trust({ userEntityRef: ALICE, fingerprints: ['fp-1'] });

    expect(store.getPinned('user:default/bob')).toEqual([]);
    expect(store.evaluate({ userEntityRef: 'user:default/bob', fingerprints: ['fp-1'] }).status).toBe('first-seen');
  });

  it('adds to what is already pinned rather than replacing it', () => {
    store.trust({ userEntityRef: ALICE, fingerprints: ['fp-1'] });
    store.trust({ userEntityRef: ALICE, fingerprints: ['fp-2'] });

    expect(store.getPinned(ALICE).sort()).toEqual(['fp-1', 'fp-2']);
  });

  it('does not pin the same fingerprint twice', () => {
    store.trust({ userEntityRef: ALICE, fingerprints: ['fp-1'] });
    store.trust({ userEntityRef: ALICE, fingerprints: ['fp-1'] });

    expect(store.getPinned(ALICE)).toEqual(['fp-1']);
  });

  it('survives a browser restart, which is the whole point of pinning', () => {
    store.trust({ userEntityRef: ALICE, fingerprints: ['fp-1'] });

    expect(KeyPinStore.create(window.localStorage).getPinned(ALICE)).toEqual(['fp-1']);
  });

  it('forgets a recipient on request', () => {
    store.trust({ userEntityRef: ALICE, fingerprints: ['fp-1'] });

    store.forget(ALICE);

    expect(store.getPinned(ALICE)).toEqual([]);
  });

  it('treats unreadable stored pins as absent rather than failing', () => {
    window.localStorage.setItem('secure-share/pinned-keys/v1', 'not json');

    expect(store.getPinned(ALICE)).toEqual([]);
  });

  it('stores nothing that reveals what was shared', () => {
    store.trust({ userEntityRef: ALICE, fingerprints: ['fp-1'] });

    const stored = window.localStorage.getItem('secure-share/pinned-keys/v1') as string;
    expect(JSON.parse(stored)).toEqual({ [ALICE]: { fingerprints: ['fp-1'], updatedAt: expect.any(String) } });
  });
});
