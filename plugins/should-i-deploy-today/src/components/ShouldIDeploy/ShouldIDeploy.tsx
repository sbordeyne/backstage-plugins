import { Button, Flex, Text } from '@backstage/ui';
import { useEffect, useState } from 'react';
import Hollidays, { HolidaysTypes } from 'date-holidays';

import reasons from '../../data/reasons.json';

interface ShouldIDeployState {
  message: string;
  status: 'OK' | 'WARNING' | 'KO';
}

interface Props {}

function choice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function holidayReasons(holiday: HolidaysTypes.Holiday[], isTomorrow: boolean): string[] {
  const holidayName = holiday[0].name.toLowerCase().replace(/\s/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
  const mapping = isTomorrow ? reasons.holiday_tomorrow : reasons.holiday;
  if (Object.keys(mapping).includes(holidayName)) {
    return mapping[holidayName as keyof typeof mapping];
  }
  return mapping.default;
}

function getShouldIDeployState(timezone: string, country: string): ShouldIDeployState {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 5 = Friday, 6 = Saturday
  const isFriday = dayOfWeek === 5;
  const isFridayThe13th = isFriday && now.getDate() === 13;
  const isAfternoon = now.getHours() >= 16;
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const isThursday = dayOfWeek === 4;
  const isEveningOrNight = now.getHours() >= 18 || now.getHours() < 9;
  const hd = new Hollidays({
    types: ['public'],
    timezone: timezone,
    languages: 'en',
  });
  hd.init(country);
  const isHoliday = hd.isHoliday(now);
  const isHolidayTomorrow = hd.isHoliday(new Date(now.getTime() + 24 * 60 * 60 * 1000));

  if (isFridayThe13th) {
    return {
      status: 'KO',
      message: choice(reasons.friday_13th),
    };
  }
  if (isWeekend) {
    return {
      status: 'KO',
      message: choice(reasons.weekend),
    };
  }
  if (isAfternoon) {
    if (isThursday) {
      return {
        status: 'WARNING',
        message: choice(reasons.thursday_afternoon),
      };
    }
    return {
      status: 'WARNING',
      message: choice(reasons.afternoon),
    };
  }
  if (isFriday) {
    return {
      status: 'KO',
      message: choice(reasons.friday_afternoon),
    };
  }
  if (isHoliday) {
    return {
      status: 'KO',
      message: choice(holidayReasons(isHoliday, false)),
    };
  }
  if (isHolidayTomorrow) {
    return {
      status: 'KO',
      message: choice(holidayReasons(isHolidayTomorrow, true)),
    };
  }
  if (isEveningOrNight) {
    return {
      status: 'KO',
      message: choice(reasons.to_not_deploy),
    };
  }
  return {
    status: 'OK',
    message: choice(reasons.to_deploy),
  };
}

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
      <Text as="h1" variant="title-large" style={{ whiteSpace: 'pre-line' }}>
        {reason}
      </Text>
      <br />
      <Button variant="secondary" size="small" onPress={() => refresh()}>
        Refresh
      </Button>
    </Flex>
  );
};
