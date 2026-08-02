import { Text } from '@backstage/ui';
import { STATUS_LABELS } from '../../lib/labels';
import { IntegrationStatus } from '../../types';

/**
 * `Tag` carries no colour variants, so the status is rendered as coloured text instead — the
 * semantic colours come from theme tokens rather than hardcoded values.
 */
const STATUS_COLORS: Record<IntegrationStatus, 'success' | 'info' | 'warning' | 'danger' | 'secondary'> = {
  integrated: 'success',
  'integrated-nested': 'info',
  drift: 'warning',
  'not-integrated': 'danger',
  unknown: 'secondary',
};

export interface IntegrationStatusLabelProps {
  status: IntegrationStatus;
}

export function IntegrationStatusLabel({ status }: IntegrationStatusLabelProps): JSX.Element {
  return (
    <Text variant="body-medium" weight="bold" color={STATUS_COLORS[status]}>
      {STATUS_LABELS[status]}
    </Text>
  );
}
