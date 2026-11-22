import React, { useState, useEffect } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, setDoc } from 'firebase/firestore';
import {
  Plus,
  Search,
  Filter,
  DollarSign,
  Printer,
  XCircle,
  AlertTriangle,
  CreditCard,
  Building2,
  RefreshCw,
  Scale,
  BarChart2,
  Pencil,
  Download,
  MessageSquare,
  Share2,
  FileText,
} from 'lucide-react';
import { useAppStore } from '../../context/AppContext';
import { AppPanel, Modal, SectionHeading } from '../common/UIComponents';
import {
  generatePurchaseSlipPdfBase64,
  downloadPurchaseSlipPdf,
  buildWhatsAppSlipMessage,
  sharePurchaseSlipToWhatsApp,
  SENDER_WHATSAPP_DISPLAY,
} from '../../utils/purchaseSlipPdf';
import { WhatsAppDirectService } from '../../services/whatsappDirectService';
import {
  computeGoldPurchasePrice,
  calculateCrudeGoldPricePerKaratGramXaf,
  formatPriceCard,
  formatMoney,
  formatNumber,
  formatDate,
  formatDateTime,
  goldKaratValue,
} from '../../utils/goldMath';
import { GoldPriceService } from '../../services/goldPriceService';
import { ExchangeRateService } from '../../services/exchangeRateService';
import { GoldCategory, PurchaseRecord, GoldPriceQuote } from '../../types';
import { db, firebaseApp } from '../../firebase/config';
import {
  buildPurchaseWeightKaratDetails,
  computeContactNetPositionXaf,
  getCaisseAutoWhatsappEnabled,
  sendCaisseWhatsAppNotification,
} from '../../utils/caisseNotification';

const sendPurchaseSlipToWhatsApp = httpsCallable<
  { purchaseId: string; recipientPhone?: string },
  { sent: boolean; alreadySent?: boolean }
>(getFunctions(firebaseApp, 'us-central1'), 'sendGoldPurchaseSlip');

const removeUndefinedValues = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(removeUndefinedValues);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, fieldValue]) => fieldValue !== undefined)
        .map(([key, fieldValue]) => [key, removeUndefinedValues(fieldValue)])
    );
  }
  return value;
};

const getWhatsAppErrorMessage = (error: unknown): string => {
  if (!error || typeof error !== 'object') return String(error);

  const callableError = error as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
    customData?: { details?: unknown };
  };
  const message =
    typeof callableError.message === 'string' ? callableError.message.trim() : '';
  const details =
    typeof callableError.details === 'string'
      ? callableError.details
      : typeof callableError.customData?.details === 'string'
        ? callableError.customData.details
        : '';

  if (details) return details;
  if (message && !/^internal(?:\s*\[\d+\])?$/i.test(message)) return message;
  if (callableError.code === 'functions/internal') {
    return 'La fonction WhatsApp déployée ne fournit pas le diagnostic détaillé. Redéployez la fonction Firebase, puis réessayez. Commande : firebase deploy --only functions:sendGoldPurchaseSlip';
  }
  return message || 'Erreur inconnue pendant l’envoi WhatsApp.';
};

interface PurchaseLine {
  id: number;
  weight: string;
  nonGoldWeight: string;
  karat: string;
  goldCategory: GoldCategory;
  manualPricePerGram: string;
}

const createPurchaseLine = (id: number): PurchaseLine => ({
  id,
  weight: '',
  nonGoldWeight: '0',
  karat: '22',
  goldCategory: 'Or brut',
  manualPricePerGram: '',
});

