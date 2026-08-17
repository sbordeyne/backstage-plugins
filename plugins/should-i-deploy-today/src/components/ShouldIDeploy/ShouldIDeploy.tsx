import { Button, Flex, Text } from '@backstage/ui';
import { useEffect, useState } from 'react';
import { ShouldIDeployState, getShouldIDeployState } from './state';

interface Props {}

const backgrounds: Record<ShouldIDeployState['status'], 'success' | 'warning' | 'danger'> = {
  OK: 'success',
  WARNING: 'warning',
  KO: 'danger',
};

export const ShouldIDeploy = (_: Props) => {
  const [reason, setReason] = useState<string>('');
  const [status, setStatus] = useState<ShouldIDeployState['status']>('OK');

  function refresh() {
    const intl = new Intl.DateTimeFormat();
    const timezone = intl.resolvedOptions().timeZone;
    const country = intl.resolvedOptions().locale.split('-')[1] || 'US';
    const newReason = getShouldIDeployState(timezone, country);
    setReason(newReason.message);
    setStatus(newReason.status);
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <Flex
      bg={backgrounds[status]}
      direction="column"
      align="center"
      justify="center"
      gap="4"
      p="6"
      style={{ height: '100%', width: '100%', textAlign: 'center' }}
    >
      <Text as="h3" variant="body-medium" weight="bold">
        {"Should I deploy today?".toLocaleUpperCase()}
      </Text>
      <Text as="h1" variant="title-medium" style={{ whiteSpace: 'pre-line' }}>
        {reason}
      </Text>
      <br />
      <Button variant="secondary" size="small" onPress={() => refresh()}>
        Refresh
      </Button>
    </Flex>
  );
};
