/** Smallest amount the recipient can be sent, in dollars. */
export const TRANSFER_MIN = 10;
/** The fee in basis points of the amount sent; the sender pays it on top. */
const TRANSFER_FEE_BPS = 500;

/** The typed amount as dollars, or null unless it is at least $10 with at most two decimals. */
export function transferAmount(text: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(text.trim())) return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= TRANSFER_MIN ? n : null;
}

/** The fee for sending `amount`, rounded up to the cent the way the relay charges it. */
export function transferFee(amount: number): number {
  const cents = Math.round(amount * 100);
  return Math.floor((cents * TRANSFER_FEE_BPS + 9999) / 10000) / 100;
}
