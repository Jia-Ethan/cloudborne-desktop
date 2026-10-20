/** The typed amount as dollars, or null unless it is at least $1 with at most two decimals. */
export function transferAmount(text: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(text.trim())) return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 1 ? n : null;
}
