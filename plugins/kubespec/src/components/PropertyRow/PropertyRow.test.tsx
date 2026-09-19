import { renderInTestApp } from '@backstage/test-utils';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { PropertyRowModel } from '../../lib/schemaTree';
import { PropertyRow } from './PropertyRow';

function model(): PropertyRowModel {
  return {
    path: '.spec',
    node: {
      name: 'spec',
      type: 'DeploymentSpec',
      isArray: false,
      required: true,
      description: 'The desired behaviour.',
    },
    depth: 0,
    hasChildren: true,
    childCount: 9,
    isExpanded: false,
    isDescriptionOpen: false,
    isFocused: false,
    siblingCount: 3,
    positionInSet: 2,
  };
}

async function render(overrides: Partial<PropertyRowModel> = {}, scope: 'Cluster' | 'Namespaced' = 'Namespaced') {
  const onToggleChildren = jest.fn();
  const onToggleDescription = jest.fn();

  await renderInTestApp(
    <PropertyRow
      model={{ ...model(), ...overrides }}
      scope={scope}
      onToggleChildren={onToggleChildren}
      onToggleDescription={onToggleDescription}
      onCopyLink={jest.fn()}
    />,
  );

  return { onToggleChildren, onToggleDescription };
}

describe('PropertyRow', () => {
  it('exposes the row as a tree item with its position', async () => {
    await render();

    const row = screen.getByRole('treeitem');
    expect(row).toHaveAttribute('aria-level', '1');
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(row).toHaveAttribute('aria-posinset', '2');
    expect(row).toHaveAttribute('aria-setsize', '3');
  });

  it('draws a chevron and a child count for an expandable node', async () => {
    await render();

    // Both are independent of colour, which is the point: hue alone is not a
    // usable signal for everyone.
    expect(screen.getByRole('button', { name: 'Expand spec' })).toBeInTheDocument();
    expect(screen.getByText('(9)')).toBeInTheDocument();
  });

  it('draws no chevron for a leaf', async () => {
    await render({ hasChildren: false, childCount: 0 });

    expect(screen.queryByRole('button', { name: /Expand|Collapse/ })).not.toBeInTheDocument();
  });

  it('toggles children from the chevron and the description from the name', async () => {
    const { onToggleChildren, onToggleDescription } = await render();

    await userEvent.click(screen.getByRole('button', { name: 'Expand spec' }));
    expect(onToggleChildren).toHaveBeenCalledWith('.spec');

    // Anchored so this cannot also match the chevron's "Expand spec".
    await userEvent.click(screen.getByRole('button', { name: /^spec/ }));
    expect(onToggleDescription).toHaveBeenCalled();
  });

  it('shows the description only once it is open', async () => {
    await render();
    expect(screen.queryByText('The desired behaviour.')).not.toBeInTheDocument();

    await render({ isDescriptionOpen: true });
    expect(screen.getByText(/The desired behaviour./)).toBeInTheDocument();
  });

  it('marks metadata.namespace as required on a namespaced kind only', async () => {
    const namespaceNode = {
      path: '.metadata.namespace',
      node: {
        name: 'namespace',
        type: 'string',
        isArray: false,
        required: false,
        description: '',
      },
      hasChildren: false,
      childCount: 0,
    };

    await render(namespaceNode, 'Namespaced');
    expect(screen.getByText('*')).toBeInTheDocument();

    await render(namespaceNode, 'Cluster');
    // Only the first render's marker is on screen; a second would mean the
    // cluster-scoped row added one.
    expect(screen.getAllByText('*')).toHaveLength(1);
  });

  it('says where a recursive type repeats instead of expanding it', async () => {
    await render({
      node: {
        name: 'schema',
        type: 'JSONSchemaProps',
        isArray: false,
        required: false,
        description: '',
        recursiveOf: '.spec.versions',
      },
      hasChildren: false,
      childCount: 0,
    });

    expect(screen.getByText(/recursive — same shape as .spec.versions/)).toBeInTheDocument();
  });
});
