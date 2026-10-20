import type { RedeemItem } from './api';
import type { MessageKey, T } from './i18n';

/** Which way a history row moved the account: money in, money out, or something else. */
export function direction(item: Pick<RedeemItem, 'type' | 'value'>): 'in' | 'out' | 'other' {
  if (item.type === 'subscription') return 'in';
  if (item.value > 0) return 'in';
  if (item.value < 0) return 'out';
  return 'other';
}

export function historyTitle(item: Pick<RedeemItem, 'type' | 'value'>, t: T): string {
  const key: MessageKey =
    item.type === 'balance'
      ? 'redeem.type.balance'
      : item.type === 'concurrency'
        ? 'redeem.type.concurrency'
        : item.type === 'subscription'
          ? 'redeem.type.subscription'
          : item.type === 'admin_balance'
            ? item.value >= 0
              ? 'redeem.type.adminAdd'
              : 'redeem.type.adminDeduct'
            : item.type === 'admin_concurrency'
              ? 'redeem.type.adminConcurrency'
              : item.type === 'affiliate_balance'
                ? 'redeem.type.affiliate'
                : item.type === 'lottery'
                  ? 'redeem.type.lottery'
                  : item.type === 'doudizhu'
                    ? 'redeem.type.ddz'
                    : item.type === 'transfer'
                      ? item.value >= 0
                        ? 'redeem.type.transferIn'
                        : 'redeem.type.transferOut'
                      : 'redeem.type.other';
  return t(key);
}

/** `+$5.00`, `−$1.20`, `+2 并发`, `30 天 · 分组`. */
export function historyValue(item: Pick<RedeemItem, 'type' | 'value' | 'validity_days' | 'group'>, t: T): string {
  if (item.type === 'subscription') {
    const days = t('redeem.days', { days: item.validity_days || Math.round(item.value) });
    return item.group?.name ? `${days} · ${item.group.name}` : days;
  }
  const sign = item.value > 0 ? '+' : item.value < 0 ? '−' : '';
  const abs = Math.abs(item.value);
  if (item.type.includes('concurrency')) return `${sign}${abs} ${t('redeem.requests')}`;
  return `${sign}$${abs.toFixed(2)}`;
}

/** The line shown after a code goes through. */
export function redeemedText(item: Pick<RedeemItem, 'type' | 'value' | 'validity_days' | 'group'>, t: T): string {
  switch (item.type) {
    case 'balance':
      return t('redeem.doneBalance', { amount: `$${item.value.toFixed(2)}` });
    case 'concurrency':
      return t('redeem.doneConcurrency', { n: item.value });
    case 'subscription': {
      const days = item.validity_days || Math.round(item.value);
      return item.group?.name
        ? t('redeem.doneSubscription', { group: item.group.name, days })
        : t('redeem.doneSubscriptionNoGroup', { days });
    }
    default:
      return t('redeem.done');
  }
}
