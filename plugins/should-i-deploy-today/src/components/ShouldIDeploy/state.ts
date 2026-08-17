import Hollidays, { HolidaysTypes } from 'date-holidays';

import reasons from '../../data/reasons.json';

export type ShouldIDeployStateStatus = 'OK' | 'WARNING' | 'KO';
export type ShouldIDeployStateRule =
  | 'friday_the_13th'
  | 'weekend'
  | 'holiday'
  | 'holiday_eve'
  | 'friday'
  | 'evening_or_night'
  | 'thursday_afternoon'
  | 'afternoon'
  | 'none';

export interface ShouldIDeployState {
  message: string;
  status: ShouldIDeployStateStatus;
  rule: ShouldIDeployStateRule;
}

function choice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function holidayReasons(holiday: HolidaysTypes.Holiday[], isTomorrow: boolean): string[] {
  const holidayName = holiday[0].name
    .toLowerCase()
    .replace(/\s/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '');
  const mapping = isTomorrow ? reasons.holiday_tomorrow : reasons.holiday;
  if (Object.keys(mapping).includes(holidayName)) {
    return mapping[holidayName as keyof typeof mapping];
  }
  return mapping.default;
}

export function getShouldIDeployStateFromDate(now: Date, timezone: string, country: string): ShouldIDeployState {
  const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 5 = Friday, 6 = Saturday
  const isFriday = dayOfWeek === 5;
  const isFridayThe13th = isFriday && now.getDate() === 13;
  const isAfternoon = now.getHours() >= 16;
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const isThursday = dayOfWeek === 4;
  const isEveningOrNight = now.getHours() >= 18 || now.getHours() < 9;
  const hd = new Hollidays(country, {
    types: ['public'],
    timezone: timezone,
    languages: 'en',
  });
  const isHoliday = hd.isHoliday(now);
  const isHolidayTomorrow = hd.isHoliday(new Date(now.getTime() + 24 * 60 * 60 * 1000));

  if (isFridayThe13th) {
    return {
      rule: 'friday_the_13th',
      status: 'KO',
      message: choice(reasons.friday_13th),
    };
  }
  if (isWeekend) {
    return {
      rule: 'weekend',
      status: 'KO',
      message: choice(reasons.weekend),
    };
  }
  if (isHoliday) {
    return {
      rule: 'holiday',
      status: 'KO',
      message: choice(holidayReasons(isHoliday, false)),
    };
  }
  if (isHolidayTomorrow) {
    return {
      rule: 'holiday_eve',
      status: 'KO',
      message: choice(holidayReasons(isHolidayTomorrow, true)),
    };
  }
  if (isFriday) {
    return {
      rule: 'friday',
      status: 'KO',
      message: choice(reasons.friday_afternoon),
    };
  }
  if (isEveningOrNight) {
    return {
      rule: 'evening_or_night',
      status: 'KO',
      message: choice(reasons.to_not_deploy),
    };
  }
  if (isAfternoon) {
    if (isThursday) {
      return {
        rule: 'thursday_afternoon',
        status: 'WARNING',
        message: choice(reasons.thursday_afternoon),
      };
    }
    return {
      rule: 'afternoon',
      status: 'WARNING',
      message: choice(reasons.afternoon),
    };
  }
  return {
    rule: 'none',
    status: 'OK',
    message: choice(reasons.to_deploy),
  };
}

export function getShouldIDeployState(timezone: string, country: string): ShouldIDeployState {
  return getShouldIDeployStateFromDate(new Date(), timezone, country);
}
