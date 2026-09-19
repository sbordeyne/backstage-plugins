/**
 * The search collator, as its own feature.
 *
 * Separate from the default export so `packages/backend` can register the
 * kubespec API without also indexing it, or the other way round.
 */
export { searchModuleKubespecCollator as default } from './search';
