import '@testing-library/jest-dom';

import { MockIntersectionObserver } from './testing/MockIntersectionObserver';

// jsdom does not implement IntersectionObserver, which the results list needs.
beforeEach(() => {
  MockIntersectionObserver.install();
});
