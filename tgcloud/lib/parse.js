// Pulls a payment amount out of a bank bot's notification text.
// Returns { currency: 'USD' | 'KHR', amount } with amount in hundredths, or null.

const NUM = '([\\d,]+(?:\\.\\d{1,2})?)';

const PATTERNS = [
  ['USD', new RegExp(`\\$\\s*${NUM}`)],         // "$12.34", "$1,234"
  ['USD', new RegExp(`${NUM}\\s*ដុល្លារ`)],      // "12.34 ដុល្លារ"
  ['USD', new RegExp(`${NUM}\\s*USD\\b`, 'i')],  // "12.34 USD"
  ['KHR', new RegExp(`៛\\s*${NUM}`)],            // "៛4,000"
  ['KHR', new RegExp(`${NUM}\\s*(?:រៀល|៛)`)],    // "4,000 រៀល", "4000៛"
  ['KHR', new RegExp(`${NUM}\\s*KHR\\b`, 'i')],  // "4,000 KHR"
];

export function parseAmount(text) {
  if (!text) return null;
  for (const [currency, re] of PATTERNS) {
    const match = re.exec(text);
    if (!match) continue;
    const value = Number(match[1].replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    return { currency, amount: Math.round(value * 100) };
  }
  return null;
}
