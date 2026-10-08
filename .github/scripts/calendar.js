// 台灣上班日判斷（與 index.html 的 TW_FIXED_HOLIDAYS / TW_EXTRA_HOLIDAYS / isTWHoliday 保持一致）
const TW_FIXED_HOLIDAYS = new Set(["01-01","02-28","04-04","10-10"]);
const TW_EXTRA_HOLIDAYS = new Set([
  "2025-01-27","2025-01-28","2025-01-29","2025-01-30","2025-05-30","2025-05-31","2025-10-06",
  "2026-02-17","2026-02-18","2026-02-19","2026-02-20","2026-06-19","2026-09-25",
  "2027-02-06","2027-02-07","2027-02-08","2027-02-09","2027-06-09","2027-10-03",
  "2028-01-26","2028-01-27","2028-01-28","2028-01-29","2028-01-30","2028-05-28","2028-09-21",
  "2029-02-13","2029-02-14","2029-02-15","2029-02-16","2029-06-16",
  "2030-02-03","2030-02-04","2030-02-05","2030-02-06","2030-06-05","2030-09-29",
]);

function isTWHoliday(y, mon, day) {
  const mmdd = `${String(mon).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  if (TW_FIXED_HOLIDAYS.has(mmdd) || TW_EXTRA_HOLIDAYS.has(`${y}-${mmdd}`)) return true;
  const isFixed = dt => TW_FIXED_HOLIDAYS.has(`${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`);
  const next = new Date(y, mon - 1, day + 1), prev = new Date(y, mon - 1, day - 1);
  return (isFixed(next) && next.getDay() === 6) || (isFixed(prev) && prev.getDay() === 0);
}

function isWorkday(y, mon, day) {
  const w = new Date(y, mon - 1, day).getDay();
  return w !== 0 && w !== 6 && !isTWHoliday(y, mon, day);
}

module.exports = { isWorkday };
