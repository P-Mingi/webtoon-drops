// countdown.js — runs in the browser, pure math, no API calls
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function getNextDropUTC(dayOfWeek) {
  // dayOfWeek: 0=Sun, 1=Mon, ..., 6=Sat (KST weekday)
  const now = new Date();
  const nowKST = new Date(now.getTime() + KST_OFFSET_MS);
  const currentDayKST = nowKST.getUTCDay();
  let daysAhead = (dayOfWeek - currentDayKST + 7) % 7;
  if (daysAhead === 0) daysAhead = 7; // already dropped at midnight KST → next week
  const nextMidnightKST = new Date(nowKST);
  nextMidnightKST.setUTCDate(nextMidnightKST.getUTCDate() + daysAhead);
  nextMidnightKST.setUTCHours(0, 0, 0, 0);
  return new Date(nextMidnightKST.getTime() - KST_OFFSET_MS); // real UTC
}

export function formatCountdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sc = s % 60;
  if (d > 0) {
    return `${String(d).padStart(2, '0')} : ${String(h).padStart(2, '0')} : ${String(m).padStart(2, '0')}`;
  }
  return `${String(h).padStart(2, '0')} : ${String(m).padStart(2, '0')} : ${String(sc).padStart(2, '0')}`;
}

export function formatUnits(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  return d > 0 ? ['D', 'H', 'M'] : ['H', 'M', 'S'];
}

// Returns true if a series drops today in KST
export function dropsToday(dayOfWeek) {
  const now = new Date();
  const nowKST = new Date(now.getTime() + KST_OFFSET_MS);
  return nowKST.getUTCDay() === dayOfWeek;
}

// Call this once on page load — ticks every second
export function startCountdowns() {
  function tick() {
    document.querySelectorAll('[data-countdown-day]').forEach(el => {
      const day = parseInt(el.dataset.countdownDay);
      const ms = getNextDropUTC(day) - new Date();
      el.textContent = formatCountdown(ms);
      const unitsEl = el.nextElementSibling;
      if (unitsEl?.dataset?.countdownUnits !== undefined) {
        unitsEl.textContent = formatUnits(ms).join('   ');
      }
    });
  }
  tick();
  setInterval(tick, 1000);
}
