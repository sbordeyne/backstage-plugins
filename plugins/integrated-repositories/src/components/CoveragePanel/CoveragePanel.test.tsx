import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { alertApiRef } from '@backstage/core-plugin-api';
import { TestApiProvider } from '@backstage/test-utils';
import { CoveragePanel, CoveragePanelProps } from './CoveragePanel';
import { ALL_REPOSITORY_KINDS } from '../../lib/labels';
import { CoverageStats, KindOption, LanguageOption, Perimeter } from '../../types';

const STATS: CoverageStats = {
  total: 148,
  integrated: 78,
  notIntegrated: 70,
  drift: 3,
  nestedOnly: 2,
  unknown: 0,
  entityCount: 152,
  uncoveredPercentage: 47.3,
  coveredPercentage: 52.7,
};

const LANGUAGE_OPTIONS: LanguageOption[] = [
  { id: 'Java', label: 'Java', repositoryCount: 55 },
  { id: 'Kotlin', label: 'Kotlin', repositoryCount: 2 },
  { id: 'Go', label: 'Go', repositoryCount: 3 },
];

const KIND_OPTIONS: KindOption[] = [
  { id: 'active', label: 'Active', repositoryCount: 107 },
  { id: 'archived', label: 'Archived', repositoryCount: 37 },
  { id: 'fork', label: 'Fork', repositoryCount: 4 },
];

function perimeter(overrides: Partial<Perimeter> = {}): Perimeter {
  return { languages: ['Java'], kinds: ALL_REPOSITORY_KINDS, ...overrides };
}

const alertApi = { post: jest.fn(), alert$: jest.fn() };

function renderPanel(overrides: Partial<CoveragePanelProps> = {}) {
  const props: CoveragePanelProps = {
    stats: STATS,
    languageOptions: LANGUAGE_OPTIONS,
    kindOptions: KIND_OPTIONS,
    perimeter: perimeter(),
    onPerimeterChange: jest.fn(),
    ingestionPending: false,
    enrichmentPending: false,
    githubEnrichmentAvailable: true,
    onRefresh: jest.fn(),
    ...overrides,
  };

  render(
    <TestApiProvider apis={[[alertApiRef, alertApi]]}>
      <CoveragePanel {...props} />
    </TestApiProvider>,
  );
  return props;
}

