// Other extensions often write dates with the browser's locale. Only the US
// short format ("11/17/26, 1:26:59 AM" or "11/17/2026, 1:26:59 AM") is
// unambiguous enough to read back; day-first locales would be guessed wrong.
const US_DATE_TIME =
  /(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?/i

// Finds a US date and time in `text`, or requires `text` to be exactly one
// when `exact` is set. Returns a local-time timestamp.
export function parseUsDateTime(
  text: string,
  { exact = false } = {},
): number | undefined {
  const match = US_DATE_TIME.exec(text)
  if (!match || (exact && match[0] !== text.trim())) return undefined
  const [, month, day, year, hour, minute, second, meridiem] = match
  let hours = Number(hour)
  if (meridiem) {
    if (hours < 1 || hours > 12) return undefined
    hours = (hours % 12) + (/p/i.test(meridiem) ? 12 : 0)
  }
  const fullYear = year.length === 2 ? 2000 + Number(year) : Number(year)
  const date = new Date(
    fullYear,
    Number(month) - 1,
    Number(day),
    hours,
    Number(minute),
    Number(second ?? 0),
  )
  // Reject rollovers such as 13/40/26.
  if (
    date.getFullYear() !== fullYear ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day) ||
    date.getHours() !== hours
  )
    return undefined
  return date.getTime()
}
