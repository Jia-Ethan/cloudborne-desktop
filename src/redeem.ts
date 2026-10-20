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
  return t(historyKey(item));
}

function historyKey(item: Pick<RedeemItem, 'type' | 'value'>): MessageKey {
  switch (item.type) {
    case 'balance':
      return 'redeem.type.balance';
    case 'concurrency':
      return 'redeem.type.concurrency';
    case 'subscription':
      return 'redeem.type.subscription';
    case 'token_pack':
      return 'redeem.type.tokenPack';
    case 'chest':
      return 'redeem.type.chest';
    case 'admin_balance':
      return item.value >= 0 ? 'redeem.type.adminAdd' : 'redeem.type.adminDeduct';
    case 'admin_concurrency':
      return 'redeem.type.adminConcurrency';
    case 'affiliate_balance':
      return 'redeem.type.affiliate';
    case 'lottery':
      return 'redeem.type.lottery';
    case 'doudizhu':
      return 'redeem.type.ddz';
    case 'transfer':
      return item.value >= 0 ? 'redeem.type.transferIn' : 'redeem.type.transferOut';
    default:
      return 'redeem.type.other';
  }
}

/** `+$5.00`, `−$1.20`, `+2 并发`, `30 天 · 分组`. */
export function historyValue(item: Pick<RedeemItem, 'type' | 'value' | 'validity_days' | 'group'>, t: T): string {
  if (item.type === 'subscription') {
    const days = t('redeem.days', { days: item.validity_days || Math.round(item.value) });
    return item.group?.name ? `${days} · ${item.group.name}` : days;
  }
  if (item.type === 'token_pack') {
    const tokens = `${item.value}M`;
    return item.group?.name ? `${tokens} · ${item.group.name}` : tokens;
  }
  if (item.type === 'chest') return t('redeem.chestCount', { n: item.value });
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
    case 'token_pack': {
      const tokens = `${item.value}M`;
      return item.group?.name ? t('redeem.doneTokenPack', { group: item.group.name, tokens }) : t('redeem.doneTokenPackNoGroup', { tokens });
    }
    case 'chest':
      return t('redeem.doneChest', { n: item.value });
    default:
      return t('redeem.done');
  }
}
