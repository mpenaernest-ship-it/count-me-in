import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Coins,
  DollarSign,
  Plus,
  Save,
  ShieldCheck,
} from 'lucide-react';
import { AppPanel, SectionHeading } from '../common/UIComponents';
import {
  CurrencyRateInventoryEntry,
  GOLD_CARAT_LIST_BY_CATEGORY,
  GoldPriceQuoteEntry,
  OR_BRUT_CARATS,
  BIJOUX_CARATS,
  PriceApprovalStatus,
  WhatsAppAutomationState,
} from '../../types/whatsappAutomation';
import { formatMoney, formatPriceCard } from '../../utils/goldMath';

interface WhatsAppPricesStockTabProps {
  automationState: WhatsAppAutomationState;
  canValidate: boolean;
  actorName: string;
  actorRole: string;
  onSaveGoldPrice: (
    quote: Partial<GoldPriceQuoteEntry> & { category: 'OR_BRUT' | 'OR_FONDU' | 'BIJOUX' }
  ) => Promise<void>;
  onSaveCurrencyRates: (rates: CurrencyRateInventoryEntry[], summaryNote?: string) => Promise<void>;
}

const GOLD_CATEGORIES: Array<{
  key: 'OR_BRUT' | 'OR_FONDU' | 'BIJOUX';
  title: string;
  subtitle: string;
  frequencyLabel: string;
}> = [
  {
    key: 'OR_BRUT',
    title: 'Or brut',
    subtitle: 'Saisie manuelle des prix par gramme pour 23K, 22K, 21K et 20K (validés)',
    frequencyLabel: 'Diffusion hebdomadaire',
  },
  {
    key: 'OR_FONDU',
    title: 'Or fondu',
    subtitle: 'Saisie manuelle du prix au carat (validé sans décimale à l’envoi)',
    frequencyLabel: 'Diffusion quotidienne',
  },
  {
    key: 'BIJOUX',
    title: 'Bijoux',
    subtitle: 'Saisie manuelle des prix par gramme pour 22K, 21K, 18K, 14K et 9K (validés)',
    frequencyLabel: 'Diffusion hebdomadaire',
  },
];

const isValidUntilExpired = (validUntil?: string): boolean => {
  const raw = (validUntil || '').trim();
  if (!raw) return false;
  let normalized = raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    normalized = `${normalized}T23:59:59+01:00`;
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(normalized)) {
    normalized = `${normalized}+01:00`;
  }
  const ts = Date.parse(normalized);
  if (Number.isNaN(ts)) return false;
  return ts < Date.now();
};

