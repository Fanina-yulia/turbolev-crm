export const DEFAULT_MARKUP_PERCENT = 40;

export function calculateSellPrice(purchasePrice: number, markupPercent = DEFAULT_MARKUP_PERCENT) {
  return Math.round(purchasePrice * (1 + markupPercent / 100) * 100) / 100;
}
