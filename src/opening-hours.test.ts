import { describe, expect, it } from 'vitest';
import { openingHoursStatus } from './opening-hours';

describe('openingHoursStatus', () => {
  it('shows when a place is open and closes later', () => {
    expect(openingHoursStatus('Mo-Fr 09:00-18:00', new Date(2026, 9, 26, 12, 0))?.text).toBe('Open now · closes at 18:00');
  });
  it('marks places closing within an hour', () => {
    expect(openingHoursStatus('Su 10:00-12:00', new Date(2026, 9, 25, 11, 30))?.kind).toBe('closing');
  });
  it('finds the next opening today after a split-shift break', () => {
    expect(openingHoursStatus('Mo-Fr 09:00-12:00,13:00-17:00', new Date(2026, 9, 26, 12, 30))?.text).toBe('Closed · opens today at 13:00');
  });
  it('finds tomorrow when the place is closed for the rest of today', () => {
    expect(openingHoursStatus('Mo-Fr 09:00-17:00', new Date(2026, 9, 25, 12, 0))?.text).toBe('Closed · opens tomorrow at 09:00');
  });
  it('handles overnight intervals and always-open places', () => {
    expect(openingHoursStatus('Mo-Su 22:00-02:00', new Date(2026, 9, 26, 0, 30))?.kind).toBe('open');
    expect(openingHoursStatus('24/7', new Date(2026, 9, 26, 1, 0))?.text).toBe('Open 24 hours');
  });
  it('keeps unsupported schedules informational instead of guessing', () => {
    expect(openingHoursStatus('sunrise-sunset')?.text).toBe('Hours listed');
    expect(openingHoursStatus(undefined)).toBeNull();
  });
});