export const PurchasesScreen: React.FC<{
  onFormVisibilityChanged?: (isOpen: boolean) => void;
  canCreatePurchase?: boolean;
  canViewPurchaseHistory?: boolean;
}> = ({
  onFormVisibilityChanged,
  canCreatePurchase = true,
  canViewPurchaseHistory = true,
}) => {
  const store = useAppStore();
  const isAdmin = store.currentRole === 'ADMIN';
  const createOnlyMode = canCreatePurchase && !canViewPurchaseHistory;

  const [showingForm, setShowingForm] = useState(createOnlyMode);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [editingPurchase, setEditingPurchase] = useState<PurchaseRecord | null>(null);
  const [filter, setFilter] = useState<'Tous' | 'À crédit' | 'En cours' | 'Soldés' | 'Annulés'>('Tous');
  const [searchQuery, setSearchQuery] = useState('');

  // Form states
  const [seller, setSeller] = useState('');
  const [purchaseLines, setPurchaseLines] = useState<PurchaseLine[]>([createPurchaseLine(1)]);
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [goldPriceOunce, setGoldPriceOunce] = useState('');
  const [usdRate, setUsdRate] = useState('');
  const [useParallelRate, setUseParallelRate] = useState<boolean>(true);

  // Live market quote states
  const [liveGoldQuote, setLiveGoldQuote] = useState<GoldPriceQuote | null>(null);
  const [isRefreshingRates, setIsRefreshingRates] = useState(false);
  const [lastRatesUpdated, setLastRatesUpdated] = useState<string | null>(null);
  const [ratesSource, setRatesSource] = useState<string>('API Marché direct');

  // Modals
  const [selectedPurchase, setSelectedPurchase] = useState<PurchaseRecord | null>(null);
  const [selectedBatchPurchases, setSelectedBatchPurchases] = useState<PurchaseRecord[]>([]);
  const [senderWhatsappPhone, setSenderWhatsappPhone] = useState<string>(SENDER_WHATSAPP_DISPLAY);
  const [manualRecipientPhone, setManualRecipientPhone] = useState<string>('');
  const [editingRecipientPhone, setEditingRecipientPhone] = useState<boolean>(false);
  const [whatsappDeliveryState, setWhatsappDeliveryState] = useState<{
    status: 'idle' | 'sending' | 'sent' | 'fallback';
    message?: string;
  }>({ status: 'idle' });
  const [cancellingPurchase, setCancellingPurchase] = useState<PurchaseRecord | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [modalActionError, setModalActionError] = useState<string | null>(null);
  const canSettleInCaisse = store.canAccessService(1, 'cash.depot_retrait');

  const toggleForm = (open: boolean) => {
    if (!canCreatePurchase) {
      setShowingForm(false);
      onFormVisibilityChanged?.(false);
      return;
    }
    if (createOnlyMode) {
      setShowingForm(true);
      onFormVisibilityChanged?.(false);
      return;
    }
    setShowingForm(open);
    onFormVisibilityChanged?.(open);
  };

  useEffect(() => {
    if (!canCreatePurchase) {
      setShowingForm(false);
      onFormVisibilityChanged?.(false);
    } else if (createOnlyMode) {
      setShowingForm(true);
      onFormVisibilityChanged?.(false);
    }
  }, [canCreatePurchase, createOnlyMode]);

  const refreshLiveMarketRates = async () => {
    setIsRefreshingRates(true);
    try {
      const [gold, fx] = await Promise.all([
        GoldPriceService.fetchGoldUsd(),
        ExchangeRateService.fetchRates(),
      ]);

      if (gold) {
        setLiveGoldQuote(gold);
        setGoldPriceOunce(gold.pricePerTroyOunceUsd.toFixed(2));
      }
      if (fx.usdRates && fx.usdRates['XAF']) {
        setUsdRate(fx.usdRates['XAF'].toFixed(2));
      }
      setRatesSource(`${gold.source || 'Cours or'} · ${fx.source || 'open.er-api.com'}`);
      setLastRatesUpdated(new Date().toISOString());
    } catch (err) {
      console.warn('Live rates refresh failed:', err);
    } finally {
      setIsRefreshingRates(false);
    }
  };

  useEffect(() => {
    refreshLiveMarketRates();
    WhatsAppDirectService.getStatus()
      .then((status) => {
        const connected = status.connectedPhone || status.d7Originator;
        if (connected && connected.trim()) {
          setSenderWhatsappPhone(connected.trim());
        }
      })
      .catch(() => {
        // fallback to default SENDER_WHATSAPP_DISPLAY
      });
  }, []);

  const ounceNum = parseFloat(goldPriceOunce.replace(',', '.') || '0');
  const usdRateNum = parseFloat(usdRate.replace(',', '.') || '0');

  const getPurchaseLineCalculations = (line: PurchaseLine) => {
    const grossWeightNum = parseFloat(line.weight.replace(',', '.') || '0');
    const nonGoldWeightNum = parseFloat(line.nonGoldWeight.replace(',', '.') || '0');
    const netWeightNum = Math.max(0, grossWeightNum - nonGoldWeightNum);
    const karatNum = goldKaratValue(line.karat) || 22;
    const formulaResult = computeGoldPurchasePrice({
      pricePerTroyOunceUsd: ounceNum,
      usdToXafRate: usdRateNum,
      karat: karatNum,
      category: line.goldCategory,
      config: store.purchaseFormulaConfig,
    });
    const formulaCalculatedPrice = useParallelRate
      ? formulaResult.parallelPricePerGram
      : formulaResult.pricePerGram;
    const effectivePricePerGram = line.manualPricePerGram.trim()
      ? parseFloat(line.manualPricePerGram.replace(',', '.'))
      : formulaCalculatedPrice;
    return {
      grossWeightNum,
      nonGoldWeightNum,
      netWeightNum,
      karatNum,
      formulaCalculatedPrice,
      effectivePricePerGram,
      totalPurchasePrice: Math.round(netWeightNum * effectivePricePerGram),
    };
  };

  const totalPurchasePrice = purchaseLines.reduce(
    (total, line) => total + getPurchaseLineCalculations(line).totalPurchasePrice,
    0
  );
  const updatePurchaseLine = (id: number, updates: Partial<PurchaseLine>) => {
    setPurchaseLines((lines) =>
      lines.map((line) => (line.id === id ? { ...line, ...updates } : line))
    );
  };

  const getPurchaseSupplier = (purchase: PurchaseRecord) => {
    const supplier = purchase.supplier?.trim();
    if (supplier) return supplier;

    const descriptionParts = purchase.description.split(' · ');
    return descriptionParts.length > 2 && descriptionParts[1].trim()
      ? descriptionParts[1].trim()
      : 'Fournisseur inconnu';
  };

  const findContactBySupplier = (supplierName: string, supplierRef?: string) => {
    const cleanRef = supplierRef?.trim();
    if (cleanRef) {
      const byRef = store.contacts.find((c) => c.reference === cleanRef);
      if (byRef) return byRef;
    }
    const cleanName = supplierName.trim().toLowerCase();
    if (!cleanName) return undefined;
    return store.contacts.find((c) => c.name.trim().toLowerCase() === cleanName);
  };

  const resolvePurchaseRecipient = (purchasesOrSingle: PurchaseRecord | PurchaseRecord[]) => {
    const list = Array.isArray(purchasesOrSingle) ? purchasesOrSingle : [purchasesOrSingle];
    const first = list[0];
    if (!first) {
      return { name: 'Client', phone: '' };
    }
    const supplierName = getPurchaseSupplier(first);
    const contact = findContactBySupplier(supplierName, first.supplierReference);
    const resolvedPhone = (first.supplierPhone || contact?.phone || '').trim();
    return {
      name: contact?.name || supplierName,
      phone: resolvedPhone,
    };
  };

  const selectedSellerContact = findContactBySupplier(seller);

  const handleEditPurchase = (purchase: PurchaseRecord) => {
    const grossWeight = purchase.grossWeightGrams ?? purchase.netWeightGrams ?? 0;
    const netWeight = purchase.netWeightGrams ?? grossWeight;
    const karat = parseFloat(purchase.karat || '') || 22;
    const pricePerGram =
      purchase.referencePricePerGram ??
      (netWeight > 0 ? purchase.amount / netWeight : 0);

    setEditingPurchase(purchase);
    setSeller(getPurchaseSupplier(purchase));
    setPurchaseLines([
      {
        id: 1,
        weight: String(grossWeight),
        nonGoldWeight: String(purchase.nonGoldWeightGrams ?? Math.max(0, grossWeight - netWeight)),
        karat: String(karat),
        goldCategory: purchase.goldCategory,
        manualPricePerGram: String(pricePerGram),
      },
    ]);
    setDueDate(purchase.dueDate || '');
    setGoldPriceOunce(String(purchase.goldPricePerTroyOunceUsd ?? ''));
    setUsdRate(String(purchase.usdToXafRate ?? ''));
    setErrorMessage(null);
    setSelectedPurchase(null);
    toggleForm(true);
  };

  const sendPurchaseSlips = async (purchasesList: PurchaseRecord[], overridePhone?: string) => {
    const recipient = resolvePurchaseRecipient(purchasesList);
    const targetPhone = (overridePhone ?? recipient.phone).trim();
    const cleanTargetDigits = targetPhone.replace(/\D/g, '');
    const senderDisplay = senderWhatsappPhone || SENDER_WHATSAPP_DISPLAY;

    if (cleanTargetDigits.length >= 8) {
      setWhatsappDeliveryState({
        status: 'sending',
        message: `Envoi automatique du bordereau PDF à ${recipient.name} (${targetPhone}) depuis ${senderDisplay} en cours…`,
      });
    } else {
      setWhatsappDeliveryState({
        status: 'fallback',
        message: `Achat enregistré. Aucun numéro WhatsApp renseigné pour le client « ${recipient.name} » : saisissez son numéro de destinataire ci-dessus pour envoyer le bordereau.`,
      });
    }

    // 1. Synchronize to Firestore
    try {
      await Promise.all(
        purchasesList.map((purchase) => {
          const purchaseData = removeUndefinedValues(purchase);
          if (!purchaseData || typeof purchaseData !== 'object' || Array.isArray(purchaseData)) {
            throw new Error(`Les données de l’achat ${purchase.reference} sont invalides.`);
          }
          return setDoc(doc(db, 'purchases', purchase.id), {
            ...purchaseData,
            updatedAt: new Date().toISOString(),
          });
        })
      );
    } catch (dbErr) {
      console.warn('Firestore sync purchase warning:', dbErr);
    }

    if (cleanTargetDigits.length < 8) {
      return;
    }

    const pdfOptions = { recipientPhone: targetPhone, senderPhone: senderDisplay };

    // 2. Try local server direct WhatsApp (QR Code trial or API) — sends PDF without opening WhatsApp
    try {
      const { filename, pdfBase64 } = generatePurchaseSlipPdfBase64(purchasesList, store.userName, pdfOptions);
      const caption = buildWhatsAppSlipMessage(purchasesList, store.userName);
      const res = await WhatsAppDirectService.sendDocument({
        phone: targetPhone,
        filename,
        pdfBase64,
        caption,
      });
      setWhatsappDeliveryState({
        status: 'sent',
        message: `Bordereau PDF (${filename}) envoyé à ${recipient.name} (${targetPhone}) depuis ${senderDisplay} via ${res.mode === 'ultramsg' ? 'UltraMsg' : res.mode === 'd7' ? 'D7 Networks API' : 'WhatsApp direct'}.`,
      });
      return;
    } catch (directErr) {
      console.warn('Direct WhatsApp server delivery unavailable:', directErr);
    }

    // 3. Try Firebase Cloud Function WhatsApp PDF delivery directly to the client's phone.
    try {
      await Promise.all(
        purchasesList.map((purchase) =>
          sendPurchaseSlipToWhatsApp({ purchaseId: purchase.id, recipientPhone: targetPhone })
        )
      );
      setWhatsappDeliveryState({
        status: 'sent',
        message: `Bordereau PDF envoyé automatiquement au client (${targetPhone}) depuis ${senderDisplay}.`,
      });
    } catch (err) {
      console.warn('Background WhatsApp PDF delivery fallback:', getWhatsAppErrorMessage(err));
      const result = await sharePurchaseSlipToWhatsApp(
        purchasesList,
        store.userName,
        targetPhone,
        pdfOptions
      );
      setWhatsappDeliveryState({
        status: 'fallback',
        message:
          result.method === 'share'
            ? `Bordereau PDF (${result.filename}) prêt pour partage direct sur WhatsApp.`
            : `Session directe non liée (connectez le QR Code dans Messages pour envoyer sans ouvrir WhatsApp). PDF téléchargé (${result.filename}) et WhatsApp ouvert pour ${targetPhone}.`,
      });
    }
  };

  const handleManualSendSlipWhatsApp = async (
    purchasesOrSingle: PurchaseRecord | PurchaseRecord[],
    overridePhone?: string
  ) => {
    const list = Array.isArray(purchasesOrSingle) ? purchasesOrSingle : [purchasesOrSingle];
    const recipient = resolvePurchaseRecipient(list);
    const targetPhone = (overridePhone ?? recipient.phone).trim();
    const cleanTargetDigits = targetPhone.replace(/\D/g, '');
    const senderDisplay = senderWhatsappPhone || SENDER_WHATSAPP_DISPLAY;

    if (cleanTargetDigits.length < 8) {
      setEditingRecipientPhone(true);
      setWhatsappDeliveryState({
        status: 'fallback',
        message: `Aucun numéro WhatsApp valide trouvé pour « ${recipient.name} ». Veuillez saisir le numéro du client (destinataire) avant l’envoi.`,
      });
      return;
    }

    setWhatsappDeliveryState({
      status: 'sending',
      message: `Envoi du bordereau PDF à ${recipient.name} (${targetPhone}) depuis ${senderDisplay} en cours…`,
    });

    const pdfOptions = { recipientPhone: targetPhone, senderPhone: senderDisplay };

    try {
      const { filename, pdfBase64 } = generatePurchaseSlipPdfBase64(list, store.userName, pdfOptions);
      const caption = buildWhatsAppSlipMessage(list, store.userName);
      const res = await WhatsAppDirectService.sendDocument({
        phone: targetPhone,
        filename,
        pdfBase64,
        caption,
      });
      setWhatsappDeliveryState({
        status: 'sent',
        message: `Bordereau PDF (${filename}) envoyé à ${recipient.name} (${targetPhone}) depuis ${senderDisplay} via ${res.mode === 'ultramsg' ? 'UltraMsg' : res.mode === 'd7' ? 'D7 Networks API' : 'WhatsApp direct'}.`,
      });
      return;
    } catch (directErr) {
      console.warn('Manual direct WhatsApp send fallback:', directErr);
    }

    const result = await sharePurchaseSlipToWhatsApp(
      list,
      store.userName,
      targetPhone,
      pdfOptions
    );
    setWhatsappDeliveryState({
      status: 'fallback',
      message:
        result.method === 'share'
          ? `Bordereau PDF (${result.filename}) prêt pour partage direct sur WhatsApp.`
          : `Session directe non liée (connectez le QR Code dans Messages pour envoyer sans ouvrir WhatsApp). PDF téléchargé (${result.filename}) et WhatsApp ouvert pour ${targetPhone}.`,
    });
  };

  const handleCreatePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const supplier = seller.trim();
    if (!supplier) {
      setErrorMessage('Veuillez sélectionner un fournisseur ou vendeur.');
      return;
    }

    const lineCalculations = purchaseLines.map((line) => ({
      line,
      ...getPurchaseLineCalculations(line),
    }));
    for (const { line, grossWeightNum, netWeightNum, effectivePricePerGram } of lineCalculations) {
      if (grossWeightNum <= 0) {
        setErrorMessage(`Le poids brut de la ligne ${line.id} doit être supérieur à zéro.`);
        return;
      }
      if (netWeightNum <= 0) {
        setErrorMessage(`Le poids net de la ligne ${line.id} doit être supérieur à zéro.`);
        return;
      }
      if (!Number.isFinite(effectivePricePerGram) || effectivePricePerGram <= 0) {
        setErrorMessage(`Le prix d’achat par gramme de la ligne ${line.id} doit être supérieur à zéro.`);
        return;
      }
    }

    const beforeBalanceXaf = computeContactNetPositionXaf(
      {
        name: selectedSellerContact?.name || supplier,
        reference: selectedSellerContact?.reference,
        phone: selectedSellerContact?.phone,
      },
      {
        contacts: store.contacts,
        purchases: store.purchases,
        saleRecords: store.saleRecords,
        loans: store.loans,
        operations: store.operations,
        currencyStockMovements: store.currencyStockMovements,
        goldCurrencyMovements: store.goldCurrencyMovements,
        officialUsdRate: store.purchaseFormulaConfig.officialUsdRate,
      }
    );

    let newlyCreatedPurchases: PurchaseRecord[] = [];
    try {
      if (editingPurchase) {
        const {
          line,
          grossWeightNum,
          nonGoldWeightNum,
          netWeightNum,
          karatNum,
          effectivePricePerGram,
          totalPurchasePrice: lineTotal,
        } = lineCalculations[0];
        store.updatePurchase(editingPurchase.id, {
          description: `${formatDate(new Date(editingPurchase.purchasedAt))} · ${supplier} · ${line.goldCategory} · ${netWeightNum.toFixed(2)} g net · ${karatNum}K · ${formatMoney(lineTotal)} FCFA`,
          price: lineTotal,
          supplier,
          supplierReference: selectedSellerContact?.reference,
          supplierPhone: selectedSellerContact?.phone,
          grossWeightGrams: grossWeightNum,
          nonGoldWeightGrams: nonGoldWeightNum,
          karat: `${karatNum}K`,
          goldCategory: line.goldCategory,
          purityPercent: (karatNum / 24) * 100,
          referencePricePerGram: effectivePricePerGram,
          goldPricePerTroyOunceUsd: ounceNum,
          usdToXafRate: usdRateNum,
          dueDate: dueDate.trim() || undefined,
        });
      } else {
        newlyCreatedPurchases = store.addPurchases(
          lineCalculations.map(({
            line,
            grossWeightNum,
            nonGoldWeightNum,
            netWeightNum,
            karatNum,
            effectivePricePerGram,
            totalPurchasePrice: lineTotal,
          }) => ({
            description: `${formatDate(new Date())} · ${supplier} · ${line.goldCategory} · ${netWeightNum.toFixed(2)} g net · ${karatNum}K · ${formatMoney(lineTotal)} FCFA`,
            price: lineTotal,
            paymentAccount: undefined,
            initialPaymentAmount: 0,
            paymentMode: 'credit',
            dueDate: dueDate.trim() || undefined,
            supplier,
            supplierReference: selectedSellerContact?.reference,
            supplierPhone: selectedSellerContact?.phone,
            grossWeightGrams: grossWeightNum,
            nonGoldWeightGrams: nonGoldWeightNum,
            karat: `${karatNum}K`,
            goldCategory: line.goldCategory,
            purityPercent: (karatNum / 24) * 100,
            referencePricePerGram: effectivePricePerGram,
            goldPricePerTroyOunceUsd: ounceNum,
            usdToXafRate: usdRateNum,
          }))
        );
      }

      // Reset form
      setPurchaseLines([createPurchaseLine(1)]);
      setDueDate('');
      setNotes('');
      setSeller('');
      setEditingPurchase(null);
      if (createOnlyMode) {
        setSuccessMessage('Achat d’or validé automatiquement à crédit ! Le règlement fournisseur s’effectue dans Caisse.');
        setTimeout(() => setSuccessMessage(null), 5000);
        setShowingForm(true);
      } else {
        toggleForm(false);
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      return;
    }

    if (newlyCreatedPurchases.length > 0) {
      const initialRecipient = resolvePurchaseRecipient(newlyCreatedPurchases);
      const totalPurchaseAmountXaf = newlyCreatedPurchases.reduce((sum, p) => sum + p.amount, 0);
      setSelectedBatchPurchases(newlyCreatedPurchases);
      setSelectedPurchase(newlyCreatedPurchases[0]);
      setManualRecipientPhone(initialRecipient.phone);
      setEditingRecipientPhone(false);
      void sendCaisseWhatsAppNotification({
        enabled: getCaisseAutoWhatsappEnabled(),
        direction: 'CREDIT',
        amountXaf: totalPurchaseAmountXaf,
        contactName: initialRecipient.name,
        phone: initialRecipient.phone,
        accountFallback: selectedSellerContact?.reference,
        details: buildPurchaseWeightKaratDetails(newlyCreatedPurchases, 'ACHAT'),
        txRef: newlyCreatedPurchases[0]?.reference || `ACH-${Date.now().toString().slice(-6)}`,
        availableBalanceAfterXaf: beforeBalanceXaf + totalPurchaseAmountXaf,
      });
      void sendPurchaseSlips(newlyCreatedPurchases, initialRecipient.phone);
    }
  };

  const handleConfirmCancel = () => {
    if (!isAdmin) {
      setErrorMessage('Seul un administrateur peut annuler un achat enregistré.');
      setCancellingPurchase(null);
      return;
    }
    if (!cancellingPurchase) return;
    if (!cancelReason.trim()) {
      setModalActionError('Veuillez indiquer un motif d’annulation.');
      return;
    }
    try {
      setModalActionError(null);
      store.cancelPurchase(cancellingPurchase.id, cancelReason);
      setCancellingPurchase(null);
      setCancelReason('');
    } catch (err: unknown) {
      setModalActionError(err instanceof Error ? err.message : String(err));
    }
  };

  // Filtered purchases
  const filteredPurchases = store.purchases.filter((p) => {
    if (filter === 'Annulés' && !p.cancelledAt) return false;
    if (filter === 'Soldés') {
      const paid = p.payments.reduce((sum, pay) => sum + pay.amount, 0);
      if (p.cancelledAt || paid < p.amount) return false;
    }
    if (filter === 'À crédit') {
      const paid = p.payments.reduce((sum, pay) => sum + pay.amount, 0);
      if (p.cancelledAt || paid >= p.amount || (paid > 0 && p.paymentMode !== 'credit')) return false;
    }
    if (filter === 'En cours') {
      const paid = p.payments.reduce((sum, pay) => sum + pay.amount, 0);
      if (p.cancelledAt || paid >= p.amount) return false;
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      return (
        p.reference.toLowerCase().includes(query) ||
        p.description.toLowerCase().includes(query) ||
        (p.supplier && p.supplier.toLowerCase().includes(query))
      );
    }
    return true;
  });

  const activeBordereauPurchases =
    selectedBatchPurchases.length > 0
      ? selectedBatchPurchases
      : selectedPurchase
        ? [selectedPurchase]
        : [];
  const resolvedModalRecipient = selectedPurchase
    ? resolvePurchaseRecipient(activeBordereauPurchases)
    : { name: '', phone: '' };
  const effectiveRecipientPhone = (
    editingRecipientPhone || manualRecipientPhone.trim()
      ? manualRecipientPhone
      : resolvedModalRecipient.phone
  ).trim();
  const senderDisplayPhone = senderWhatsappPhone || SENDER_WHATSAPP_DISPLAY;
  const selectedPurchaseTotalAmount = activeBordereauPurchases.reduce(
    (sum, p) => sum + (p.amount || 0),
    0
  );
  const selectedPurchasePaid = activeBordereauPurchases.reduce(
    (sum, p) => sum + (p.payments || []).reduce((pSum, payment) => pSum + payment.amount, 0),
    0
  );
  const selectedPurchaseBalance = selectedPurchaseTotalAmount - selectedPurchasePaid;

  return (
    <div className="space-y-6">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-[#192A24]">Achats d’Or brut & Bijoux</h2>
          <p className="text-xs text-[#7D8176] mt-0.5">
            Formules officielles (Brut, Fondu, Bijoux), taux parallèle marché noir et enregistrement des paiements
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canCreatePurchase && !createOnlyMode && (
            <button
              onClick={() => {
                if (showingForm) {
                  setEditingPurchase(null);
                  setErrorMessage(null);
                  toggleForm(false);
                } else {
                  setEditingPurchase(null);
                  setErrorMessage(null);
                  setPurchaseLines([createPurchaseLine(1)]);
                  setSeller('');
                  setDueDate('');
                  toggleForm(true);
                }
              }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition-all cursor-pointer ${
                showingForm
                  ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  : 'bg-[#D39725] hover:bg-[#c2871b] text-white shadow-xs'
              }`}
            >
              {showingForm ? 'Masquer formulaire' : '+ Nouvel achat d’or'}
            </button>
          )}
        </div>
      </div>

      {successMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-bold">
          {successMessage}
        </div>
      )}

      {/* New Purchase Form Accordion */}
      {showingForm && canCreatePurchase && (
        <AppPanel className="border-[#D39725]/40 bg-white shadow-md animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex items-center justify-between border-b border-[#E8D8BE] pb-3 mb-5">
            <div className="flex items-center gap-2 font-black text-sm text-[#192A24]">
              <Scale size={18} className="text-[#D39725]" />
              <span>{editingPurchase ? `Modifier l’achat ${editingPurchase.reference}` : 'Saisie d’un achat d’or'}</span>
            </div>
            {!createOnlyMode && (
              <button
                onClick={() => {
                  setEditingPurchase(null);
                  setErrorMessage(null);
                  toggleForm(false);
                }}
                className="text-xs text-gray-400 hover:text-gray-700 font-bold"
              >
                Fermer
              </button>
            )}
          </div>

          {errorMessage && (
            <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-semibold flex items-center gap-2">
              <AlertTriangle size={16} />
              <span>{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleCreatePurchase} className="space-y-5">
            <div>
              <div>
                <label className="block text-xs font-bold text-[#192A24] mb-1.5">
                  Fournisseur / Vendeur
                </label>
                <select
                  value={seller}
                  onChange={(e) => setSeller(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 bg-[#FAF8F3] rounded-xl border border-[#E8D8BE] text-xs font-semibold text-[#192A24] focus:outline-hidden focus:border-[#D39725]"
                >
                  <option value="" disabled hidden />
                  {seller && !store.contacts.some((contact) => contact.name === seller) && (
                    <option value={seller}>{seller}</option>
                  )}
                  {store.contacts
                    .filter((contact) =>
                      contact.roles.some((role) => {
                        const normalizedRole = role.toLowerCase();
                        return normalizedRole.includes('fournisseur') || normalizedRole.includes('client');
                      })
                    )
                    .map((contact) => (
                      <option key={contact.reference} value={contact.name}>
                        {contact.name}
                      </option>
                    ))}
                </select>
                {seller && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                    <span className="font-bold text-emerald-700">
                      Destinataire : {selectedSellerContact?.phone?.trim() || 'Numéro client non renseigné'}
                    </span>
                    <span className="font-semibold text-[#7D8176]">
                      Expéditeur : {senderDisplayPhone}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {purchaseLines.map((line, index) => {
              const calculations = getPurchaseLineCalculations(line);
              return (
                <div key={line.id} className="space-y-4 rounded-2xl border border-[#E8D8BE] p-4">
                  <div className="flex items-end justify-between gap-3">
                    <div className="flex-1">
                      <label className="block text-xs font-bold text-[#192A24] mb-1.5">
                        Catégorie d’or · Ligne {index + 1}
                      </label>
                      <select
                        value={line.goldCategory}
                        onChange={(e) =>
                          updatePurchaseLine(line.id, { goldCategory: e.target.value as GoldCategory })
                        }
                        className="w-full px-3.5 py-2.5 bg-[#FAF8F3] rounded-xl border border-[#E8D8BE] text-xs font-semibold text-[#192A24] focus:outline-hidden focus:border-[#D39725]"
                      >
                        <option value="Or brut">Or brut</option>
                        <option value="Or fondu">Or fondu</option>
                        <option value="Bijoux">Bijoux</option>
                      </select>
                    </div>
                    {!editingPurchase && purchaseLines.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setPurchaseLines((lines) => lines.filter((item) => item.id !== line.id))
                        }
                        className="px-3 py-2.5 rounded-lg border border-red-200 text-xs font-bold text-red-600 hover:bg-red-50 cursor-pointer"
                      >
                        Supprimer
                      </button>
                    )}
                  </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-[#192A24] mb-1.5">
                  Poids brut total (grammes)
                </label>
                <input
                  type="text"
                  required
                  value={line.weight}
                  onChange={(e) => updatePurchaseLine(line.id, { weight: e.target.value })}
                  placeholder="ex: 12.5"
                  className="w-full px-3.5 py-2.5 bg-[#FAF8F3] rounded-xl border border-[#E8D8BE] text-xs font-bold text-[#192A24] focus:outline-hidden focus:border-[#D39725]"
                />
              </div>

              {/* Exact replica of User Screenshot 1 */}
              <div>
                <label className="block text-xs font-bold text-[#0D629E] mb-1.5">
                  Poids non-or (pierres, crasse)
                </label>
                <input
                  type="text"
                  value={line.nonGoldWeight}
                  onChange={(e) => updatePurchaseLine(line.id, { nonGoldWeight: e.target.value })}
                  placeholder="0"
                  className="w-full px-3.5 py-2.5 bg-[#FAF5EE] rounded-2xl border border-[#E0D0B5] text-xs font-bold text-[#192A24] focus:outline-hidden focus:border-[#0D629E] shadow-2xs"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#192A24] mb-1.5">
                  Titre / Carat
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="1"
                    max="24"
                    step="any"
                    required
                    value={line.karat}
                    onChange={(e) => updatePurchaseLine(line.id, { karat: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F3] rounded-xl border border-[#E8D8BE] text-xs font-bold text-[#192A24] focus:outline-hidden focus:border-[#D39725]"
                  />
                  <div className="flex gap-1">
                    {['24', '22', '21', '18'].map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => updatePurchaseLine(line.id, { karat: k })}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold border cursor-pointer ${
                          line.karat === k
                            ? 'bg-[#D39725] text-white border-[#D39725]'
                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        {k}K
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Net weight summary */}
              <div className="sm:col-span-3 flex items-center justify-between p-3 rounded-xl bg-amber-50/80 border border-amber-200/80 text-xs">
                <div className="text-gray-700">
                  Poids brut pesé : <strong>{formatNumber(calculations.grossWeightNum, 2)} g</strong> · Impuretés déduites :{' '}
                  <strong className="text-red-600">-{formatNumber(calculations.nonGoldWeightNum, 2)} g</strong>
                </div>
                <div className="font-extrabold text-[#D39725] text-sm">
                  Poids net or calculé : {formatNumber(calculations.netWeightNum, 2)} g
                </div>
              </div>

              <div className="sm:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-[#FAF8F3] border border-[#E8D8BE]">
                <label className="block text-xs font-bold text-[#192A24]">
                  Modifier le prix d’achat par gramme (FCFA / g)
                  <input
                    type="text"
                    value={line.manualPricePerGram}
                    onChange={(e) =>
                      updatePurchaseLine(line.id, { manualPricePerGram: e.target.value })
                    }
                    placeholder={`Automatique : ${formatPriceCard(calculations.formulaCalculatedPrice, 2)} FCFA / g`}
                    className="mt-1 w-full px-3 py-2 bg-white rounded-lg border border-[#E8D8BE] text-xs font-bold text-[#192A24] focus:outline-hidden focus:border-[#D39725]"
                  />
                  <span className="mt-1 block text-[10px] font-medium text-[#7D8176]">
                    Laissez vide pour utiliser le cours automatique. Le total est calculé avec le poids net.
                  </span>
                </label>
                <div className="flex flex-col justify-center sm:items-end">
                  <span className="text-[11px] text-[#7D8176]">
                    Prix d’achat : {formatPriceCard(calculations.effectivePricePerGram, 2)} FCFA / g
                  </span>
                  <strong className="mt-1 text-base text-[#008B62]">
                    Total ligne : {formatMoney(calculations.totalPurchasePrice)} FCFA
                  </strong>
                </div>
              </div>
                </div>
              </div>
              );
            })}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              {!editingPurchase && (
                <button
                  type="button"
                  aria-label="Ajouter une autre catégorie d’or"
                  title="Ajouter une autre catégorie d’or"
                  onClick={() =>
                    setPurchaseLines((lines) => [
                      ...lines,
                      createPurchaseLine(Math.max(...lines.map((line) => line.id)) + 1),
                    ])
                  }
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-[#D39725] text-white hover:bg-[#c2871b] cursor-pointer"
                >
                  <Plus size={16} />
                </button>
              )}
              <strong className="text-base text-[#008B62]">
                Total de l’achat : {formatMoney(totalPurchasePrice)} FCFA
              </strong>
            </div>

            {editingPurchase ? (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-2">
                <div>
                  Paiements déjà enregistrés :{' '}
                  <strong>
                    {formatMoney(
                      editingPurchase.payments.reduce((sum, payment) => sum + payment.amount, 0)
                    )}{' '}
                    FCFA
                  </strong>
                  . Ils sont conservés sans modification.
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-[#192A24] mb-1">
                    Échéance de règlement (optionnel)
                  </label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="px-3 py-1.5 bg-white rounded-lg border border-amber-300 text-xs text-[#192A24]"
                  />
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-full bg-amber-600 text-white text-[10px] font-extrabold uppercase tracking-wider">
                        Crédit automatique à la validation
                      </span>
                      <span className="text-xs font-extrabold text-[#192A24]">
                        0 FCFA décaissé ici
                      </span>
                    </div>
                    <p className="text-xs text-amber-950">
                      Dette fournisseur enregistrée à la validation :{' '}
                      <strong className="font-mono">{formatMoney(totalPurchasePrice)} FCFA</strong>. Tout paiement fournisseur s&apos;effectue ensuite dans{' '}
                      <strong>Caisse</strong>.
                    </p>
                  </div>
                  <div className="shrink-0">
                    <label className="block text-[10px] font-bold uppercase text-amber-900 mb-1">
                      Échéance (optionnel)
                    </label>
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="px-3 py-1.5 bg-white rounded-lg border border-amber-300 text-xs font-semibold text-[#192A24]"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setEditingPurchase(null);
                  setErrorMessage(null);
                  if (createOnlyMode) {
                    setPurchaseLines([createPurchaseLine(1)]);
                    setDueDate('');
                    setNotes('');
                    setSeller('');
                  } else {
                    toggleForm(false);
                  }
                }}
                className="px-4 py-2.5 rounded-xl border border-[#E8D8BE] text-xs font-bold text-[#7D8176] hover:bg-gray-50 cursor-pointer"
              >
                {createOnlyMode ? 'Réinitialiser' : 'Annuler'}
              </button>
              <button
                type="submit"
                className="px-6 py-2.5 rounded-xl bg-[#008B62] hover:bg-[#007452] text-white text-xs font-bold shadow-xs cursor-pointer transition-colors"
              >
                {editingPurchase ? 'Enregistrer les modifications' : "Enregistrer l'achat & valider le bon"}
              </button>
            </div>
          </form>
        </AppPanel>
      )}

      {canViewPurchaseHistory && (
        <>
          {/* Filter and search bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher par référence, fournisseur..."
                className="w-full pl-9 pr-4 py-2 bg-white rounded-xl border border-[#E8D8BE] text-xs focus:outline-hidden focus:border-[#D39725]"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              {(['Tous', 'À crédit', 'En cours', 'Soldés', 'Annulés'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setFilter(tab)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                    filter === tab
                      ? 'bg-[#192A24] text-white shadow-2xs'
                      : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          {/* Purchases List */}
          <div className="space-y-3">
        {filteredPurchases.length === 0 ? (
          <AppPanel className="text-center py-10">
            <p className="text-xs text-gray-500">Aucun achat ne correspond aux critères.</p>
          </AppPanel>
        ) : (
          filteredPurchases.map((purchase) => {
            const totalPaid = purchase.payments.reduce((acc, p) => acc + p.amount, 0);
            const remaining = Math.max(0, purchase.amount - totalPaid);
            const isSettled = !purchase.cancelledAt && remaining === 0;

            return (
              <AppPanel
                key={purchase.id}
                padding="p-4 sm:p-5"
                onClick={() => {
                  const resolved = resolvePurchaseRecipient([purchase]);
                  setSelectedBatchPurchases([purchase]);
                  setSelectedPurchase(purchase);
                  setManualRecipientPhone(resolved.phone);
                  setEditingRecipientPhone(false);
                  setWhatsappDeliveryState({ status: 'idle' });
                }}
                className={`cursor-pointer transition-all hover:border-[#D39725]/50 ${
                  purchase.cancelledAt ? 'opacity-70 bg-gray-50' : ''
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-start gap-3.5">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xs flex-shrink-0 ${
                        purchase.cancelledAt
                          ? 'bg-red-100 text-red-600'
                          : isSettled
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {purchase.karat || 'OR'}
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-extrabold text-[#D39725]">
                          {purchase.reference}
                        </span>
                        <span className="text-xs font-bold text-[#192A24]">
                          {getPurchaseSupplier(purchase)}
                        </span>
                        {purchase.cancelledAt ? (
                          <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-extrabold">
                            Annulé
                          </span>
                        ) : isSettled ? (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-extrabold">
                            Soldé
                          </span>
                        ) : totalPaid === 0 ? (
                          <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 text-[10px] font-extrabold">
                            À crédit · Reste: {formatMoney(remaining)} F
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-extrabold">
                            Acompte · Reste: {formatMoney(remaining)} F
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-[#7D8176] mt-1">
                        {formatDateTime(purchase.purchasedAt)} · {purchase.goldCategory} ·{' '}
                        {purchase.netWeightGrams || purchase.grossWeightGrams} g
                        {purchase.dueDate && remaining > 0 && !purchase.cancelledAt && (
                          <span className="ml-2 text-amber-800 font-semibold">
                            · Échéance : {purchase.dueDate}
                          </span>
                        )}
                      </div>

                      {purchase.cancelledAt && (
                        <div className="text-[11px] text-red-600 mt-1 font-medium">
                          Motif annulation : {purchase.cancellationReason}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between md:justify-end gap-4 border-t md:border-t-0 pt-3 md:pt-0">
                    <div className="text-left md:text-right">
                      <div className="text-base font-black text-[#192A24]">
                        {formatMoney(purchase.amount)} FCFA
                      </div>
                      <div className="text-[11px] text-[#7D8176]">
                        Payé : {formatMoney(totalPaid)} FCFA
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {!purchase.cancelledAt && canCreatePurchase && (
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            handleEditPurchase(purchase);
                          }}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#D39725]/40 text-xs font-semibold text-[#9E731B] hover:bg-amber-50 cursor-pointer"
                          title="Modifier l'achat"
                        >
                          <Pencil size={13} />
                          Modifier
                        </button>
                      )}
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          const resolved = resolvePurchaseRecipient([purchase]);
                          setSelectedBatchPurchases([purchase]);
                          setSelectedPurchase(purchase);
                          setManualRecipientPhone(resolved.phone);
                          setEditingRecipientPhone(false);
                          setWhatsappDeliveryState({ status: 'idle' });
                        }}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-xs font-semibold text-gray-700 cursor-pointer"
                        title="Afficher le bordereau officiel d'achat"
                      >
                        <FileText size={13} />
                        <span>Bordereau</span>
                      </button>

                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          const resolved = resolvePurchaseRecipient([purchase]);
                          setSelectedBatchPurchases([purchase]);
                          setSelectedPurchase(purchase);
                          setManualRecipientPhone(resolved.phone);
                          setEditingRecipientPhone(false);
                          void handleManualSendSlipWhatsApp([purchase], resolved.phone);
                        }}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-xs font-bold text-emerald-800 cursor-pointer transition-colors"
                        title={(() => {
                          const resolved = resolvePurchaseRecipient([purchase]);
                          return resolved.phone
                            ? `Envoyer le bordereau PDF au client (${resolved.phone})`
                            : 'Envoyer le bordereau PDF au client sur WhatsApp';
                        })()}
                      >
                        <MessageSquare size={13} className="text-[#25D366]" />
                        <span>WhatsApp</span>
                      </button>

                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          const resolved = resolvePurchaseRecipient([purchase]);
                          downloadPurchaseSlipPdf(purchase, store.userName, {
                            recipientPhone: resolved.phone,
                            senderPhone: senderDisplayPhone,
                          });
                        }}
                        className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-100 text-gray-600 hover:text-gray-900 cursor-pointer"
                        title="Télécharger le bordereau officiel en PDF"
                      >
                        <Download size={14} />
                      </button>

                      {!purchase.cancelledAt && remaining > 0 && (
                        canSettleInCaisse ? (
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              store.openCashForPayment({
                                contactName: getPurchaseSupplier(purchase),
                                targetKey: `gold_purchase:${purchase.id}`,
                                direction: 'pay_out',
                                amountXaf: remaining,
                                note: `Règlement achat or ${purchase.reference}`,
                              });
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-[#008B62] hover:bg-[#007452] text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                          >
                            Payer dans Caisse
                          </button>
                        ) : (
                          <span className="px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-bold whitespace-nowrap">
                            À payer en Caisse
                          </span>
                        )
                      )}

                      {!purchase.cancelledAt && isAdmin && (
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            setCancellingPurchase(purchase);
                          }}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                          title="Annuler l'achat"
                        >
                          <XCircle size={17} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </AppPanel>
            );
          })
        )}
      </div>
        </>
      )}

      {/* Modal Details / Print Invoice */}
      <Modal
        isOpen={Boolean(selectedPurchase)}
        onClose={() => {
          setSelectedPurchase(null);
          setSelectedBatchPurchases([]);
          setManualRecipientPhone('');
          setEditingRecipientPhone(false);
          setWhatsappDeliveryState({ status: 'idle' });
        }}
        title={
          activeBordereauPurchases.length > 1
            ? `Bordereau d'Achat d'Or · ${activeBordereauPurchases[0]?.reference} → ${activeBordereauPurchases[activeBordereauPurchases.length - 1]?.reference}`
            : `Bordereau d'Achat d'Or · ${selectedPurchase?.reference || ''}`
        }
        maxWidth="max-w-3xl"
        printMode
      >
        {selectedPurchase && (
          <div className="purchase-slip-print space-y-6 print:p-0">
            {/* Top Toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 no-print border-b border-gray-100 pb-3">
              <div className="space-y-1">
                <span className="text-xs text-gray-500 font-semibold block">
                  Bordereau officiel PDF prêt pour impression et envoi WhatsApp
                </span>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-[11px] text-emerald-700 font-bold">
                    Destinataire : {effectiveRecipientPhone || 'Numéro client non renseigné'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (!editingRecipientPhone) {
                        setManualRecipientPhone(effectiveRecipientPhone);
                      }
                      setEditingRecipientPhone((prev) => !prev);
                    }}
                    className="text-[11px] font-bold text-[#9E731B] hover:underline cursor-pointer"
                  >
                    {editingRecipientPhone ? 'Fermer' : effectiveRecipientPhone ? 'Modifier' : '+ Saisir numéro client'}
                  </button>
                </div>
                {editingRecipientPhone && (
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      value={manualRecipientPhone}
                      onChange={(e) => setManualRecipientPhone(e.target.value)}
                      placeholder="Ex: +242 05 028 40 40"
                      className="px-2.5 py-1 rounded-lg border border-[#E8D8BE] bg-[#FAF8F3] text-xs font-bold text-[#192A24] w-52"
                    />
                  </div>
                )}
                <span className="text-[11px] text-[#7D8176] font-semibold block">
                  Expéditeur : {senderDisplayPhone}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={whatsappDeliveryState.status === 'sending'}
                  onClick={() => {
                    void handleManualSendSlipWhatsApp(activeBordereauPurchases, effectiveRecipientPhone);
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#25D366] hover:bg-[#20ba59] disabled:opacity-60 text-white text-xs font-bold cursor-pointer shadow-sm transition-colors"
                  title={
                    effectiveRecipientPhone
                      ? `Envoyer le bordereau PDF au client (${effectiveRecipientPhone})`
                      : 'Renseignez le numéro client pour envoyer sur WhatsApp'
                  }
                >
                  <MessageSquare size={15} />
                  <span>
                    {whatsappDeliveryState.status === 'sending'
                      ? 'Envoi PDF…'
                      : 'Envoyer PDF WhatsApp'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    downloadPurchaseSlipPdf(activeBordereauPurchases, store.userName, {
                      recipientPhone: effectiveRecipientPhone,
                      senderPhone: senderDisplayPhone,
                    })
                  }
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#FAF8F3] hover:bg-[#F3EAD9] border border-[#E8D8BE] text-[#192A24] text-xs font-bold cursor-pointer shadow-xs transition-colors"
                  title="Télécharger le bordereau officiel au format PDF"
                >
                  <Download size={15} />
                  <span>Télécharger PDF</span>
                </button>

                <button
                  type="button"
                  onClick={() => window.print()}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#192A24] hover:bg-[#253D34] text-white text-xs font-bold cursor-pointer shadow-md transition-colors"
                >
                  <Printer size={15} />
                  <span>Imprimer</span>
                </button>
              </div>
            </div>

            {whatsappDeliveryState.status !== 'idle' && whatsappDeliveryState.message && (
              <div
                className={`no-print p-3 rounded-xl border text-xs font-bold ${
                  whatsappDeliveryState.status === 'sent'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : whatsappDeliveryState.status === 'sending'
                      ? 'bg-blue-50 border-blue-200 text-blue-900'
                      : 'bg-amber-50 border-amber-200 text-amber-950'
                }`}
              >
                {whatsappDeliveryState.message}
              </div>
            )}

            {/* Official Printable Sheet Container */}
            <div className="p-6 sm:p-8 bg-white border-2 border-[#192A24] rounded-2xl space-y-6 print:border-none print:p-0 shadow-sm">
              {/* Slip Official Header */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between border-b-2 border-[#192A24] pb-4 gap-4">
                <div>
                  <div className="text-xl font-black text-[#192A24] tracking-tight">
                    CAMS GOLD
                  </div>
                  <div className="text-[11px] text-gray-500 mt-1">
                    Bordereau Officiel d'Achat, Pesée & Règlement
                  </div>
                </div>

                <div className="text-left sm:text-right">
                  <div className="inline-block px-3 py-1 rounded bg-[#192A24] text-white font-mono font-black text-xs uppercase tracking-wide">
                    {activeBordereauPurchases.length > 1
                      ? `BORDEREAU D'ACHAT · ${activeBordereauPurchases[0].reference} - ${activeBordereauPurchases[activeBordereauPurchases.length - 1].reference}`
                      : `BORDEREAU D'ACHAT N° ${selectedPurchase.reference}`}
                  </div>
                  <div className="text-xs text-gray-600 font-medium mt-1.5">
                    Date d'opération : <strong>{formatDate(selectedPurchase.purchasedAt)}</strong>
                  </div>
                  <div className="text-[11px] text-gray-500">
                    Opérateur : <strong>{store.userName}</strong> (CAMS GOLD)
                  </div>
                </div>
              </div>

              {/* Vendor & Category Identification */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="print-card p-3.5 bg-gray-50 rounded-xl border border-gray-200 space-y-1">
                  <span className="text-[10px] uppercase font-bold text-gray-500 tracking-wider block">
                    Fournisseur / Vendeur
                  </span>
                  <div className="text-sm font-black text-[#192A24]">
                    {getPurchaseSupplier(selectedPurchase)}
                  </div>
                  <div className="text-[11px] text-gray-600">
                    Catégorie d'or :{' '}
                    <strong className="text-[#D39725]">
                      {Array.from(
                        new Set(activeBordereauPurchases.map((p) => p.goldCategory))
                      ).join(' / ')}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Technical Analysis & Weight Table */}
              <div className="print-card rounded-xl border border-gray-200 overflow-hidden text-xs">
                <div className="bg-[#FAF8F3] px-4 py-2 border-b border-[#E8D8BE] font-bold text-[#192A24] text-[11px] uppercase tracking-wider">
                  Détail de l'analyse physique & pesée certifiée
                </div>
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/50 text-[10px] font-bold text-gray-500 uppercase">
                      {activeBordereauPurchases.length > 1 && <th className="py-2.5 px-3">Lot</th>}
                      <th className="py-2.5 px-3">Poids Brut</th>
                      <th className="py-2.5 px-3">Tare / Déchets</th>
                      <th className="py-2.5 px-3 font-bold text-gray-900">Poids Net</th>
                      <th className="py-2.5 px-3">Titre Carat</th>
                      <th className="py-2.5 px-3">Poids Fin 24K</th>
                      <th className="py-2.5 px-3 text-right">Prix Net / g</th>
                      {activeBordereauPurchases.length > 1 && (
                        <th className="py-2.5 px-3 text-right">Montant</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 font-mono text-xs">
                    {activeBordereauPurchases.map((item) => {
                      const netW = item.netWeightGrams || item.grossWeightGrams || 0;
                      const kVal = item.karat ? parseFloat(item.karat) || 24 : 24;
                      const fineW = (netW * kVal) / 24;
                      return (
                        <tr key={item.id}>
                          {activeBordereauPurchases.length > 1 && (
                            <td className="py-2.5 px-3 font-bold text-[#192A24]">
                              {item.reference}
                              <span className="block text-[10px] font-sans text-gray-500">
                                {item.goldCategory}
                              </span>
                            </td>
                          )}
                          <td className="py-2.5 px-3 font-medium text-gray-700">
                            {formatNumber(item.grossWeightGrams || 0, 2)} g
                          </td>
                          <td className="py-2.5 px-3 text-gray-500">
                            {formatNumber(item.nonGoldWeightGrams || 0, 2)} g
                          </td>
                          <td className="py-2.5 px-3 font-black text-[#192A24]">
                            {formatNumber(netW, 2)} g
                          </td>
                          <td className="py-2.5 px-3 font-bold text-[#D39725]">
                            {item.karat || '24K'}
                          </td>
                          <td className="py-2.5 px-3 font-bold text-[#192A24]">
                            {formatNumber(fineW, 3)} g
                          </td>
                          <td className="py-2.5 px-3 text-right font-black text-[#008B62]">
                            {formatMoney(item.referencePricePerGram)} FCFA
                          </td>
                          {activeBordereauPurchases.length > 1 && (
                            <td className="py-2.5 px-3 text-right font-black text-[#192A24]">
                              {formatMoney(item.amount)} F
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Purchase payment status */}
              <div className="print-card p-4 rounded-xl border border-gray-200 bg-gray-50 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700">
                  Situation du règlement
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-gray-500">Montant total de l'achat</div>
                    <div className="font-bold text-gray-900">
                      {formatMoney(selectedPurchaseTotalAmount)} FCFA
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Déjà réglé au fournisseur</div>
                    <div className="font-bold text-gray-900">
                      {formatMoney(selectedPurchasePaid)} FCFA
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">
                      {selectedPurchaseBalance > 0
                        ? 'Reste à payer'
                        : selectedPurchaseBalance < 0
                        ? 'Trop-perçu'
                        : 'Solde'}
                    </div>
                    <div className="font-bold text-gray-900">
                      {formatMoney(Math.abs(selectedPurchaseBalance))} FCFA
                    </div>
                  </div>
                </div>
                <p className="text-sm font-semibold text-gray-800">
                  {selectedPurchase.cancelledAt
                    ? `Achat annulé${selectedPurchase.cancellationReason ? ` : ${selectedPurchase.cancellationReason}` : '.'}`
                    : selectedPurchaseBalance > 0
                    ? `Nous devons ${formatMoney(selectedPurchaseBalance)} FCFA au fournisseur.${selectedPurchase.dueDate ? ` Échéance : ${selectedPurchase.dueDate}.` : ''}`
                    : selectedPurchaseBalance < 0
                    ? `Le fournisseur nous doit ${formatMoney(Math.abs(selectedPurchaseBalance))} FCFA.`
                    : 'Aucun solde restant : le fournisseur a été entièrement payé.'}
                </p>
              </div>

              {/* Payments breakdown */}
              <div>
                <h4 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Modalités & Justificatifs de règlement
                </h4>
                {activeBordereauPurchases.flatMap((item) => item.payments).length === 0 ? (
                  <div className="print-card text-xs text-gray-500 italic p-3 bg-gray-50 rounded-xl border border-gray-100">
                    Aucun règlement n’a encore été enregistré pour ce bordereau.
                  </div>
                ) : (
                  <div className="print-card divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden text-xs">
                    {activeBordereauPurchases
                      .flatMap((item) => item.payments)
                      .map((p, idx) => (
                        <div key={idx} className="p-3 flex items-center justify-between bg-white">
                          <div>
                            <div className="font-bold text-[#192A24]">{p.method}</div>
                            <div className="text-[11px] text-gray-500">
                              {formatDateTime(p.paidAt)} · Compte débité :{' '}
                              <strong>{p.account || 'Caisse (espèces)'}</strong>
                              {p.note ? ` · ${p.note}` : ''}
                            </div>
                          </div>
                          <span className="font-black text-emerald-700">
                            {formatMoney(p.amount)} FCFA
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {/* Signatures */}

              <div className="grid grid-cols-2 gap-8 pt-4 border-t-2 border-dashed border-gray-300 text-xs">
                <div className="text-center space-y-12">
                  <span className="font-bold text-gray-700 block">
                    Signature & Empreinte du Vendeur / Fournisseur
                  </span>
                  <div className="border-t border-gray-400 w-3/4 mx-auto pt-1 text-[10px] text-gray-400">
                    Précédée de la mention "Lu et approuvé, bon pour accord"
                  </div>
                </div>

                <div className="text-center space-y-12">
                  <span className="font-bold text-gray-700 block">
                    Visa, Cachet & Signature CAMS GOLD
                  </span>
                  <div className="border-t border-gray-400 w-3/4 mx-auto pt-1 text-[10px] text-gray-400">
                    Le Peseur / Caissier habilité
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Bottom Actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 no-print pt-3 border-t border-gray-100">
              <div className="text-xs text-gray-500 font-medium space-y-0.5">
                <div>
                  Destinataire :{' '}
                  <strong className="text-emerald-700">
                    {effectiveRecipientPhone || 'Numéro client non renseigné'}
                  </strong>
                </div>
                <div className="text-[11px] text-[#7D8176]">
                  Expéditeur : <strong>{senderDisplayPhone}</strong>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPurchase(null);
                    setSelectedBatchPurchases([]);
                    setManualRecipientPhone('');
                    setEditingRecipientPhone(false);
                    setWhatsappDeliveryState({ status: 'idle' });
                  }}
                  className="px-4 py-2.5 rounded-xl border border-gray-300 text-xs font-bold text-gray-600 hover:bg-gray-100 cursor-pointer"
                >
                  Fermer
                </button>

                <button
                  type="button"
                  onClick={() =>
                    downloadPurchaseSlipPdf(activeBordereauPurchases, store.userName, {
                      recipientPhone: effectiveRecipientPhone,
                      senderPhone: senderDisplayPhone,
                    })
                  }
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white border border-[#D39725]/60 hover:bg-amber-50 text-[#192A24] text-xs font-bold cursor-pointer shadow-xs transition-colors"
                >
                  <Download size={15} className="text-[#D39725]" />
                  <span>Télécharger PDF</span>
                </button>

                <button
                  type="button"
                  disabled={whatsappDeliveryState.status === 'sending'}
                  onClick={() => {
                    void handleManualSendSlipWhatsApp(activeBordereauPurchases, effectiveRecipientPhone);
                  }}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#25D366] hover:bg-[#20ba59] disabled:opacity-60 text-white text-xs font-bold cursor-pointer shadow-md transition-colors"
                >
                  <MessageSquare size={15} />
                  <span>Envoyer PDF WhatsApp</span>
                </button>

                <button
                  type="button"
                  onClick={() => window.print()}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#008B62] hover:bg-[#007452] text-white text-xs font-bold cursor-pointer shadow-md"
                >
                  <Printer size={15} />
                  <span>Imprimer la fiche</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal Cancel Purchase */}
      <Modal
        isOpen={Boolean(cancellingPurchase)}
        onClose={() => {
          setCancellingPurchase(null);
          setModalActionError(null);
        }}
        title="Annuler l'achat d'or"
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          {modalActionError && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-semibold text-red-700">
              {modalActionError}
            </div>
          )}
          <p className="text-xs text-gray-600">
            Êtes-vous sûr de vouloir annuler l'achat{' '}
            <strong className="text-red-600">{cancellingPurchase?.reference}</strong> ? Les montants
            payés seront recrédités sur vos comptes de trésorerie et le stock déduit.
          </p>

          <div>
            <label className="block text-xs font-bold text-[#192A24] mb-1">Motif d'annulation obligatoire</label>
            <textarea
              required
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="ex: Erreur de pesée / Refus après coupellation..."
              className="w-full px-3 py-2 bg-[#FAF8F3] rounded-xl border border-[#E8D8BE] text-xs text-[#192A24]"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setCancellingPurchase(null);
                setModalActionError(null);
              }}
              className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 border border-gray-200"
            >
              Retour
            </button>
            <button
              type="button"
              onClick={handleConfirmCancel}
              className="px-5 py-2 rounded-xl text-xs font-bold bg-red-600 text-white"
            >
              Confirmer l'annulation
            </button>
          </div>
        </div>
      </Modal>

    </div>
  );
};
