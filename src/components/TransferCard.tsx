import { useState, type CSSProperties, type FormEvent } from 'react';
import { api, errorText } from '../api';
import { useI18n } from '../i18n';
import { dollars } from '../lottery';
import { transferAmount, transferFee } from '../transfer';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

/** Send balance to another account; the password is asked for in a confirm sheet. */
export function TransferCard({ balance, onSent, onToast }: { balance: number; onSent: () => void; onToast: (m: string) => void }) {
  const { t } = useI18n();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [confirm, setConfirm] = useState(false);
  const value = transferAmount(amount);
  const fee = value == null ? 0 : transferFee(value);
  const total = value == null ? 0 : Math.round((value + fee) * 100) / 100;
  const short = value != null && total > balance;
  const ready = recipient.trim() !== '' && value != null && !short;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (ready) setConfirm(true);
  }

  return (
    <form className="card redeem-card rise" style={{ '--i': 1.5 } as CSSProperties} onSubmit={submit}>
      <h2>{t('transfer.title')}</h2>
      <div className="transfer-fields">
        <label className="form-row">
          <span>{t('transfer.recipient')}</span>
          <input
            className="field"
            value={recipient}
            placeholder={t('transfer.recipientPlaceholder')}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            maxLength={255}
            onChange={(e) => setRecipient(e.target.value)}
          />
        </label>
        <label className="form-row">
          <span>{t('transfer.amount')}</span>
          <div className="field-money">
            <i>$</i>
            <input
              className="field"
              inputMode="decimal"
              value={amount}
              placeholder="10.00"
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            />
          </div>
        </label>
      </div>
      <button className="btn btn-primary h-11 w-full" disabled={!ready}>
        {t('transfer.submit')}
      </button>
      <p className={`redeem-note ${short ? 'bad' : ''}`}>
        {short
          ? t('transfer.short', { total: dollars(total) })
          : value != null
            ? t('transfer.feeNote', { fee: dollars(fee), total: dollars(total) })
            : amount
              ? t('transfer.amountHint')
              : t('transfer.hint')}
      </p>
      {confirm && value != null && (
        <ConfirmTransfer
          recipient={recipient.trim()}
          amount={value}
          fee={fee}
          total={total}
          onClose={() => setConfirm(false)}
          onDone={(msg) => {
            setConfirm(false);
            setRecipient('');
            setAmount('');
            onSent();
            onToast(msg);
          }}
        />
      )}
    </form>
  );
}

function ConfirmTransfer({
  recipient,
  amount,
  fee,
  total,
  onClose,
  onDone,
}: {
  recipient: string;
  amount: number;
  fee: number;
  total: number;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function send() {
    if (!password || busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.transfer(recipient, amount, password);
      onDone(t('transfer.done', { recipient: r.recipient, amount: dollars(r.amount), total: dollars(r.debited ?? total) }));
    } catch (e) {
      setError(errorText(e, t('common.genericError')));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t('transfer.confirmTitle')}
      onClose={onClose}
      footer={
        <>
          {error && <p className="mr-auto text-[13px] text-[var(--danger)]">{error}</p>}
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-primary" disabled={!password || busy} onClick={send}>
            {busy ? t('transfer.busy') : t('transfer.submit')}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <p className="confirm-text">{t('transfer.confirmText', { recipient, amount: dollars(amount), fee: dollars(fee), total: dollars(total) })}</p>
        <label className="form-row">
          <span>{t('transfer.password')}</span>
          <div className="relative">
            <Icon name="key" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
            <input
              className="field w-full pl-9"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  send();
                }
              }}
            />
          </div>
        </label>
      </div>
    </Dialog>
  );
}
