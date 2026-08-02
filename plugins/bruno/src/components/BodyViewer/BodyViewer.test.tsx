import { renderInTestApp } from '@backstage/test-utils';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { BodyViewer } from './BodyViewer';

const SMALL_BODY = JSON.stringify({ hello: 'world' }, null, 2);
const MEDIUM_BODY = 'x'.repeat(200 * 1024);
const HUGE_BODY = 'y'.repeat(2 * 1024 * 1024);

describe('BodyViewer', () => {
  it('highlights a small body', async () => {
    await renderInTestApp(<BodyViewer text={SMALL_BODY} language="json" />);

    expect(screen.getByText(/hello/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /highlight anyway/i })).not.toBeInTheDocument();
  });

  it('skips highlighting a medium body but offers it explicitly', async () => {
    // Guards against react-syntax-highlighter locking the main thread; if this
    // test ever times out, the threshold has regressed.
    await renderInTestApp(<BodyViewer text={MEDIUM_BODY} language="text" />);

    expect(screen.getByRole('button', { name: /highlight anyway/i })).toBeInTheDocument();
    expect(screen.getByText(/Syntax highlighting is off/)).toBeInTheDocument();
  });

  it('highlights a medium body once the user opts in', async () => {
    await renderInTestApp(<BodyViewer text={MEDIUM_BODY} language="text" />);

    await userEvent.click(screen.getByRole('button', { name: /highlight anyway/i }));

    expect(screen.queryByRole('button', { name: /highlight anyway/i })).not.toBeInTheDocument();
  });

  it('truncates a huge body and never offers to highlight it', async () => {
    await renderInTestApp(<BodyViewer text={HUGE_BODY} language="text" />);

    expect(screen.getByText(/Body truncated — showing 64 KiB of 2\.0 MiB/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /highlight anyway/i })).not.toBeInTheDocument();
  });

  it('flags a body the backend already truncated', async () => {
    await renderInTestApp(<BodyViewer text={SMALL_BODY} language="json" truncatedByBackend />);

    expect(screen.getByText(/truncated when the run was synced/)).toBeInTheDocument();
  });
});