const addDaysLocalEndOfDay = (daysAhead: number): string => {
  const target = new Date(Date.now() + daysAhead * 86400_000);
  const y = target.getFullYear();
  const m = String(target.getMonth() + 1).padStart(2, '0');
  const d = String(target.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}T23:59`;
};

const statusBadge = (status: PriceApprovalStatus) => {
  if (status === 'validated') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-extrabold uppercase">
        <CheckCircle2 size={11} /> Validé
      </span>
    );
  }
  if (status === 'expired') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-800 text-[10px] font-extrabold uppercase">
        <AlertTriangle size={11} /> Expiré
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-extrabold uppercase">
      Brouillon
    </span>
  );
};

export const WhatsAppPricesStockTab: React.FC<WhatsAppPricesStockTabProps> = ({
  automationState,
  canValidate,
  actorName,
  onSaveGoldPrice,
  onSaveCurrencyRates,
}) => {
  const [goldDrafts, setGoldDrafts] = useState(automationState.goldPrices);
  const [currencyDrafts, setCurrencyDrafts] = useState<CurrencyRateInventoryEntry[]>(
    automationState.currencyRates
  );
  const goldDraftsDirty = useRef(false);
  const currencyDraftsDirty = useRef(false);
  const [newCurrencyCode, setNewCurrencyCode] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  useEffect(() => {
    if (!goldDraftsDirty.current) setGoldDrafts(automationState.goldPrices);
    if (!currencyDraftsDirty.current) setCurrencyDrafts(automationState.currencyRates);
  }, [automationState.goldPrices, automationState.currencyRates]);

  const updateGoldField = (
    cat: 'OR_BRUT' | 'OR_FONDU' | 'BIJOUX',
    patch: Partial<GoldPriceQuoteEntry>
  ) => {
    goldDraftsDirty.current = true;
    setGoldDrafts((prev) => ({
      ...prev,
      [cat]: {
        ...prev[cat],
        ...patch,
      },
    }));
  };

  const updateGoldKaratPrice = (
    cat: 'OR_BRUT' | 'BIJOUX',
    karatKey: string,
    value: number
  ) => {
    goldDraftsDirty.current = true;
    setGoldDrafts((prev) => {
      const current = prev[cat];
      const nextKarats = {
        ...(current.karatPricesXaf || {}),
        [karatKey]: Math.max(0, Number.isFinite(value) ? value : 0),
      };
      const firstPositive =
        GOLD_CARAT_LIST_BY_CATEGORY[cat].map((k) => nextKarats[k] || 0).find((v) => v > 0) || 0;
      return {
        ...prev,
        [cat]: {
          ...current,
          karatPricesXaf: nextKarats,
          pricePerGramXaf: firstPositive,
          unit: 'gramme',
          status: 'draft',
        },
      };
    });
  };

  const handleSaveGold = async (
    cat: 'OR_BRUT' | 'OR_FONDU' | 'BIJOUX',
    targetStatus: PriceApprovalStatus
  ) => {
    if (targetStatus === 'validated' && !canValidate) return;
    const item = goldDrafts[cat];

    if (cat === 'OR_FONDU') {
      if (targetStatus === 'validated' && (!item.pricePerGramXaf || item.pricePerGramXaf <= 0)) {
        setFeedback({
          type: 'error',
          text: 'Impossible de valider Or fondu : le prix par carat doit être supérieur à 0 FCFA.',
        });
        return;
      }
    } else {
      const requiredCarats = GOLD_CARAT_LIST_BY_CATEGORY[cat];
      const karatMap = item.karatPricesXaf || {};
      const missingCarats = requiredCarats.filter((k) => !(Number(karatMap[k]) > 0));
      if (targetStatus === 'validated' && missingCarats.length > 0) {
        setFeedback({
          type: 'error',
          text: `Impossible de valider ${cat === 'OR_BRUT' ? 'Or brut' : 'Bijoux'} : renseignez un prix/gramme supérieur à 0 FCFA pour : ${missingCarats.join(', ')}.`,
        });
        return;
      }
    }

    setSavingKey(cat);
    setFeedback(null);
    const cleanedValidUntil =
      targetStatus === 'validated' && isValidUntilExpired(item.validUntil)
        ? ''
        : item.validUntil || '';
    try {
      await onSaveGoldPrice({
        ...item,
        category: cat,
        source: 'manual',
        unit: cat === 'OR_FONDU' ? 'carat' : 'gramme',
        validUntil: cleanedValidUntil,
        status: targetStatus,
      });
      goldDraftsDirty.current = false;
      setFeedback({
        type: 'success',
        text:
          targetStatus === 'validated'
            ? `Tarif ${cat} validé et prêt pour la diffusion${cleanedValidUntil ? '' : ' (validité illimitée tant que non modifié)'}.`
            : `Tarif ${cat} enregistré en brouillon.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erreur de sauvegarde.',
      });
    } finally {
      setSavingKey(null);
    }
  };

  const updateCurrencyRow = (code: string, patch: Partial<CurrencyRateInventoryEntry>) => {
    currencyDraftsDirty.current = true;
    setCurrencyDrafts((prev) =>
      prev.map((row) => {
        if (row.code !== code) return row;
        const merged = { ...row, ...patch };
        merged.availableStock = Math.max(
          0,
          (Number(merged.physicalStock) || 0) - (Number(merged.reservedStock) || 0)
        );
        return merged;
      })
    );
  };

  const handleAddCurrency = () => {
    const code = newCurrencyCode.trim().toUpperCase();
    if (!code || currencyDrafts.some((c) => c.code === code)) return;
    currencyDraftsDirty.current = true;
    setCurrencyDrafts((prev) => [
      ...prev,
      {
        code,
        buyRateXaf: 0,
        sellRateXaf: 0,
        physicalStock: 0,
        reservedStock: 0,
        availableStock: 0,
        minAnnounceStock: 100,
        status: 'draft',
        validUntil: '',
        updatedAt: new Date().toISOString(),
        updatedBy: actorName,
      },
    ]);
    setNewCurrencyCode('');
  };

  const handleSaveAllCurrencies = async (approveAll: boolean) => {
    if (approveAll && !canValidate) return;
    if (approveAll) {
      const anyPositive = currencyDrafts.some((r) => r.buyRateXaf > 0 || r.sellRateXaf > 0);
      if (!anyPositive) {
        setFeedback({
          type: 'error',
          text: 'Renseignez au moins un Prix Achat ou Prix Vente (supérieur à 0 FCFA) avant de valider les devises.',
        });
        return;
      }
    }
    setSavingKey('currencies');
    setFeedback(null);
    try {
      const nowIso = new Date().toISOString();
      const validatedCodes: string[] = [];
      const skippedCodes: string[] = [];
      const payload = currencyDrafts.map((row) => {
        const hasRate = row.buyRateXaf > 0 || row.sellRateXaf > 0;
        const nextStatus: PriceApprovalStatus = approveAll
          ? hasRate
            ? 'validated'
            : 'draft'
          : row.status === 'validated' && !canValidate
            ? 'draft'
            : row.status;
        if (approveAll) {
          if (hasRate) validatedCodes.push(row.code);
          else skippedCodes.push(row.code);
        }
        const cleanedValidUntil =
          nextStatus === 'validated' && isValidUntilExpired(row.validUntil)
            ? ''
            : row.validUntil || '';
        return {
          ...row,
          validUntil: cleanedValidUntil,
          status: nextStatus,
          ...(nextStatus === 'validated'
            ? { validatedAt: nowIso, validatedBy: actorName }
            : {}),
        };
      });
      await onSaveCurrencyRates(
        payload,
        approveAll
          ? `Validation taux & stocks devises par ${actorName} (${validatedCodes.join(', ')}).`
          : `Enregistrement brouillon des taux & stocks devises.`
      );
      currencyDraftsDirty.current = false;
      setFeedback({
        type: 'success',
        text: approveAll
          ? `Devises validées : ${validatedCodes.join(', ')}.${
              skippedCodes.length > 0
                ? ` Restées en brouillon (tarif 0 FCFA) : ${skippedCodes.join(', ')}.`
                : ''
            }`
          : 'Taux et inventaire enregistrés en brouillon.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Impossible d’enregistrer les devises.',
      });
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="space-y-6">
      {!canValidate && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs font-semibold text-amber-900 flex items-center gap-2">
          <ShieldCheck size={16} className="shrink-0" />
          <span>
            Sécurité (Section 8) : vous pouvez préparer les tarifs en <strong>brouillon</strong>, mais seul un utilisateur autorisé (droit <code>sms.validate</code>) peut les <strong>valider</strong> pour autoriser l’envoi WhatsApp.
          </span>
        </div>
      )}

      {feedback && (
        <div
          className={`p-3 rounded-xl border text-xs font-bold ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Contrôle rapide d'éligibilité des tarifs pour l'automatisation */}
      <AppPanel className="space-y-3">
        <div className="text-xs font-black text-[#192A24] uppercase tracking-wider">
          État de diffusion des tarifs (prérequis envoi 09h00 &amp; exceptionnel)
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 text-xs">
          {(['OR_BRUT', 'OR_FONDU', 'BIJOUX'] as const).map((cat) => {
            const q = automationState.goldPrices[cat];
            const ready =
              q.status === 'validated' &&
              (cat === 'OR_FONDU'
                ? q.pricePerGramXaf > 0
                : GOLD_CARAT_LIST_BY_CATEGORY[cat].every((k) => (q.karatPricesXaf?.[k] || 0) > 0));
            return (
              <div
                key={cat}
                className={`p-2.5 rounded-xl border space-y-1 ${
                  ready
                    ? 'bg-emerald-50/70 border-emerald-200'
                    : q.status === 'expired'
                      ? 'bg-red-50 border-red-200'
                      : 'bg-amber-50/70 border-amber-200'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="font-extrabold text-[#192A24]">
                    {cat === 'OR_BRUT' ? 'Or brut' : cat === 'OR_FONDU' ? 'Or fondu' : 'Bijoux'}
                  </span>
                  {statusBadge(q.status)}
                </div>
                <div className="text-[11px] text-[#555B54]">
                  {ready
                    ? 'Prêt pour envoi'
                    : q.status === 'expired'
                      ? 'Date limite dépassée'
                      : q.pricePerGramXaf <= 0
                        ? 'Prix non saisi (0 FCFA)'
                        : 'En brouillon : cliquez Valider'}
                </div>
              </div>
            );
          })}
          {(() => {
            const validBuy = automationState.currencyRates.filter(
              (r) => r.status === 'validated' && r.buyRateXaf > 0
            );
            const validSellStock = automationState.currencyRates.filter((r) => {
              const avail = Math.max(0, r.physicalStock - r.reservedStock);
              return (
                r.status === 'validated' &&
                r.sellRateXaf > 0 &&
                avail > 0 &&
                avail >= (r.minAnnounceStock || 0)
              );
            });
            return (
              <>
                <div
                  className={`p-2.5 rounded-xl border space-y-1 ${
                    validBuy.length > 0
                      ? 'bg-emerald-50/70 border-emerald-200'
                      : 'bg-amber-50/70 border-amber-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-extrabold text-[#192A24]">Fourn. Devises</span>
                    <span className="text-[10px] font-black text-[#192A24]">
                      {validBuy.length} validée(s)
                    </span>
                  </div>
                  <div className="text-[11px] text-[#555B54]">
                    {validBuy.length > 0
                      ? `Actif : ${validBuy.map((r) => r.code).join(', ')}`
                      : 'Aucun prix d’achat validé (> 0 FCFA)'}
                  </div>
                </div>
                <div
                  className={`p-2.5 rounded-xl border space-y-1 ${
                    validSellStock.length > 0
                      ? 'bg-emerald-50/70 border-emerald-200'
                      : 'bg-amber-50/70 border-amber-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-extrabold text-[#192A24]">Client Devises</span>
                    <span className="text-[10px] font-black text-[#192A24]">
                      {validSellStock.length} prête(s)
                    </span>
                  </div>
                  <div className="text-[11px] text-[#555B54]">
                    {validSellStock.length > 0
                      ? `Actif : ${validSellStock.map((r) => r.code).join(', ')}`
                      : 'Prix de vente ou stock dispo requis'}
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      </AppPanel>

      {/* A. Prix de l'or */}
      <AppPanel className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionHeading
            title="Prix d’achat de l’Or (Or brut /g par carat, Or fondu /carat, Bijoux /g par carat)"
            icon={<Coins size={18} />}
          />
          <span className="inline-flex items-center px-3 py-1 rounded-lg bg-[#FAF8F3] border border-[#E8D8BE] text-[11px] font-bold text-[#7D8176]">
            Saisie manuelle uniquement
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {GOLD_CATEGORIES.map(({ key, title, subtitle, frequencyLabel }) => {
            const q = goldDrafts[key];
            const isFondu = key === 'OR_FONDU';
            const requiredCarats =
              key === 'OR_BRUT' ? OR_BRUT_CARATS : key === 'BIJOUX' ? BIJOUX_CARATS : [];
            const ref24k =
              isFondu && q.reference24kPerGramXaf && q.reference24kPerGramXaf > 0
                ? q.reference24kPerGramXaf
                : isFondu && q.pricePerGramXaf > 0
                  ? Math.round(q.pricePerGramXaf * 24)
                  : 0;

            return (
              <div
                key={key}
                className="p-4 rounded-2xl bg-[#FAF8F3] border border-[#E8D8BE] space-y-3 flex flex-col justify-between"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-black text-[#192A24]">{title}</div>
                      <div className="text-[11px] text-[#7D8176]">{frequencyLabel}</div>
                    </div>
                    {statusBadge(q.status)}
                  </div>
                  <p className="text-[11px] text-[#555B54]">{subtitle}</p>

                  {isFondu ? (
                    <>
                      <div>
                        <label className="block text-[11px] font-bold text-[#7D8176] mb-1">
                          Prix d’achat ({q.currency || 'FCFA'} / carat)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={q.pricePerGramXaf || ''}
                          onChange={(e) => {
                            const val = Number(e.target.value) || 0;
                            updateGoldField('OR_FONDU', {
                              pricePerGramXaf: val,
                              reference24kPerGramXaf: val > 0 ? Math.round(val * 24) : 0,
                              unit: 'carat',
                              status: 'draft',
                            });
                          }}
                          placeholder="Ex: 3004.97"
                          className="w-full px-3 py-2 rounded-xl bg-white border border-[#E8D8BE] text-sm font-extrabold text-[#192A24]"
                        />
                        {q.pricePerGramXaf > 0 && (
                          <div className="mt-1.5 px-2.5 py-1.5 rounded-lg bg-[#FFF4D6]/60 border border-[#E8D8BE] text-[10px] font-semibold text-[#7A5610] space-y-0.5">
                            <div>
                              Formule Fondu : ({formatMoney(ref24k)} F / 24) ={' '}
                              <strong>{formatPriceCard(q.pricePerGramXaf, 2)} FCFA / carat</strong>
                            </div>
                            <div className="text-[#192A24]">
                              Envoyé sur WhatsApp :{' '}
                              <strong>{formatMoney(Math.trunc(q.pricePerGramXaf))} FCFA / carat</strong>{' '}
                              (sans décimale)
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-bold text-[#7D8176] mb-1">
                            Unité
                          </label>
                          <input
                            type="text"
                            readOnly
                            value="carat"
                            className="w-full px-2.5 py-1.5 rounded-lg bg-gray-100 border border-[#E8D8BE] text-xs font-bold text-[#555B54]"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-[#7D8176] mb-1">
                            Devise réf.
                          </label>
                          <input
                            type="text"
                            value={q.currency}
                            onChange={(e) => updateGoldField(key, { currency: e.target.value })}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-white border border-[#E8D8BE] text-xs"
                          />
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-bold text-[#7D8176]">
                            Tarifs manuels par gramme ({q.currency || 'FCFA'} / g)
                          </span>
                        </div>

                        <div className="space-y-1.5">
                          {requiredCarats.map((karatKey) => {
                            const val = q.karatPricesXaf?.[karatKey] || 0;
                            return (
                              <div
                                key={karatKey}
                                className="flex items-center gap-2 bg-white px-2.5 py-1.5 rounded-xl border border-[#E8D8BE]"
                              >
                                <span className="w-10 text-xs font-black text-[#192A24] shrink-0">
                                  {karatKey.toLowerCase()} :
                                </span>
                                <input
                                  type="number"
                                  min={0}
                                  value={val || ''}
                                  onChange={(e) =>
                                    updateGoldKaratPrice(
                                      key,
                                      karatKey,
                                      Number(e.target.value) || 0
                                    )
                                  }
                                  placeholder="0"
                                  className="w-full text-right text-xs font-extrabold text-[#192A24] bg-transparent outline-none"
                                />
                                <span className="text-[10px] font-bold text-[#7D8176] shrink-0">
                                  FCFA / g
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-bold text-[#7D8176] mb-1">
                            Unité
                          </label>
                          <input
                            type="text"
                            readOnly
                            value="gramme"
                            className="w-full px-2.5 py-1.5 rounded-lg bg-gray-100 border border-[#E8D8BE] text-xs font-bold text-[#555B54]"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-[#7D8176] mb-1">
                            Devise réf.
                          </label>
                          <input
                            type="text"
                            value={q.currency}
                            onChange={(e) => updateGoldField(key, { currency: e.target.value })}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-white border border-[#E8D8BE] text-xs"
                          />
                        </div>
                      </div>
                    </>
                  )}

                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <label className="block text-[10px] font-bold text-[#7D8176]">
                        Valide jusqu’au (optionnel)
                      </label>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => updateGoldField(key, { validUntil: '' })}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold border cursor-pointer ${
                            !q.validUntil
                              ? 'bg-[#192A24] text-white border-[#192A24]'
                              : 'bg-white text-[#555B54] border-[#E8D8BE]'
                          }`}
                        >
                          Illimitée
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updateGoldField(key, { validUntil: addDaysLocalEndOfDay(7) })
                          }
                          className="px-1.5 py-0.5 rounded text-[10px] font-bold border bg-white text-[#555B54] border-[#E8D8BE] cursor-pointer"
                        >
                          +7j
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updateGoldField(key, { validUntil: addDaysLocalEndOfDay(30) })
                          }
                          className="px-1.5 py-0.5 rounded text-[10px] font-bold border bg-white text-[#555B54] border-[#E8D8BE] cursor-pointer"
                        >
                          +30j
                        </button>
                      </div>
                    </div>
                    <input
                      type="datetime-local"
                      value={(q.validUntil || '').slice(0, 16)}
                      onChange={(e) => updateGoldField(key, { validUntil: e.target.value })}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-white border border-[#E8D8BE] text-xs"
                    />
                    <div className="mt-1 text-[10px] text-[#7D8176]">
                      {!q.validUntil
                        ? 'Sans limite : reste actif chaque matin à 09h00 jusqu’à modification.'
                        : isValidUntilExpired(q.validUntil)
                          ? 'Date expirée : cliquez « Valider » ou « Illimitée » pour réactiver.'
                          : 'Expire automatiquement à la date indiquée.'}
                    </div>
                  </div>

                  <div className="text-[10px] text-[#7D8176] pt-1">
                    Modifié par <strong>{q.updatedBy}</strong> ·{' '}
                    {q.updatedAt ? new Date(q.updatedAt).toLocaleString('fr-FR') : '—'}
                    {q.validatedBy && q.status === 'validated' && (
                      <div>Validé par {q.validatedBy}</div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-2 border-t border-[#E8D8BE]">
                  <button
                    type="button"
                    disabled={savingKey === key}
                    onClick={() => void handleSaveGold(key, 'draft')}
                    className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl border border-[#E8D8BE] bg-white hover:bg-gray-50 text-[11px] font-bold text-[#192A24] cursor-pointer"
                  >
                    <Save size={13} />
                    <span>Brouillon</span>
                  </button>
                  {canValidate && (
                    <button
                      type="button"
                      disabled={savingKey === key}
                      onClick={() => void handleSaveGold(key, 'validated')}
                      className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-[#008B62] hover:bg-[#007452] text-white text-[11px] font-extrabold cursor-pointer"
                    >
                      <CheckCircle2 size={13} />
                      <span>Valider</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </AppPanel>

      {/* B. Prix des devises et inventaire */}
      <AppPanel className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <SectionHeading
              title="Prix des Devises & Inventaire (Stock disponible = Physique − Réservé)"
              icon={<DollarSign size={18} />}
            />
            <p className="text-[11px] text-[#7D8176] mt-1">
              Saisie manuelle des prix d’achat, de vente et des stocks. Aucun message client devises ne part si le tarif est non validé/expiré ou si le stock disponible est nul ou inférieur au seuil minimum.
            </p>
          </div>

          <span className="inline-flex items-center px-3 py-1 rounded-lg bg-[#FAF8F3] border border-[#E8D8BE] text-[11px] font-bold text-[#7D8176]">
            Saisie manuelle uniquement
          </span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-[#E8D8BE]">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#FAF8F3] text-[#7D8176] border-b border-[#E8D8BE] text-[11px]">
                <th className="p-2.5">Devise</th>
                <th className="p-2.5">Prix Achat (FCFA)</th>
                <th className="p-2.5">Prix Vente (FCFA)</th>
                <th className="p-2.5">Stock Physique</th>
                <th className="p-2.5">Stock Réservé</th>
                <th className="p-2.5">Stock Disponible</th>
                <th className="p-2.5">Seuil Min.</th>
                <th className="p-2.5">Validité</th>
                <th className="p-2.5">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F3EBDC] bg-white">
              {currencyDrafts.map((row) => {
                const avail = Math.max(0, row.physicalStock - row.reservedStock);
                const stockOk = avail > 0 && avail >= (row.minAnnounceStock || 0);
                return (
                  <tr key={row.code}>
                    <td className="p-2.5 font-black text-[#192A24]">{row.code}</td>
                    <td className="p-2.5">
                      <input
                        type="number"
                        min={0}
                        value={row.buyRateXaf || ''}
                        onChange={(e) =>
                          updateCurrencyRow(row.code, {
                            buyRateXaf: Number(e.target.value) || 0,
                            status: 'draft',
                          })
                        }
                        className="w-24 px-2 py-1.5 rounded-lg border border-[#E8D8BE] bg-[#FAF8F3] font-bold"
                      />
                    </td>
                    <td className="p-2.5">
                      <input
                        type="number"
                        min={0}
                        value={row.sellRateXaf || ''}
                        onChange={(e) =>
                          updateCurrencyRow(row.code, {
                            sellRateXaf: Number(e.target.value) || 0,
                            status: 'draft',
                          })
                        }
                        className="w-24 px-2 py-1.5 rounded-lg border border-[#E8D8BE] bg-[#FAF8F3] font-bold"
                      />
                    </td>
                    <td className="p-2.5">
                      <input
                        type="number"
                        min={0}
                        value={row.physicalStock}
                        onChange={(e) =>
                          updateCurrencyRow(row.code, {
                            physicalStock: Number(e.target.value) || 0,
                          })
                        }
                        className="w-24 px-2 py-1.5 rounded-lg border border-[#E8D8BE] bg-white"
                      />
                    </td>
                    <td className="p-2.5">
                      <input
                        type="number"
                        min={0}
                        value={row.reservedStock}
                        onChange={(e) =>
                          updateCurrencyRow(row.code, {
                            reservedStock: Number(e.target.value) || 0,
                          })
                        }
                        className="w-24 px-2 py-1.5 rounded-lg border border-[#E8D8BE] bg-white"
                      />
                    </td>
                    <td className="p-2.5">
                      <span
                        className={`px-2 py-1 rounded-lg font-extrabold ${
                          stockOk ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'
                        }`}
                      >
                        {formatMoney(avail)} {row.code}
                      </span>
                    </td>
                    <td className="p-2.5">
                      <input
                        type="number"
                        min={0}
                        value={row.minAnnounceStock}
                        onChange={(e) =>
                          updateCurrencyRow(row.code, {
                            minAnnounceStock: Number(e.target.value) || 0,
                          })
                        }
                        className="w-20 px-2 py-1.5 rounded-lg border border-[#E8D8BE] bg-white"
                      />
                    </td>
                    <td className="p-2.5">
                      <div className="flex items-center gap-1">
                        <input
                          type="datetime-local"
                          value={(row.validUntil || '').slice(0, 16)}
                          onChange={(e) => updateCurrencyRow(row.code, { validUntil: e.target.value })}
                          className="px-2 py-1.5 rounded-lg border border-[#E8D8BE] bg-white text-[11px]"
                        />
                        {row.validUntil && (
                          <button
                            type="button"
                            onClick={() => updateCurrencyRow(row.code, { validUntil: '' })}
                            className="px-1.5 py-1 rounded-md border border-[#E8D8BE] bg-[#FAF8F3] hover:bg-[#F3EBDC] text-[10px] font-bold text-[#192A24] cursor-pointer"
                            title="Rendre la validité illimitée (recommandé)"
                          >
                            ∞
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="p-2.5">{statusBadge(row.status)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newCurrencyCode}
              onChange={(e) => setNewCurrencyCode(e.target.value)}
              placeholder="Ajouter devise (ex: CNY, XOF)"
              className="px-3 py-2 rounded-xl border border-[#E8D8BE] bg-[#FAF8F3] text-xs uppercase w-48"
            />
            <button
              type="button"
              onClick={handleAddCurrency}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-[#E8D8BE] bg-white hover:bg-[#FAF8F3] text-xs font-bold cursor-pointer"
            >
              <Plus size={14} /> Ajouter
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={savingKey === 'currencies'}
              onClick={() => void handleSaveAllCurrencies(false)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-[#E8D8BE] bg-white hover:bg-[#FAF8F3] text-xs font-bold text-[#192A24] cursor-pointer"
            >
              <Save size={14} />
              <span>Enregistrer brouillon</span>
            </button>
            {canValidate && (
              <button
                type="button"
                disabled={savingKey === 'currencies'}
                onClick={() => void handleSaveAllCurrencies(true)}
                className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-[#008B62] hover:bg-[#007452] text-white text-xs font-extrabold cursor-pointer"
              >
                <CheckCircle2 size={14} />
                <span>Valider taux & disponibilités</span>
              </button>
            )}
          </div>
        </div>
      </AppPanel>
    </div>
  );
};