describe('CoveragePanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('leads with the uncovered percentage, as IDP-47 requires', () => {
    renderPanel();

    expect(screen.getByText('47.3 % not integrated')).toBeInTheDocument();
    expect(screen.getByText(/78 of 148 repositories integrated/)).toBeInTheDocument();
  });

  it('names the active language scope', () => {
    renderPanel({ perimeter: perimeter({ languages: ['Java', 'Kotlin'] }) });

    expect(screen.getByText(/languages Java, Kotlin/)).toBeInTheDocument();
  });

  it('describes an empty selection as all languages', () => {
    renderPanel({ perimeter: perimeter({ languages: [] }) });

    expect(screen.getByText(/languages all languages/)).toBeInTheDocument();
  });

  it('names the kinds the figure covers, so it is never read out of context', () => {
    renderPanel({ perimeter: perimeter({ kinds: ['active'] }) });

    expect(screen.getByText(/active repositories/)).toBeInTheDocument();
  });

  it('exposes the coverage bar as a meter', () => {
    renderPanel();

    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '52.7');
  });

  it('emits the full new selection when another language is picked', async () => {
    const user = userEvent.setup();
    const { onPerimeterChange } = renderPanel({ perimeter: perimeter({ languages: ['Java'] }) });

    await user.click(screen.getByRole('button', { name: /primary languages/i }));
    await user.click(screen.getByRole('option', { name: /Kotlin/ }));

    expect(onPerimeterChange).toHaveBeenCalledWith(expect.objectContaining({ languages: ['Java', 'Kotlin'] }));
  });

  describe('the repository kind selector', () => {
    it('lists each kind with how many repositories it holds', async () => {
      const user = userEvent.setup();
      renderPanel();

      await user.click(screen.getByRole('button', { name: /repository kinds/i }));

      expect(screen.getByRole('option', { name: 'Active (107)' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Archived (37)' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Fork (4)' })).toBeInTheDocument();
    });

    it('offers no option for a kind the organization has no repository for', async () => {
      const user = userEvent.setup();
      renderPanel();

      await user.click(screen.getByRole('button', { name: /repository kinds/i }));

      expect(screen.queryByRole('option', { name: /Empty/ })).not.toBeInTheDocument();
    });

    it('emits the full new selection when another kind is picked', async () => {
      const user = userEvent.setup();
      const { onPerimeterChange } = renderPanel({ perimeter: perimeter({ kinds: ['active'] }) });

      await user.click(screen.getByRole('button', { name: /repository kinds/i }));
      await user.click(screen.getByRole('option', { name: /Archived/ }));

      expect(onPerimeterChange).toHaveBeenCalledWith(expect.objectContaining({ kinds: ['active', 'archived'] }));
    });

    it('is disabled when GitHub is unavailable, like the language selector', () => {
      renderPanel({ githubEnrichmentAvailable: false });

      expect(screen.getByRole('button', { name: /repository kinds/i })).toBeDisabled();
    });

    it('is not rendered until enrichment lands', () => {
      renderPanel({ enrichmentPending: true });

      expect(screen.queryByRole('button', { name: /repository kinds/i })).not.toBeInTheDocument();
    });
  });

  it('shows each language with its repository count', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: /primary languages/i }));

    expect(screen.getByRole('option', { name: 'Java (55)' })).toBeInTheDocument();
  });

  it('replaces the figures with skeletons until ingestion lands', () => {
    renderPanel({ ingestionPending: true });

    expect(screen.queryByText('47.3 % not integrated')).not.toBeInTheDocument();
    expect(screen.getByText(/Reading the catalog/)).toBeInTheDocument();
  });

  it('hides the language selector until enrichment lands', () => {
    renderPanel({ enrichmentPending: true });

    expect(screen.queryByRole('button', { name: /primary languages/i })).not.toBeInTheDocument();
  });

  it('disables the language selector when GitHub is unavailable', () => {
    renderPanel({ githubEnrichmentAvailable: false });

    expect(screen.getByRole('button', { name: /primary languages/i })).toBeDisabled();
  });

  it('refreshes the GitHub stage on demand', async () => {
    const user = userEvent.setup();
    const { onRefresh } = renderPanel();

    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(onRefresh).toHaveBeenCalled();
  });

  describe('unknown count', () => {
    // Until GitHub answers, every uningested repository is `unknown`, so the figure would otherwise
    // show a large number and then collapse once enrichment lands.
    it('is replaced by a skeleton until enrichment lands', () => {
      renderPanel({ stats: { ...STATS, unknown: 9 }, enrichmentPending: true });

      expect(screen.queryByText('9')).not.toBeInTheDocument();
    });

    it('is shown once enrichment has landed', () => {
      renderPanel({ stats: { ...STATS, unknown: 9 } });

      expect(screen.getByText('9')).toBeInTheDocument();
    });
  });

  describe('copying the baseline', () => {
    it('writes the baseline to the clipboard and confirms it', async () => {
      const user = userEvent.setup();
      const writeText = jest.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
      renderPanel();

      await user.click(screen.getByRole('button', { name: 'Copy baseline' }));

      await waitFor(() =>
        expect(alertApi.post).toHaveBeenCalledWith(
          expect.objectContaining({ severity: 'success', message: expect.stringContaining('Baseline copied') }),
        ),
      );
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('78/148 integrated repositories'));
    });

    it('reports a rejected clipboard write instead of failing silently', async () => {
      const user = userEvent.setup();
      jest.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Write permission denied'));
      renderPanel();

      await user.click(screen.getByRole('button', { name: 'Copy baseline' }));

      await waitFor(() =>
        expect(alertApi.post).toHaveBeenCalledWith(
          expect.objectContaining({
            severity: 'error',
            message: expect.stringContaining('78/148 integrated repositories'),
          }),
        ),
      );
    });
  });
});
