import {
  Contact,
  CurrencyStockMovement,
  LedgerEntry,
  PartnershipLoan,
  PurchaseRecord,
  SaleRecord,
} from '../types';
import { WhatsAppDirectService } from '../services/whatsappDirectService';

export const CAISSE_AUTO_WA_STORAGE_KEY = 'camsgold_caisse_auto_whatsapp_v1';

export const getCaisseAutoWhatsappEnabled = (): boolean => {
  try {
    const raw = localStorage.getItem(CAISSE_AUTO_WA_STORAGE_KEY);
    if (raw === null) return true;
    return raw !== 'false';
  } catch {
    return true;
  }
};

export const setCaisseAutoWhatsappEnabled = (enabled: boolean): void => {
  try {
    localStorage.setItem(CAISSE_AUTO_WA_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // ignore storage errors
  }
};

export const formatCfaAmount = (val: number): string =>
  new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })
    .format(Math.round(val || 0))
    .replace(/[\u202F\u00A0]/g, ' ')
    .replace(/\u2212/g, '-');

export const normalizePhoneDigitsLocal = (raw?: string): string => {
  let digits = (raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  return digits;
};

export const maskAccountNumber = (phone?: string, fallbackAccountOrRef?: string): string => {
  const phoneDigits = normalizePhoneDigitsLocal(phone);
  if (phoneDigits.length >= 7) {
    return `${phoneDigits.slice(0, 3)}xxx${phoneDigits.slice(-4)}`;
  }
  if (phoneDigits.length >= 4) {
    return `${phoneDigits.slice(0, 2)}xxx${phoneDigits.slice(-2)}`;
  }
  const fallbackDigits = normalizePhoneDigitsLocal(fallbackAccountOrRef);
  if (fallbackDigits.length >= 7) {
    return `${fallbackDigits.slice(0, 3)}xxx${fallbackDigits.slice(-4)}`;
  }
  if (fallbackAccountOrRef && fallbackAccountOrRef.trim()) {
    return fallbackAccountOrRef.trim();
  }
  return 'CAMS-CPT';
};

export const formatCompactNumber = (val: number, maxDecimals = 2): string => {
  if (!Number.isFinite(val)) return '0';
  if (Number.isInteger(val)) return String(val);
  return val
    .toFixed(maxDecimals)
    .replace(/\.?0+$/, '')
    .replace('.', ',');
};

export const buildPurchaseWeightKaratDetails = (
  purchasesOrSingle: PurchaseRecord | PurchaseRecord[],
  prefix: 'ACHAT' | 'REGLEMENT ACHAT' = 'ACHAT'
): string => {
  const list = Array.isArray(purchasesOrSingle) ? purchasesOrSingle : [purchasesOrSingle];
  if (list.length === 0) return prefix;

  const totalNet = list.reduce(
    (sum, p) => sum + (p.netWeightGrams ?? p.grossWeightGrams ?? 0),
    0
  );
  const first = list[0];
  const rawKarat = (first.karat || '').replace(/[^\d.,]/g, '').replace(',', '.');
  const karatNum = parseFloat(rawKarat);
  const karatStr = Number.isFinite(karatNum)
    ? formatCompactNumber(karatNum, 2)
    : (first.karat || '').replace(/K$/i, '').trim();

  const refStr =
    list.length > 1
      ? `${first.reference}-${list[list.length - 1].reference}`
      : first.reference;

  return [
    prefix,
    totalNet > 0 ? `POIDS ${formatCompactNumber(totalNet, 2)}g` : '',
    karatStr ? `CARAT ${karatStr}` : '',
    refStr,
  ]
    .filter(Boolean)
    .join(' ');
};

export interface CaisseMessageParams {
  direction: 'CREDIT' | 'DEBIT' | 'COMPENSATION';
  amountXaf: number;
  contactName: string;
  phone?: string;
  accountFallback?: string;
  details: string;
  txRef: string;
  availableBalanceAfterXaf: number;
}

export const buildCaisseOperationMessage = ({
  direction,
  amountXaf,
  contactName,
  phone,
  accountFallback,
  details,
  txRef,
  availableBalanceAfterXaf,
}: CaisseMessageParams): string => {
  const amountStr = formatCfaAmount(Math.abs(amountXaf));
  const maskedAcc = maskAccountNumber(phone, accountFallback);
  const cleanDetails = details.replace(/\s+/g, ' ').trim();
  const cleanRef =
    txRef.replace(/\s+/g, '').trim() || `CS.${Date.now().toString().slice(-6)}`;
  const balanceStr = formatCfaAmount(availableBalanceAfterXaf);

  const headerVerb =
    direction === 'CREDIT'
      ? `CREDIT ${amountStr} CFA au Compte No. ${maskedAcc}`
      : direction === 'DEBIT'
      ? `DEBIT ${amountStr} CFA du Compte No. ${maskedAcc}`
      : `IMPUTATION ${amountStr} CFA sur Compte No. ${maskedAcc}`;

  const line1 = [headerVerb, cleanDetails, `REF:${cleanRef}`].filter(Boolean).join(' ');
  const line2 = `${contactName.trim() || 'Client'} Votre solde disponible est : ${balanceStr} CFA`;
  return `${line1}\n${line2}`;
};

export interface StoreLedgerSnapshot {
  contacts: Contact[];
  purchases: PurchaseRecord[];
  saleRecords: SaleRecord[];
  loans: PartnershipLoan[];
  operations: LedgerEntry[];
  currencyStockMovements: CurrencyStockMovement[];
  goldCurrencyMovements: CurrencyStockMovement[];
  officialUsdRate?: number;
}

export const resolveContactRecord = (
  contacts: Contact[],
  nameOrQuery?: string,
  reference?: string,
  phone?: string
): Contact | undefined => {
  if (reference) {
    const byRef = contacts.find((c) => c.reference === reference);
    if (byRef) return byRef;
  }
  const qName = (nameOrQuery || '').trim().toLowerCase();
  const qDigits = normalizePhoneDigitsLocal(phone || nameOrQuery);
  return contacts.find((c) => {
    if (qName && c.name.trim().toLowerCase() === qName) return true;
    if (qName && c.reference.trim().toLowerCase() === qName) return true;
    if (qDigits.length >= 6) {
      const cd = normalizePhoneDigitsLocal(c.phone);
      if (cd.length >= 6 && (cd === qDigits || cd.endsWith(qDigits) || qDigits.endsWith(cd))) {
        return true;
      }
    }
    return false;
  });
};

export const computeContactNetPositionXaf = (
  params: { name: string; reference?: string; phone?: string },
  snapshot: StoreLedgerSnapshot
): number => {
  const usdToXafFallback = snapshot.officialUsdRate || 606.85;
  const textTokens = [params.name, params.reference, params.phone]
    .map((v) => (v || '').trim().toLowerCase())
    .filter((v) => v.length > 0);
  const phoneDigits = normalizePhoneDigitsLocal(params.phone);

  const matches = (val?: string): boolean => {
    if (!val) return false;
    const lower = val.trim().toLowerCase();
    if (!lower) return false;
    if (textTokens.some((t) => lower.includes(t))) return true;
    if (phoneDigits.length >= 6) {
      const vd = normalizePhoneDigitsLocal(val);
      if (vd.length >= 6 && (vd.includes(phoneDigits) || phoneDigits.includes(vd))) return true;
    }
    return false;
  };

  const matchedPurchases = snapshot.purchases.filter(
    (p) => !p.cancelledAt && (matches(p.supplier) || matches(p.reference) || matches(p.description))
  );
  const matchedPurchaseOpIds = new Set(
    snapshot.purchases
      .filter(
        (p) =>
          p.id.startsWith('purch-') &&
          (matches(p.supplier) || matches(p.reference) || matches(p.description))
      )
      .map((p) => `op-${p.id.slice('purch-'.length)}`)
  );

  const matchedCurrency = [
    ...snapshot.currencyStockMovements,
    ...snapshot.goldCurrencyMovements.filter(
      (m) => m.type === 'Achat devise d’or' || m.type === 'Vente devise d’or'
    ),
  ].filter((m) => matches(m.contact) || matches(m.label));

  const matchedSales = snapshot.saleRecords.filter(
    (s) =>
      matches(s.clientName) ||
      matches(s.clientPhone) ||
      matches(s.clientReference) ||
      (params.reference && s.clientId === params.reference)
  );

  const matchedLoans = snapshot.loans.filter(
    (l) => matches(l.partnerName) || (l.partnerId !== undefined && matches(String(l.partnerId)))
  );

  let cashDepositsXaf = 0;
  let cashWithdrawalsXaf = 0;

  for (const op of snapshot.operations) {
    if (matchedPurchaseOpIds.has(op.id)) continue;
    if (
      op.id.startsWith('op-purchpay-') ||
      op.id.startsWith('op-salepay-') ||
      op.id.startsWith('op-loanpay-') ||
      op.id.startsWith('op-curbuy-') ||
      op.id.startsWith('op-cursell-') ||
      op.id.startsWith('op-curpay-') ||
      op.id.startsWith('op-gcurbuy-') ||
      op.id.startsWith('op-gcursell-') ||
      op.id.startsWith('op-gcurpay-')
    ) {
      continue;
    }
    if (op.isTransfer && !op.isClientTransfer) continue;
    const opMatched =
      matches(op.depositor) ||
      matches(op.beneficiary) ||
      matches(op.clientTransferDetails?.clientName) ||
      matches(op.title) ||
      matches(op.subtitle) ||
      matches(op.reference);
    if (!opMatched) continue;

    const titleLower = op.title.toLowerCase();
    if (titleLower.startsWith('achat') || titleLower.includes('échange')) continue;
    if (titleLower.startsWith('dépense')) continue;

    if (op.isIncome) {
      cashDepositsXaf += op.amount;
    } else {
      const settledPurchaseAmt = op.settledPurchaseAmountXaf
        ? Math.min(op.amount, op.settledPurchaseAmountXaf)
        : 0;
      cashWithdrawalsXaf += Math.max(0, op.amount - settledPurchaseAmt);
    }
  }

  const cashDepositNetXaf = cashDepositsXaf - cashWithdrawalsXaf;

  const goldTotalAmountXaf = matchedPurchases.reduce((sum, p) => sum + p.amount, 0);
  const goldPaidXaf = matchedPurchases.reduce(
    (sum, p) => sum + (p.payments || []).reduce((ps, pay) => ps + pay.amount, 0),
    0
  );
  const goldRemainingXaf = Math.max(0, goldTotalAmountXaf - goldPaidXaf);

  const salesRemainingXaf = matchedSales.reduce(
    (sum, s) =>
      sum +
      (s.balanceRemainingXaf ?? Math.round((s.balanceRemainingUsd || 0) * (s.usdToXafRate || usdToXafFallback))),
    0
  );

  const currencyWeOweXaf = matchedCurrency.reduce((sum, m) => {
    const isBuy = m.type.toLowerCase().startsWith('achat');
    const rem = m.creditStatus === 'settled' ? 0 : m.remainingXaf ?? 0;
    return isBuy && rem > 0 ? sum + rem : sum;
  }, 0);

  const currencyOwedToUsXaf = matchedCurrency.reduce((sum, m) => {
    const isSell = m.type.toLowerCase().startsWith('vente');
    const rem = m.creditStatus === 'settled' ? 0 : m.remainingXaf ?? 0;
    return isSell && rem > 0 ? sum + rem : sum;
  }, 0);

  let loansWeOweXaf = 0;
  let loansOwedToUsXaf = 0;
  for (const l of matchedLoans) {
    const repaid = (l.repayments || []).reduce((sum, r) => sum + r.amountXaf, 0);
    const remaining = Math.max(0, l.principalXaf - repaid);
    if (l.direction === 'companyBorrows') loansWeOweXaf += remaining;
    else loansOwedToUsXaf += remaining;
  }

  const totalInContactFavorXaf =
    Math.max(0, cashDepositNetXaf) + goldRemainingXaf + currencyWeOweXaf + loansWeOweXaf;
  const totalOwedToUsXaf =
    Math.max(0, -cashDepositNetXaf) + salesRemainingXaf + currencyOwedToUsXaf + loansOwedToUsXaf;
  return totalInContactFavorXaf - totalOwedToUsXaf;
};

export interface CaisseWhatsAppNotifyResult {
  status: 'sent' | 'no_phone' | 'disabled' | 'error';
  phone?: string;
  contactName: string;
  messageText: string;
  infoText: string;
  manualWhatsAppUrl?: string;
  mode?: string;
}

export const sendCaisseWhatsAppNotification = async (
  params: CaisseMessageParams & { enabled?: boolean }
): Promise<CaisseWhatsAppNotifyResult> => {
  const messageText = buildCaisseOperationMessage(params);
  const cleanPhone = (params.phone || '').trim();
  const digits = normalizePhoneDigitsLocal(cleanPhone);
  const manualWhatsAppUrl =
    digits.length >= 6
      ? `https://wa.me/${digits}?text=${encodeURIComponent(messageText)}`
      : `https://wa.me/?text=${encodeURIComponent(messageText)}`;

  if (params.enabled === false) {
    return {
      status: 'disabled',
      phone: cleanPhone || undefined,
      contactName: params.contactName,
      messageText,
      infoText: `Notification WhatsApp automatique désactivée (message prêt pour ${params.contactName}).`,
      manualWhatsAppUrl,
    };
  }

  if (digits.length < 6) {
    return {
      status: 'no_phone',
      contactName: params.contactName,
      messageText,
      infoText: `Aucun n° de téléphone enregistré pour ${params.contactName} — message WhatsApp non envoyé.`,
      manualWhatsAppUrl,
    };
  }

  try {
    const res = await WhatsAppDirectService.sendText(cleanPhone, messageText);
    const providerLabel =
      res.mode === 'ultramsg'
        ? 'UltraMsg'
        : res.mode === 'meta_cloud'
        ? 'Meta Cloud'
        : res.mode === 'd7'
        ? 'D7 Networks'
        : 'WhatsApp direct';
    return {
      status: 'sent',
      phone: cleanPhone,
      contactName: params.contactName,
      messageText,
      mode: res.mode,
      manualWhatsAppUrl,
      infoText: `Notification WhatsApp (${providerLabel}) envoyée à ${params.contactName} (${cleanPhone}) · Solde communiqué : ${formatCfaAmount(params.availableBalanceAfterXaf)} CFA.`,
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      status: 'error',
      phone: cleanPhone,
      contactName: params.contactName,
      messageText,
      manualWhatsAppUrl,
      infoText: `Alerte WhatsApp non envoyée pour ${params.contactName} (${errMsg}).`,
    };
  }
};
