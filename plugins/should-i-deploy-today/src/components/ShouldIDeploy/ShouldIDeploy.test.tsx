import { screen } from '@testing-library/react';
import { renderInTestApp } from '@backstage/frontend-test-utils';
import { ShouldIDeploy } from './ShouldIDeploy';

describe('ShouldIDeploy', () => {
  it('shows the header', async () => {
    await renderInTestApp(<ShouldIDeploy />);

    expect(screen.getByText(/should i deploy today\?/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });
});
