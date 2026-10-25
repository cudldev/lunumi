type Rule = { days: Set<number>; intervals: Array<[number, number]>; closed: boolean };
export type OpeningStatus = { kind: 'open' | 'closing' | 'closed' | 'unknown'; text: string };

const weekdays = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const clockText = (date: Date) => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
const dayText = (date: Date, now: Date) => {
  const day = (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000;
  if (day === 0) return 'today';
  if (day === 1) return 'tomorrow';
  return new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(date);
};

function parseRules(schedule: string): Rule[] | null {
  if (/^\s*24\/7\s*$/.test(schedule)) return [{ days: new Set([0, 1, 2, 3, 4, 5, 6]), intervals: [[0, 1440]], closed: false }];
  const rules: Rule[] = [];
  for (const raw of schedule.split(';').map(part => part.trim()).filter(Boolean)) {
    const ranges = [...raw.matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g)];
    const remainder = raw.replace(/\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}/g, '').trim();
    const closed = /\b(off|closed)\b/i.test(remainder);
    const dayMatches = [...remainder.matchAll(/\b(Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(Mo|Tu|We|Th|Fr|Sa|Su))?\b/g)];
    let residue = remainder.replace(/\b(off|closed|open)\b/ig, '').replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(Mo|Tu|We|Th|Fr|Sa|Su))?\b/g, '').replace(/[\s,]+/g, '');
    if (residue || (!closed && ranges.length === 0)) return null;
    const days = new Set<number>();
    if (!dayMatches.length) weekdays.forEach((_, index) => days.add(index));
    for (const match of dayMatches) {
      const start = weekdays.indexOf(match[1]);
      const end = match[2] ? weekdays.indexOf(match[2]) : start;
      if (start < 0 || end < 0) return null;
      for (let day = start; ; day = (day + 1) % 7) { days.add(day); if (day === end) break; }
    }
    const intervals: Array<[number, number]> = [];
    for (const range of ranges) {
      const start = Number(range[1]) * 60 + Number(range[2]);
      let end = Number(range[3]) * 60 + Number(range[4]);
      if (Number(range[1]) > 24 || Number(range[2]) > 59 || Number(range[3]) > 24 || Number(range[4]) > 59 || start >= 1440 || end > 1440) return null;
      if (end <= start) end += 1440;
      intervals.push([start, end]);
    }
    rules.push({ days, intervals, closed });
  }
  return rules.length ? rules : null;
}

export function openingHoursStatus(schedule?: string, now = new Date()): OpeningStatus | null {
  if (!schedule?.trim()) return null;
  const rules = parseRules(schedule);
  if (!rules) return { kind: 'unknown', text: 'Hours listed' };
  if (/^\s*24\/7\s*$/.test(schedule)) return { kind: 'open', text: 'Open 24 hours' };

  const intervals: Array<[Date, Date]> = [];
  for (let offset = -1; offset <= 8; offset++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const weekday = (date.getDay() + 6) % 7;
    let dayIntervals: Array<[Date, Date]> = [];
    for (const rule of rules) {
      if (!rule.days.has(weekday)) continue;
      if (rule.closed) dayIntervals = [];
      else for (const [start, end] of rule.intervals) {
        const startAt = new Date(date); startAt.setHours(Math.floor(start / 60), start % 60, 0, 0);
        const endAt = new Date(date); endAt.setHours(Math.floor(end / 60), end % 60, 0, 0);
        dayIntervals.push([startAt, endAt]);
      }
    }
    intervals.push(...dayIntervals);
  }
  const current = intervals.find(([start, end]) => start <= now && now < end);
  if (current) {
    const minutesLeft = (current[1].getTime() - now.getTime()) / 60000;
    if (minutesLeft <= 60) return { kind: 'closing', text: `Closing soon · closes at ${clockText(current[1])}` };
    return { kind: 'open', text: `Open now · closes at ${clockText(current[1])}` };
  }
  const next = intervals.filter(([start]) => start > now).sort((a, b) => a[0].getTime() - b[0].getTime())[0];
  if (!next) return { kind: 'closed', text: 'Closed · opening time unavailable' };
  return { kind: 'closed', text: `Closed · opens ${dayText(next[0], now)} at ${clockText(next[0])}` };
}
