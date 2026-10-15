// iCal (.ics) の最小パーサー
// Google カレンダーの公開 iCal から予定 (VEVENT) を取り出し、日付を日本時間に揃える

const TIME_ZONE = 'Asia/Tokyo';

// 折り返し行 (先頭が空白/タブ) を前の行に連結する
function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

function unescapeText(value) {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\([,;\\])/g, '$1');
}

// "20261018" / "20261018T010000Z" / "20261018T100000" (TZID付き) を YYYY-MM-DD に
function toDate(value) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, utc] = m;
  if (!h || !utc) return `${y}-${mo}-${d}`;
  const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TIME_ZONE }).format(date);
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function parseIcs(text) {
  const events = [];
  let current = null;

  for (const line of unfold(text).split('\n')) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const [name, ...params] = line.slice(0, colon).split(';');
    const value = line.slice(colon + 1);
    current[name.toUpperCase()] = { value, params };
  }

  return events
    .map((e) => {
      const start = e.DTSTART && toDate(e.DTSTART.value);
      if (!start) return null;
      const allDay = !e.DTSTART.value.includes('T');
      let end = e.DTEND && toDate(e.DTEND.value);
      // 終日予定の DTEND は「翌日」なので1日戻す
      if (end && allDay) end = addDays(end, -1);
      if (!end || end < start) end = start;
      return {
        uid: e.UID ? e.UID.value : '',
        date: start,
        endDate: end,
        summary: e.SUMMARY ? unescapeText(e.SUMMARY.value).trim() : '',
        description: e.DESCRIPTION ? unescapeText(e.DESCRIPTION.value).trim() : '',
        location: e.LOCATION ? unescapeText(e.LOCATION.value).trim() : '',
        status: e.STATUS ? e.STATUS.value : '',
        recurring: Boolean(e.RRULE),
      };
    })
    .filter(Boolean);
}

module.exports = { parseIcs, addDays, TIME_ZONE };
