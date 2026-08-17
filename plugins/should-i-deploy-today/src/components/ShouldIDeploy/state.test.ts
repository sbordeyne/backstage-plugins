import { getShouldIDeployStateFromDate } from "./state";
import reasons from '../../data/reasons.json';

describe('ShouldIDeployState', () => {
  const timezone = 'Etc/UTC';
  const country = 'FR'

  // Dates are built from local components so that the weekday and hour checks
  // are independent of the machine timezone jest runs in.
  const at = (year: number, month: number, day: number, hours = 12) =>
    new Date(year, month - 1, day, hours, 0, 0);

  const stateAt = (date: Date) => getShouldIDeployStateFromDate(date, timezone, country);

  it('matches rule friday_the_13th', () => {
    const state = stateAt(at(2026, 11, 13));
    expect(state.rule).toBe('friday_the_13th');
    expect(state.status).toBe('KO');
    expect(reasons.friday_13th).toContain(state.message);
  });

  it('matches rule weekend on saturday', () => {
    const state = stateAt(at(2026, 11, 14));
    expect(state.rule).toBe('weekend');
    expect(state.status).toBe('KO');
    expect(reasons.weekend).toContain(state.message);
  });

  it('matches rule weekend on sunday', () => {
    const state = stateAt(at(2026, 11, 15));
    expect(state.rule).toBe('weekend');
    expect(state.status).toBe('KO');
  });

  it('matches rule holiday', () => {
    const state = stateAt(at(2026, 7, 14)); // Bastille Day, a tuesday
    expect(state.rule).toBe('holiday');
    expect(state.status).toBe('KO');
    expect(reasons.holiday.default).toContain(state.message);
  });

  it('uses the holiday specific reasons when the holiday is known', () => {
    const state = stateAt(at(2026, 4, 6)); // Easter Monday
    expect(state.rule).toBe('holiday');
    expect(reasons.holiday.easter_monday).toContain(state.message);
  });

  it('uses the christmas reasons on christmas day', () => {
    const state = stateAt(at(2026, 12, 25)); // Christmas Day, a friday
    expect(state.rule).toBe('holiday');
    expect(reasons.holiday.christmas_day).toContain(state.message);
  });

  it('matches rule holiday_eve', () => {
    const state = stateAt(at(2026, 7, 13)); // monday, Bastille Day is tomorrow
    expect(state.rule).toBe('holiday_eve');
    expect(state.status).toBe('KO');
    expect(reasons.holiday_tomorrow.default).toContain(state.message);
  });

  it('uses the christmas reasons on christmas eve', () => {
    const state = stateAt(at(2026, 12, 24)); // thursday, Christmas Day is tomorrow
    expect(state.rule).toBe('holiday_eve');
    expect(reasons.holiday_tomorrow.christmas_day).toContain(state.message);
  });

  it('uses the new year reasons on new years eve', () => {
    const state = stateAt(at(2026, 12, 31)); // thursday, New Year's Day is tomorrow
    expect(state.rule).toBe('holiday_eve');
    expect(reasons.holiday_tomorrow.new_years_day).toContain(state.message);
  });

  it('matches rule friday', () => {
    const state = stateAt(at(2026, 11, 20)); // friday, not the 13th, no holiday around
    expect(state.rule).toBe('friday');
    expect(state.status).toBe('KO');
    expect(reasons.friday_afternoon).toContain(state.message);
  });

  it('matches rule evening_or_night in the evening', () => {
    const state = stateAt(at(2026, 11, 18, 20)); // wednesday 20:00
    expect(state.rule).toBe('evening_or_night');
    expect(state.status).toBe('KO');
    expect(reasons.to_not_deploy).toContain(state.message);
  });

  it('matches rule evening_or_night early in the morning', () => {
    const state = stateAt(at(2026, 11, 18, 7)); // wednesday 07:00
    expect(state.rule).toBe('evening_or_night');
    expect(state.status).toBe('KO');
  });

  it('matches rule thursday_afternoon', () => {
    const state = stateAt(at(2026, 11, 19, 16)); // thursday 16:00
    expect(state.rule).toBe('thursday_afternoon');
    expect(state.status).toBe('WARNING');
    expect(reasons.thursday_afternoon).toContain(state.message);
  });

  it('matches rule afternoon', () => {
    const state = stateAt(at(2026, 11, 18, 16)); // wednesday 16:00
    expect(state.rule).toBe('afternoon');
    expect(state.status).toBe('WARNING');
    expect(reasons.afternoon).toContain(state.message);
  });

  it('matches no rule on a regular working morning', () => {
    const state = stateAt(at(2026, 11, 18, 10)); // wednesday 10:00
    expect(state.rule).toBe('none');
    expect(state.status).toBe('OK');
    expect(reasons.to_deploy).toContain(state.message);
  });

  it('only considers public holidays of the given country', () => {
    // Thanksgiving is a US public holiday, and a regular thursday morning in France
    const state = stateAt(at(2026, 11, 26, 10));
    expect(state.rule).toBe('none');
    expect(getShouldIDeployStateFromDate(at(2026, 11, 26, 10), timezone, 'US').rule).toBe('holiday');
  });
});
