/**
 * Payments dated in a closed Day Book month (before `openFrom`, the 1st of last month: cashOpenFrom
 * in src/services/finance.service.ts). Their cash was carried forward, so nothing may add, remove
 * or change them (firestore.rules refuses it too). Old-software money never was in the drawer and
 * is not counted.
 */
export function closedMoney<T extends { paymentDate: string; oldSoftware?: boolean }>(
  payments: T[],
  openFrom: string,
) {
  return payments.filter((p) => !p.oldSoftware && !!p.paymentDate && p.paymentDate < openFrom);
}

/**
 * Why money from the Recycle Bin can't be put back, or "" when it can: never into a closed Day
 * Book month, and money given back (a refund) only by Finance, as when it was first given.
 */
export function putBackProblem(
  payments: { paymentDate: string; amount: number; oldSoftware?: boolean }[],
  openFrom: string,
  finance: boolean,
  nice: (day: string) => string = (day) => day,
) {
  const shut = closedMoney(payments, openFrom)[0];
  if (shut)
    return `This has money dated ${nice(shut.paymentDate)}, in a closed Day Book month: it can't be put back.`;
  if (!finance && payments.some((p) => p.amount < 0))
    return "Only Finance can put back money given back.";
  return "";
}
