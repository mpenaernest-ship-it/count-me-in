import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Briefcase,
  CheckCircle2,
  Coins,
  CreditCard,
  Download,
  Edit3,
  FileSpreadsheet,
  FileText,
  Filter,
  Loader2,
  Plus,
  Printer,
  Search,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { useAppStore } from '../../context/AppContext';
import {
  Employee,
  EmployeeStatus,
  EmploymentContractType,
  SalaryPaymentMethod,
  SalaryPaymentRecord,
} from '../../types';
import { formatMoney } from '../../utils/goldMath';
import { AppPanel, Modal, PageHeading, SectionHeading } from '../common/UIComponents';

type HrTab = 'staff' | 'payroll' | 'history';

const DEPARTMENTS = [
  'Direction & Administration',
  'Caisse & Trésorerie',
  'Achats & Fonderie',
  'Ventes & Export Dubaï',
  'Change & Devises',
  'Sécurité & Logistique',
  'Communication & CRM',
];

const CONTRACT_TYPES: EmploymentContractType[] = ['CDI', 'CDD', 'Stage', 'Journalier', 'Consultant'];

const PAYMENT_METHODS: SalaryPaymentMethod[] = ['Espèces', 'Virement bancaire', 'Mobile Money'];

const STATUS_META: Record<EmployeeStatus, { label: string; badgeClass: string }> = {
  active: { label: 'Actif', badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  on_leave: { label: 'En congé', badgeClass: 'bg-amber-100 text-amber-800 border-amber-200' },
  suspended: { label: 'Suspendu', badgeClass: 'bg-rose-100 text-rose-800 border-rose-200' },
  terminated: { label: 'Sorti / Fin contrat', badgeClass: 'bg-gray-100 text-gray-600 border-gray-300' },
};

const formatPeriodLabel = (ym: string): string => {
  const [y, m] = (ym || '').split('-');
  if (!y || !m) return ym;
  const date = new Date(Number(y), Number(m) - 1, 1);
  if (Number.isNaN(date.getTime())) return ym;
  return date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
};

export const EmployeesScreen: React.FC = () => {
  const store = useAppStore();

  const canManageStaff = store.canAccessService(14, 'hr.manage');
  const canManagePayroll = store.canAccessService(14, 'hr.payroll');
  const canExportReports = store.canAccessService(14, 'hr.reports');

  const [activeTab, setActiveTab] = useState<HrTab>('staff');
  const [searchQuery, setSearchQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<EmployeeStatus | 'ALL'>('ALL');
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [historyEmpFilter, setHistoryEmpFilter] = useState('ALL');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(
    null
  );

  // Modals: Employee create/edit
  const [showEmpModal, setShowEmpModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [empForm, setEmpForm] = useState<{
    matricule: string;
    fullName: string;
    jobTitle: string;
    department: string;
    contractType: EmploymentContractType;
    status: EmployeeStatus;
    phone: string;
    email: string;
    hireDate: string;
    baseSalaryXaf: string;
    defaultBonusXaf: string;
    defaultAllowanceXaf: string;
    paymentMethod: SalaryPaymentMethod;
    bankAccountOrRib: string;
    idNumber: string;
    emergencyContact: string;
    notes: string;
  }>({
    matricule: '',
    fullName: '',
    jobTitle: '',
    department: DEPARTMENTS[0],
    contractType: 'CDI',
    status: 'active',
    phone: '',
    email: '',
    hireDate: new Date().toISOString().slice(0, 10),
    baseSalaryXaf: '',
    defaultBonusXaf: '0',
    defaultAllowanceXaf: '0',
    paymentMethod: 'Espèces',
    bankAccountOrRib: '',
    idNumber: '',
    emergencyContact: '',
    notes: '',
  });

  // Delete confirmations (no native window.confirm)
  const [empToDelete, setEmpToDelete] = useState<Employee | null>(null);
  const [paymentToDelete, setPaymentToDelete] = useState<SalaryPaymentRecord | null>(null);

  // Payslip edit / manual add modal
  const [showPayslipModal, setShowPayslipModal] = useState(false);
  const [payslipDraft, setPayslipDraft] = useState<{
    id?: string;
    employeeId: string;
    periodMonth: string;
    baseSalaryXaf: string;
    bonusXaf: string;
    allowancesXaf: string;
    overtimeXaf: string;
    advanceDeductionXaf: string;
    otherDeductionsXaf: string;
    notes: string;
  }>({
    employeeId: '',
    periodMonth: new Date().toISOString().slice(0, 7),
    baseSalaryXaf: '0',
    bonusXaf: '0',
    allowancesXaf: '0',
    overtimeXaf: '0',
    advanceDeductionXaf: '0',
    otherDeductionsXaf: '0',
    notes: '',
  });

  // Pay confirmation modal
  const [paymentToPay, setPaymentToPay] = useState<SalaryPaymentRecord | null>(null);
  const [payNote, setPayNote] = useState('');
  const [isPaying, setIsPaying] = useState(false);

  // Printable modals
  const [payslipPrintRecord, setPayslipPrintRecord] = useState<SalaryPaymentRecord | null>(null);
  const [showMonthlyStatementPreview, setShowMonthlyStatementPreview] = useState(false);

  const accountNames = useMemo(() => Object.keys(store.bankBalances), [store.bankBalances]);
  const cashAccountName = useMemo(
    () => accountNames.find((account) => account.toLowerCase().includes('caisse')) || 'Caisse (espèces)',
    [accountNames]
  );

  const filteredEmployees = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return store.employees.filter((emp) => {
      if (deptFilter !== 'ALL' && emp.department !== deptFilter) return false;
      if (statusFilter !== 'ALL' && emp.status !== statusFilter) return false;
      if (!q) return true;
      return (
        emp.fullName.toLowerCase().includes(q) ||
        emp.matricule.toLowerCase().includes(q) ||
        emp.jobTitle.toLowerCase().includes(q) ||
        emp.department.toLowerCase().includes(q) ||
        (emp.phone || '').toLowerCase().includes(q)
      );
    });
  }, [store.employees, searchQuery, deptFilter, statusFilter]);

  const staffStats = useMemo(() => {
    const total = store.employees.length;
    const activeList = store.employees.filter((e) => e.status === 'active');
    const onLeaveOrSuspended = store.employees.filter(
      (e) => e.status === 'on_leave' || e.status === 'suspended'
    ).length;
    const monthlyBaseMass = activeList.reduce(
      (sum, e) =>
        sum + (e.baseSalaryXaf || 0) + (e.defaultBonusXaf || 0) + (e.defaultAllowanceXaf || 0),
      0
    );
    return {
      total,
      activeCount: activeList.length,
      onLeaveOrSuspended,
      monthlyBaseMass,
    };
  }, [store.employees]);

  const monthPayrolls = useMemo(
    () =>
      store.salaryPayments
        .filter((p) => p.periodMonth === selectedMonth && p.status !== 'cancelled')
        .sort((a, b) => a.employeeName.localeCompare(b.employeeName)),
    [store.salaryPayments, selectedMonth]
  );

  const monthStats = useMemo(() => {
    const totalGross = monthPayrolls.reduce((s, p) => s + p.grossSalaryXaf, 0);
    const totalDeductions = monthPayrolls.reduce(
      (s, p) => s + p.advanceDeductionXaf + p.otherDeductionsXaf,
      0
    );
    const totalNet = monthPayrolls.reduce((s, p) => s + p.netSalaryXaf, 0);
    const paidAmount = monthPayrolls
      .filter((p) => p.status === 'paid')
      .reduce((s, p) => s + p.netSalaryXaf, 0);
    const unpaidAmount = monthPayrolls
      .filter((p) => p.status === 'draft')
      .reduce((s, p) => s + p.netSalaryXaf, 0);
    return { totalGross, totalDeductions, totalNet, paidAmount, unpaidAmount };
  }, [monthPayrolls]);

  const historyPayrolls = useMemo(() => {
    return store.salaryPayments.filter((p) =>
      historyEmpFilter === 'ALL' ? true : p.employeeId === historyEmpFilter
    );
  }, [store.salaryPayments, historyEmpFilter]);

  const openCreateEmployee = () => {
    setEditingEmployee(null);
    setEmpForm({
      matricule: '',
      fullName: '',
      jobTitle: '',
      department: DEPARTMENTS[0],
      contractType: 'CDI',
      status: 'active',
      phone: '',
      email: '',
      hireDate: new Date().toISOString().slice(0, 10),
      baseSalaryXaf: '',
      defaultBonusXaf: '0',
      defaultAllowanceXaf: '0',
      paymentMethod: 'Espèces',
      bankAccountOrRib: '',
      idNumber: '',
      emergencyContact: '',
      notes: '',
    });
    setShowEmpModal(true);
  };

  const openEditEmployee = (emp: Employee) => {
    setEditingEmployee(emp);
    setEmpForm({
      matricule: emp.matricule,
      fullName: emp.fullName,
      jobTitle: emp.jobTitle,
      department: emp.department,
      contractType: emp.contractType,
      status: emp.status,
      phone: emp.phone || '',
      email: emp.email || '',
      hireDate: emp.hireDate || new Date().toISOString().slice(0, 10),
      baseSalaryXaf: String(emp.baseSalaryXaf || 0),
      defaultBonusXaf: String(emp.defaultBonusXaf || 0),
      defaultAllowanceXaf: String(emp.defaultAllowanceXaf || 0),
      paymentMethod: emp.paymentMethod || 'Espèces',
      bankAccountOrRib: emp.bankAccountOrRib || '',
      idNumber: emp.idNumber || '',
      emergencyContact: emp.emergencyContact || '',
      notes: emp.notes || '',
    });
    setShowEmpModal(true);
  };

  const handleSubmitEmployee = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageStaff) return;
    const cleanName = empForm.fullName.trim();
    const cleanJob = empForm.jobTitle.trim();
    if (!cleanName || !cleanJob) {
      setFeedback({
        type: 'error',
        text: 'Le nom complet et l’intitulé du poste sont obligatoires.',
      });
      return;
    }

    const payload = {
      matricule: empForm.matricule.trim(),
      fullName: cleanName,
      jobTitle: cleanJob,
      department: empForm.department,
      contractType: empForm.contractType,
      status: empForm.status,
      phone: empForm.phone.trim(),
      email: empForm.email.trim(),
      hireDate: empForm.hireDate,
      baseSalaryXaf: Math.max(0, Number(empForm.baseSalaryXaf) || 0),
      defaultBonusXaf: Math.max(0, Number(empForm.defaultBonusXaf) || 0),
      defaultAllowanceXaf: Math.max(0, Number(empForm.defaultAllowanceXaf) || 0),
      paymentMethod: empForm.paymentMethod,
      bankAccountOrRib: empForm.bankAccountOrRib.trim(),
      idNumber: empForm.idNumber.trim(),
      emergencyContact: empForm.emergencyContact.trim(),
      notes: empForm.notes.trim(),
    };

    if (editingEmployee) {
      store.updateEmployee(editingEmployee.id, payload);
      setFeedback({ type: 'success', text: `Fiche employé « ${cleanName} » mise à jour.` });
    } else {
      store.addEmployee(payload);
      setFeedback({ type: 'success', text: `Employé « ${cleanName} » ajouté au registre RH.` });
    }
    setShowEmpModal(false);
  };

  const handleGenerateMonth = () => {
    if (!canManagePayroll) return;
    const count = store.generateMonthlyPayroll(selectedMonth);
    if (count > 0) {
      setFeedback({
        type: 'success',
        text: `${count} bulletin(s) de paie généré(s) pour ${formatPeriodLabel(selectedMonth)}.`,
      });
    } else {
      setFeedback({
        type: 'info',
        text: `Tous les employés actifs ont déjà un bulletin pour ${formatPeriodLabel(selectedMonth)} (ou aucun employé actif enregistré).`,
      });
    }
  };

  const openCreatePayslip = (preselectEmp?: Employee) => {
    const emp = preselectEmp || store.employees[0];
    if (!emp) {
      setFeedback({
        type: 'error',
        text: 'Ajoutez d’abord au moins un employé avant de créer un bulletin de paie.',
      });
      return;
    }
    setPayslipDraft({
      employeeId: emp.id,
      periodMonth: selectedMonth,
      baseSalaryXaf: String(emp.baseSalaryXaf || 0),
      bonusXaf: String(emp.defaultBonusXaf || 0),
      allowancesXaf: String(emp.defaultAllowanceXaf || 0),
      overtimeXaf: '0',
      advanceDeductionXaf: '0',
      otherDeductionsXaf: '0',
      notes: '',
    });
    setShowPayslipModal(true);
  };

  const openEditPayslip = (rec: SalaryPaymentRecord) => {
    setPayslipDraft({
      id: rec.id,
      employeeId: rec.employeeId,
      periodMonth: rec.periodMonth,
      baseSalaryXaf: String(rec.baseSalaryXaf || 0),
      bonusXaf: String(rec.bonusXaf || 0),
      allowancesXaf: String(rec.allowancesXaf || 0),
      overtimeXaf: String(rec.overtimeXaf || 0),
      advanceDeductionXaf: String(rec.advanceDeductionXaf || 0),
      otherDeductionsXaf: String(rec.otherDeductionsXaf || 0),
      notes: rec.notes || '',
    });
    setShowPayslipModal(true);
  };

  const handleSavePayslip = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManagePayroll) return;
    const emp = store.employees.find((x) => x.id === payslipDraft.employeeId);
    if (!emp) {
      setFeedback({ type: 'error', text: 'Veuillez sélectionner un employé.' });
      return;
    }
    const existing = payslipDraft.id
      ? store.salaryPayments.find((p) => p.id === payslipDraft.id)
      : undefined;

    store.saveSalaryPayment({
      id: payslipDraft.id,
      employeeId: emp.id,
      employeeMatricule: emp.matricule,
      employeeName: emp.fullName,
      department: emp.department,
      jobTitle: emp.jobTitle,
      periodMonth: payslipDraft.periodMonth,
      baseSalaryXaf: Number(payslipDraft.baseSalaryXaf) || 0,
      bonusXaf: Number(payslipDraft.bonusXaf) || 0,
      allowancesXaf: Number(payslipDraft.allowancesXaf) || 0,
      overtimeXaf: Number(payslipDraft.overtimeXaf) || 0,
      advanceDeductionXaf: Number(payslipDraft.advanceDeductionXaf) || 0,
      otherDeductionsXaf: Number(payslipDraft.otherDeductionsXaf) || 0,
      status: existing?.status || 'draft',
      notes: payslipDraft.notes.trim(),
    });
    setFeedback({
      type: 'success',
      text: `Bulletin de paie enregistré pour ${emp.fullName} (${payslipDraft.periodMonth}).`,
    });
    setShowPayslipModal(false);
  };

  const handleConfirmPay = () => {
    if (!paymentToPay || !canManagePayroll || isPaying) return;
    setIsPaying(true);
    try {
      store.paySalaryRecord({
        paymentId: paymentToPay.id,
        note: payNote.trim() || undefined,
      });
      setFeedback({
        type: 'success',
        text: `Salaire de ${paymentToPay.employeeName} (${formatMoney(paymentToPay.netSalaryXaf)} FCFA) payé depuis ${cashAccountName} et enregistré en charge OPEX.`,
      });
      setPaymentToPay(null);
      setPayNote('');
    } finally {
      setIsPaying(false);
    }
  };

  const handleExportPayrollExcel = (records: SalaryPaymentRecord[], label: string) => {
    if (!canExportReports || records.length === 0) return;
    const rows = records.map((r) => ({
      Référence: r.reference,
      Période: r.periodMonth,
      Matricule: r.employeeMatricule,
      Employé: r.employeeName,
      Département: r.department,
      Poste: r.jobTitle,
      'Salaire Base (FCFA)': r.baseSalaryXaf,
      'Primes (FCFA)': r.bonusXaf,
      'Indemnités (FCFA)': r.allowancesXaf,
      'Heures Sup (FCFA)': r.overtimeXaf,
      'Salaire Brut (FCFA)': r.grossSalaryXaf,
      'Retenue Avance (FCFA)': r.advanceDeductionXaf,
      'Autres Retenues (FCFA)': r.otherDeductionsXaf,
      'Net à Payer (FCFA)': r.netSalaryXaf,
      Statut: r.status === 'paid' ? 'Payé' : 'Brouillon',
      Compte: r.paidFromAccount || '—',
      'Date Paiement': r.paidAt ? new Date(r.paidAt).toLocaleDateString('fr-FR') : '—',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Paie');
    XLSX.writeFile(wb, `CAMS_GOLD_Paie_${label}.xlsx`);
  };

  const draftGrossPreview =
    (Number(payslipDraft.baseSalaryXaf) || 0) +
    (Number(payslipDraft.bonusXaf) || 0) +
    (Number(payslipDraft.allowancesXaf) || 0) +
    (Number(payslipDraft.overtimeXaf) || 0);
  const draftNetPreview = Math.max(
    0,
    draftGrossPreview -
      (Number(payslipDraft.advanceDeductionXaf) || 0) -
      (Number(payslipDraft.otherDeductionsXaf) || 0)
  );

  return (
    <div className="p-4 sm:p-7 max-w-7xl mx-auto space-y-6">
      <div className="no-print">
        <PageHeading
          eyebrow="Ressources Humaines · Personnel & Paie"
          title="Gestion des Employés, Salaires & RH"
          action={
            <div className="flex flex-wrap items-center gap-2">
              {canManageStaff && (
                <button
                  type="button"
                  onClick={openCreateEmployee}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#D39725] hover:bg-[#BA841E] text-white text-xs font-extrabold cursor-pointer shadow-xs"
                >
                  <UserPlus size={15} />
                  <span>+ Nouvel Employé</span>
                </button>
              )}
            </div>
          }
        />
      </div>

      {feedback && (
        <div
          className={`no-print p-3.5 rounded-xl border text-xs font-bold flex items-center justify-between gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : feedback.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-800'
                : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-[11px] underline cursor-pointer"
          >
            Fermer
          </button>
        </div>
      )}

      {/* KPIs Globaux RH */}
      <div className="no-print grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white border border-[#E8D8BE] shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-xs font-bold text-[#7D8176]">
            <span>Effectif Total</span>
            <Users size={16} className="text-[#D39725]" />
          </div>
          <div className="text-2xl font-black text-[#192A24]">{staffStats.total}</div>
          <div className="text-[11px] text-[#7D8176]">Collaborateurs enregistrés</div>
        </div>

        <div className="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-200 space-y-1">
          <div className="flex items-center justify-between text-xs font-bold text-emerald-800">
            <span>Personnel Actif</span>
            <UserCheck size={16} className="text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-emerald-800">{staffStats.activeCount}</div>
          <div className="text-[11px] text-emerald-700">
            {staffStats.onLeaveOrSuspended} en congé / suspendu(s)
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-[#FAF8F3] border border-[#E8D8BE] space-y-1">
          <div className="flex items-center justify-between text-xs font-bold text-[#7D8176]">
            <span>Masse Salariale Mensuelle</span>
            <Coins size={16} className="text-[#D39725]" />
          </div>
          <div className="text-xl font-black text-[#192A24]">
            {formatMoney(staffStats.monthlyBaseMass)} FCFA
          </div>
          <div className="text-[11px] text-[#7D8176]">Base + primes/indemnités fixes (actifs)</div>
        </div>

        <div className="p-4 rounded-2xl bg-blue-50/70 border border-blue-200 space-y-1">
          <div className="flex items-center justify-between text-xs font-bold text-blue-800">
            <span>Paie · {formatPeriodLabel(selectedMonth)}</span>
            <Wallet size={16} className="text-blue-700" />
          </div>
          <div className="text-xl font-black text-blue-900">
            {formatMoney(monthStats.paidAmount)} FCFA
          </div>
          <div className="text-[11px] text-blue-700">
            Reste à payer : {formatMoney(monthStats.unpaidAmount)} FCFA
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="no-print flex flex-wrap gap-2">
        {[
          {
            id: 'staff' as HrTab,
            label: `Personnel & Contrats (${store.employees.length})`,
            icon: <Briefcase size={14} />,
          },
          {
            id: 'payroll' as HrTab,
            label: `Paie Mensuelle (${monthPayrolls.length})`,
            icon: <CreditCard size={14} />,
          },
          {
            id: 'history' as HrTab,
            label: `Historique & Bulletins (${store.salaryPayments.length})`,
            icon: <FileText size={14} />,
          },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
              activeTab === tab.id
                ? 'bg-[#192A24] text-[#F2BD45] shadow-xs'
                : 'bg-white border border-[#E8D8BE] text-[#192A24] hover:bg-[#FAF8F3]'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* ONGLET 1 : PERSONNEL & CONTRATS */}
      {activeTab === 'staff' && (
        <AppPanel className="space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <SectionHeading title="Registre du Personnel & Contrats" icon={<Users size={18} />} />
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7D8176]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Nom, matricule, poste..."
                  className="pl-8 pr-3 py-2 rounded-xl border border-[#E8D8BE] bg-[#FAF8F3] text-xs w-52"
                />
              </div>
              <select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                className="px-3 py-2 rounded-xl border border-[#E8D8BE] bg-white text-xs font-semibold"
              >
                <option value="ALL">Tous départements</option>
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as EmployeeStatus | 'ALL')}
                className="px-3 py-2 rounded-xl border border-[#E8D8BE] bg-white text-xs font-semibold"
              >
                <option value="ALL">Tous statuts</option>
                <option value="active">Actifs</option>
                <option value="on_leave">En congé</option>
                <option value="suspended">Suspendus</option>
                <option value="terminated">Sortis</option>
              </select>
            </div>
          </div>

          {filteredEmployees.length === 0 ? (
            <div className="p-10 text-center rounded-2xl bg-[#FAF8F3] border border-[#E8D8BE] space-y-2">
              <Briefcase size={28} className="mx-auto text-[#D39725]" />
              <div className="text-sm font-black text-[#192A24]">Aucun employé enregistré</div>
              <p className="text-xs text-[#7D8176] max-w-md mx-auto">
                Ajoutez vos collaborateurs (direction, caissiers, acheteurs, fonderie, sécurité) pour suivre leurs contrats et générer la paie mensuelle.
              </p>
              {canManageStaff && (
                <button
                  type="button"
                  onClick={openCreateEmployee}
                  className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#192A24] text-white text-xs font-bold cursor-pointer"
                >
                  <Plus size={14} />
                  <span>Ajouter le premier employé</span>
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[#E8D8BE]">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#FAF8F3] text-[#7D8176] border-b border-[#E8D8BE] text-[11px]">
                    <th className="p-3">Matricule &amp; Nom</th>
                    <th className="p-3">Poste &amp; Département</th>
                    <th className="p-3">Contrat &amp; Embauche</th>
                    <th className="p-3 text-right">Salaire Base</th>
                    <th className="p-3 text-right">Primes + Indem.</th>
                    <th className="p-3">Paiement</th>
                    <th className="p-3">Statut</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3EBDC] bg-white">
                  {filteredEmployees.map((emp) => {
                    const meta = STATUS_META[emp.status];
                    const fixedExtras = (emp.defaultBonusXaf || 0) + (emp.defaultAllowanceXaf || 0);
                    return (
                      <tr key={emp.id} className="hover:bg-[#FAF8F3]/60">
                        <td className="p-3">
                          <div className="font-black text-[#192A24]">{emp.fullName}</div>
                          <div className="text-[11px] font-mono text-[#7D8176]">
                            {emp.matricule}
                            {emp.phone ? ` · ${emp.phone}` : ''}
                          </div>
                        </td>
                        <td className="p-3">
                          <div className="font-bold text-[#192A24]">{emp.jobTitle}</div>
                          <div className="text-[11px] text-[#7D8176]">{emp.department}</div>
                        </td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded bg-[#FAF8F3] border border-[#E8D8BE] font-bold text-[10px]">
                            {emp.contractType}
                          </span>
                          <div className="text-[11px] text-[#7D8176] mt-0.5">{emp.hireDate}</div>
                        </td>
                        <td className="p-3 text-right font-black text-[#192A24]">
                          {formatMoney(emp.baseSalaryXaf)} FCFA
                        </td>
                        <td className="p-3 text-right text-[#555B54] font-semibold">
                          {formatMoney(fixedExtras)} FCFA
                        </td>
                        <td className="p-3 text-[11px]">
                          <div className="font-semibold">{emp.paymentMethod}</div>
                          {emp.bankAccountOrRib && (
                            <div className="text-[#7D8176] truncate max-w-[140px]">
                              {emp.bankAccountOrRib}
                            </div>
                          )}
                        </td>
                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded-full border text-[10px] font-extrabold ${meta.badgeClass}`}
                          >
                            {meta.label}
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          <div className="inline-flex items-center gap-1">
                            {canManagePayroll && (
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveTab('payroll');
                                  openCreatePayslip(emp);
                                }}
                                title="Préparer bulletin de paie"
                                className="px-2 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-[11px] font-bold cursor-pointer"
                              >
                                Paie
                              </button>
                            )}
                            {canManageStaff && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openEditEmployee(emp)}
                                  title="Modifier fiche"
                                  className="p-1.5 rounded-lg bg-white hover:bg-[#FAF8F3] border border-[#E8D8BE] text-[#192A24] cursor-pointer"
                                >
                                  <Edit3 size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEmpToDelete(emp)}
                                  title="Supprimer"
                                  className="p-1.5 rounded-lg bg-white hover:bg-red-50 border border-[#E8D8BE] text-red-600 cursor-pointer"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </AppPanel>
      )}

      {/* ONGLET 2 : PAIE MENSUELLE */}
      {activeTab === 'payroll' && (
        <AppPanel className="space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <SectionHeading
              title={`Traitement de la Paie · ${formatPeriodLabel(selectedMonth)}`}
              icon={<CreditCard size={18} />}
            />
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 bg-[#FAF8F3] border border-[#E8D8BE] px-2.5 py-1.5 rounded-xl">
                <Filter size={13} className="text-[#D39725]" />
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="text-xs font-extrabold text-[#192A24] bg-transparent outline-none"
                />
              </div>

              {canManagePayroll && (
                <>
                  <button
                    type="button"
                    onClick={handleGenerateMonth}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#D39725] hover:bg-[#BA841E] text-white text-xs font-extrabold cursor-pointer"
                  >
                    <Users size={14} />
                    <span>Générer paie du mois</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openCreatePayslip()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#E8D8BE] bg-white hover:bg-[#FAF8F3] text-xs font-bold cursor-pointer"
                  >
                    <Plus size={14} />
                    <span>Bulletin individuel</span>
                  </button>
                </>
              )}

              {canExportReports && monthPayrolls.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => handleExportPayrollExcel(monthPayrolls, selectedMonth)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-xs font-bold cursor-pointer"
                  >
                    <FileSpreadsheet size={14} />
                    <span>Excel</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowMonthlyStatementPreview(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#192A24] hover:bg-[#253D34] text-white text-xs font-bold cursor-pointer"
                  >
                    <Printer size={14} />
                    <span>État de paie</span>
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-[#FAF8F3] border border-[#E8D8BE]">
              <div className="text-[#7D8176]">Total Brut</div>
              <div className="font-black text-base text-[#192A24]">
                {formatMoney(monthStats.totalGross)} FCFA
              </div>
            </div>
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
              <div className="text-amber-800">Avances &amp; Retenues</div>
              <div className="font-black text-base text-amber-900">
                -{formatMoney(monthStats.totalDeductions)} FCFA
              </div>
            </div>
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
              <div className="text-emerald-800">Total Net Payé</div>
              <div className="font-black text-base text-emerald-900">
                {formatMoney(monthStats.paidAmount)} FCFA
              </div>
            </div>
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200">
              <div className="text-rose-800">Reste à Régler</div>
              <div className="font-black text-base text-rose-900">
                {formatMoney(monthStats.unpaidAmount)} FCFA
              </div>
            </div>
          </div>

          {monthPayrolls.length === 0 ? (
            <div className="p-10 text-center rounded-2xl bg-[#FAF8F3] border border-[#E8D8BE] space-y-2">
              <CreditCard size={28} className="mx-auto text-[#D39725]" />
              <div className="text-sm font-black text-[#192A24]">
                Aucun bulletin de paie pour {formatPeriodLabel(selectedMonth)}
              </div>
              <p className="text-xs text-[#7D8176]">
                Cliquez sur « Générer paie du mois » pour créer automatiquement les bulletins de tous vos employés actifs.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[#E8D8BE]">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#FAF8F3] text-[#7D8176] border-b border-[#E8D8BE] text-[11px]">
                    <th className="p-3">Réf.</th>
                    <th className="p-3">Employé</th>
                    <th className="p-3 text-right">Base</th>
                    <th className="p-3 text-right">Primes + Indem. + H.Sup</th>
                    <th className="p-3 text-right">Retenues</th>
                    <th className="p-3 text-right">Net à Payer</th>
                    <th className="p-3">Statut / Compte</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3EBDC] bg-white">
                  {monthPayrolls.map((rec) => {
                    const extras = rec.bonusXaf + rec.allowancesXaf + rec.overtimeXaf;
                    const deds = rec.advanceDeductionXaf + rec.otherDeductionsXaf;
                    const isPaid = rec.status === 'paid';
                    return (
                      <tr key={rec.id} className="hover:bg-[#FAF8F3]/60">
                        <td className="p-3 font-mono font-bold text-[#192A24]">{rec.reference}</td>
                        <td className="p-3">
                          <div className="font-black text-[#192A24]">{rec.employeeName}</div>
                          <div className="text-[11px] text-[#7D8176]">
                            {rec.employeeMatricule} · {rec.jobTitle}
                          </div>
                        </td>
                        <td className="p-3 text-right font-semibold">
                          {formatMoney(rec.baseSalaryXaf)} F
                        </td>
                        <td className="p-3 text-right text-emerald-700 font-semibold">
                          +{formatMoney(extras)} F
                        </td>
                        <td className="p-3 text-right text-rose-700 font-semibold">
                          -{formatMoney(deds)} F
                        </td>
                        <td className="p-3 text-right font-black text-[#192A24]">
                          {formatMoney(rec.netSalaryXaf)} FCFA
                        </td>
                        <td className="p-3">
                          {isPaid ? (
                            <div>
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-extrabold">
                                <CheckCircle2 size={10} /> Payé
                              </span>
                              <div className="text-[10px] text-[#7D8176] mt-0.5">
                                {rec.paidFromAccount}
                              </div>
                            </div>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-extrabold">
                              À payer
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          <div className="inline-flex items-center gap-1">
                            {!isPaid && canManagePayroll && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openEditPayslip(rec)}
                                  title="Ajuster primes / retenues"
                                  className="p-1.5 rounded-lg border border-[#E8D8BE] bg-white hover:bg-[#FAF8F3] text-[#192A24] cursor-pointer"
                                >
                                  <Edit3 size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPaymentToPay(rec);
                                    setPayNote('');
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-[#008B62] hover:bg-[#007452] text-white text-[11px] font-extrabold cursor-pointer"
                                >
                                  Payer
                                </button>
                              </>
                            )}
                            {canExportReports && (
                              <button
                                type="button"
                                onClick={() => setPayslipPrintRecord(rec)}
                                title="Aperçu / Imprimer Bulletin"
                                className="p-1.5 rounded-lg border border-[#E8D8BE] bg-white hover:bg-[#FAF8F3] text-[#192A24] cursor-pointer"
                              >
                                <Printer size={13} />
                              </button>
                            )}
                            {!isPaid && canManagePayroll && (
                              <button
                                type="button"
                                onClick={() => setPaymentToDelete(rec)}
                                title="Supprimer brouillon"
                                className="p-1.5 rounded-lg border border-[#E8D8BE] bg-white hover:bg-red-50 text-red-600 cursor-pointer"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </AppPanel>
      )}

      {/* ONGLET 3 : HISTORIQUE & BULLETINS */}
      {activeTab === 'history' && (
        <AppPanel className="space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <SectionHeading
              title="Historique Complet des Salaires & Bulletins"
              icon={<FileText size={18} />}
            />
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={historyEmpFilter}
                onChange={(e) => setHistoryEmpFilter(e.target.value)}
                className="px-3 py-2 rounded-xl border border-[#E8D8BE] bg-white text-xs font-bold"
              >
                <option value="ALL">Tous les employés</option>
                {store.employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.fullName} ({emp.matricule})
                  </option>
                ))}
              </select>
              {canExportReports && historyPayrolls.length > 0 && (
                <button
                  type="button"
                  onClick={() => handleExportPayrollExcel(historyPayrolls, 'Historique')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-xs font-bold cursor-pointer"
                >
                  <Download size={14} />
                  <span>Exporter tout (.xlsx)</span>
                </button>
              )}
            </div>
          </div>

          {historyPayrolls.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#7D8176] bg-[#FAF8F3] rounded-xl border border-[#E8D8BE]">
              Aucun historique de salaire enregistré.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[#E8D8BE]">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#FAF8F3] text-[#7D8176] border-b border-[#E8D8BE] text-[11px]">
                    <th className="p-3">Période</th>
                    <th className="p-3">Référence</th>
                    <th className="p-3">Employé</th>
                    <th className="p-3 text-right">Brut</th>
                    <th className="p-3 text-right">Retenues</th>
                    <th className="p-3 text-right">Net</th>
                    <th className="p-3">Statut</th>
                    <th className="p-3 text-right">Bulletin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3EBDC] bg-white">
                  {historyPayrolls.map((rec) => (
                    <tr key={rec.id} className="hover:bg-[#FAF8F3]/60">
                      <td className="p-3 font-bold text-[#192A24] capitalize">
                        {formatPeriodLabel(rec.periodMonth)}
                      </td>
                      <td className="p-3 font-mono text-[#7D8176]">{rec.reference}</td>
                      <td className="p-3">
                        <div className="font-bold text-[#192A24]">{rec.employeeName}</div>
                        <div className="text-[11px] text-[#7D8176]">{rec.jobTitle}</div>
                      </td>
                      <td className="p-3 text-right">{formatMoney(rec.grossSalaryXaf)} F</td>
                      <td className="p-3 text-right text-rose-700">
                        -{formatMoney(rec.advanceDeductionXaf + rec.otherDeductionsXaf)} F
                      </td>
                      <td className="p-3 text-right font-black text-[#192A24]">
                        {formatMoney(rec.netSalaryXaf)} FCFA
                      </td>
                      <td className="p-3">
                        {rec.status === 'paid' ? (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-extrabold">
                            Payé {rec.paidAt ? `· ${new Date(rec.paidAt).toLocaleDateString('fr-FR')}` : ''}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-extrabold">
                            Brouillon
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        {canExportReports && (
                          <button
                            type="button"
                            onClick={() => setPayslipPrintRecord(rec)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#E8D8BE] bg-white hover:bg-[#FAF8F3] text-xs font-bold cursor-pointer"
                          >
                            <Printer size={12} />
                            <span>Bulletin</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AppPanel>
      )}

      {/* MODAL CRÉATION / MODIFICATION EMPLOYÉ */}
      <Modal
        isOpen={showEmpModal}
        onClose={() => setShowEmpModal(false)}
        title={editingEmployee ? `Modifier : ${editingEmployee.fullName}` : 'Nouvel Employé'}
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleSubmitEmployee} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-[#7D8176] mb-1">Nom complet *</label>
              <input
                type="text"
                required
                value={empForm.fullName}
                onChange={(e) => setEmpForm({ ...empForm, fullName: e.target.value })}
                placeholder="Ex: Jean-Luc Moukoko"
                className="w-full px-3 py-2 rounded-xl border border-[#E8D8BE] bg-[#FAF8F3] font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-[#7D8176] mb-1">
                Matricule (auto si vide)
              </label>
              <input
                type="text"
                value={empForm.matricule}
                onChange={(e) => setEmpForm({ ...empForm, matricule: e.target.value })}
                placeholder="Ex: EMP-2026-001"
                className="w-full px-3 py-2 rounded-xl border border-[#E8D8BE] bg-[#FAF8F3] font-mono"
              />
            </div>
            <div>
              <label className="block font-bold text-[#7D8176] mb-1">Poste / Fonction *</label>
              <input
                type="text"
                required
                value={empForm.jobTitle}
                onChange={(e) => setEmpForm({ ...empForm, jobTitle: e.target.value })}
                placeholder="Ex: Caissier Principal / Fondeur"
                className="w-full px-3 py-2 rounded-xl border border-[#E8D8BE] bg-[#FAF8F3] font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-[#7D8176] mb-1">Département</label>
              <select
                value={empForm.department}
                onChange={(e) => setEmpForm({ ...empForm, department: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-[#E8D8BE] bg-[#FAF8F3] font-semibold"
              >
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-bold text-[#7D8176] mb-1">Type de contrat</label>
              <select
                value={empForm.contractType}
                onChange={(e) =>
                  setEmpForm({ ...empForm, contractType: e.target.value as EmploymentContractType })
                }
                className="w-full px-3 py-2 rounded-xl border border-[#E8D8BE] bg-[#FAF8F3] font-semibold"
              >
                {CONTRACT_TYPES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-bold text-[#7D8176] mb-1">Statut RH</label>
              <select
                value={empForm.status}
                onChange={(e) =>
                  setEmpForm({ ...empForm, status: e.target.value as EmployeeStatus })
                }
                className="w-full px-3 py-2 rounded-xl border border-[#E8D8BE] bg-[#FAF8F3] font-semibold"
              >
                <option value="active">Actif</option>
                <option value="on_leave">En congé</option>
                <option value="suspended">Suspendu</option>
                <option value="terminated">Sorti / Fin contrat</option>
              </select>
            </div>
            <div>
              <label className="block font-bold text-[#7D8176] mb-1">Date d’embauche</label>
              <input
                type="date"
                value={empForm.hireDate}
                onChange={(e) => setEmpForm({ ...empForm, hireDate: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-[#E8D8BE] bg-[#FAF8F3]"
              />
            </div>
            <div>
              <label className="block font-bold text-[#7D8176] mb-1">Téléphone</label>
              <input
                type="text"
                value={empForm.phone}
                onChange={(e) => setEmpForm({ ...empForm, phone: e.target.value })}
                placeholder="+242 06 ..."
                className="w-full px-3 py-2 rounded-xl border border-[#E8D8BE] bg-[#FAF8F3]"
              />
            </div>
            <div>
              <label className="block font-bold text-[#7D8176] mb-1">
                Salaire de base mensuel (FCFA) *
              </label>
              <input
                type="number"
                min={0}
                required
                value={empForm.baseSalaryXaf}
                onChange={(e) => setEmpForm({ ...empForm, baseSalaryXaf: e.target.value })}
                placeholder="Ex: 250000"
                className="w-full px-3 py-2 rounded-xl border border-[#E8D8BE] bg-white font-black"
              />
            </div>
            <div>
              <label className="block font-bold text-[#7D8176] mb-1">Prime fixe (FCFA)</label>
              <input
                type="number"
                min={0}
                value={empForm.defaultBonusXaf}
                onChange={(e) => setEmpForm({ ...empForm, defaultBonusXaf: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-[#E8D8BE] bg-white font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-[#7D8176] mb-1">
                Indemnité transport / logement (FCFA)
              </label>
              <input
                type="number"
                min={0}
                value={empForm.defaultAllowanceXaf}
                onChange={(e) => setEmpForm({ ...empForm, defaultAllowanceXaf: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-[#E8D8BE] bg-white font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-[#7D8176] mb-1">Mode de versement</label>
              <select
                value={empForm.paymentMethod}
                onChange={(e) =>
                  setEmpForm({ ...empForm, paymentMethod: e.target.value as SalaryPaymentMethod })
                }
                className="w-full px-3 py-2 rounded-xl border border-[#E8D8BE] bg-[#FAF8F3] font-semibold"
              >
                {PAYMENT_METHODS.map((pm) => (
                  <option key={pm} value={pm}>
                    {pm}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-bold text-[#7D8176] mb-1">
                N° Compte / RIB / Mobile Money
              </label>
              <input
                type="text"
                value={empForm.bankAccountOrRib}
                onChange={(e) => setEmpForm({ ...empForm, bankAccountOrRib: e.target.value })}
                placeholder="Optionnel"
                className="w-full px-3 py-2 rounded-xl border border-[#E8D8BE] bg-[#FAF8F3]"
              />
            </div>
            <div>
              <label className="block font-bold text-[#7D8176] mb-1">N° CNI / Passeport</label>
              <input
                type="text"
                value={empForm.idNumber}
                onChange={(e) => setEmpForm({ ...empForm, idNumber: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-[#E8D8BE] bg-[#FAF8F3]"
              />
            </div>
          </div>

          <div>
            <label className="block font-bold text-[#7D8176] mb-1">Notes dossier RH</label>
            <textarea
              rows={2}
              value={empForm.notes}
              onChange={(e) => setEmpForm({ ...empForm, notes: e.target.value })}
              className="w-full p-2.5 rounded-xl border border-[#E8D8BE] bg-[#FAF8F3]"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-[#E8D8BE]">
            <button
              type="button"
              onClick={() => setShowEmpModal(false)}
              className="px-4 py-2 rounded-xl border border-[#E8D8BE] bg-white text-xs font-bold cursor-pointer"
            >
              Annuler
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-[#192A24] hover:bg-[#253D34] text-white text-xs font-extrabold cursor-pointer"
            >
              {editingEmployee ? 'Enregistrer les modifications' : 'Créer l’employé'}
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL BULLETIN INDIVIDUEL (CRÉER / MODIFIER) */}
      <Modal
        isOpen={showPayslipModal}
        onClose={() => setShowPayslipModal(false)}
        title="Préparer / Ajuster un Bulletin de Paie"
        maxWidth="max-w-lg"
      >
        <form onSubmit={handleSavePayslip} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-[#7D8176] mb-1">Employé *</label>
              <select
                value={payslipDraft.employeeId}
                disabled={Boolean(payslipDraft.id)}
                onChange={(e) => {
                  const chosen = store.employees.find((x) => x.id === e.target.value);
                  setPayslipDraft((prev) => ({
                    ...prev,
                    employeeId: e.target.value,
                    baseSalaryXaf: chosen ? String(chosen.baseSalaryXaf || 0) : prev.baseSalaryXaf,
                    bonusXaf: chosen ? String(chosen.defaultBonusXaf || 0) : prev.bonusXaf,
                    allowancesXaf: chosen
                      ? String(chosen.defaultAllowanceXaf || 0)
                      : prev.allowancesXaf,
                  }));
                }}
                className="w-full px-3 py-2 rounded-xl border border-[#E8D8BE] bg-[#FAF8F3] font-bold"
              >
                {store.employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.fullName} ({emp.matricule})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-bold text-[#7D8176] mb-1">Mois de paie *</label>
              <input
                type="month"
                required
                value={payslipDraft.periodMonth}
                onChange={(e) => setPayslipDraft({ ...payslipDraft, periodMonth: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-[#E8D8BE] bg-[#FAF8F3] font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-[#7D8176] mb-1">Salaire de base (FCFA)</label>
              <input
                type="number"
                min={0}
                value={payslipDraft.baseSalaryXaf}
                onChange={(e) =>
                  setPayslipDraft({ ...payslipDraft, baseSalaryXaf: e.target.value })
                }
                className="w-full px-3 py-2 rounded-xl border border-[#E8D8BE] bg-white font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-[#7D8176] mb-1">Primes / Bonus (FCFA)</label>
              <input
                type="number"
                min={0}
                value={payslipDraft.bonusXaf}
                onChange={(e) => setPayslipDraft({ ...payslipDraft, bonusXaf: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-[#E8D8BE] bg-white font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-[#7D8176] mb-1">Indemnités (FCFA)</label>
              <input
                type="number"
                min={0}
                value={payslipDraft.allowancesXaf}
                onChange={(e) =>
                  setPayslipDraft({ ...payslipDraft, allowancesXaf: e.target.value })
                }
                className="w-full px-3 py-2 rounded-xl border border-[#E8D8BE] bg-white font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-[#7D8176] mb-1">Heures sup. (FCFA)</label>
              <input
                type="number"
                min={0}
                value={payslipDraft.overtimeXaf}
                onChange={(e) =>
                  setPayslipDraft({ ...payslipDraft, overtimeXaf: e.target.value })
                }
                className="w-full px-3 py-2 rounded-xl border border-[#E8D8BE] bg-white font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-rose-700 mb-1">
                Retenue avance / prêt (FCFA)
              </label>
              <input
                type="number"
                min={0}
                value={payslipDraft.advanceDeductionXaf}
                onChange={(e) =>
                  setPayslipDraft({ ...payslipDraft, advanceDeductionXaf: e.target.value })
                }
                className="w-full px-3 py-2 rounded-xl border border-rose-200 bg-rose-50/40 font-bold"
              />
            </div>
            <div>
              <label className="block font-bold text-rose-700 mb-1">
                Autres retenues / absences (FCFA)
              </label>
              <input
                type="number"
                min={0}
                value={payslipDraft.otherDeductionsXaf}
                onChange={(e) =>
                  setPayslipDraft({ ...payslipDraft, otherDeductionsXaf: e.target.value })
                }
                className="w-full px-3 py-2 rounded-xl border border-rose-200 bg-rose-50/40 font-bold"
              />
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[#FAF8F3] border border-[#E8D8BE] flex items-center justify-between">
            <div>
              <div className="text-[11px] text-[#7D8176]">Brut total : {formatMoney(draftGrossPreview)} FCFA</div>
              <div className="text-sm font-black text-[#192A24]">
                Net à payer : {formatMoney(draftNetPreview)} FCFA
              </div>
            </div>
          </div>

          <div>
            <label className="block font-bold text-[#7D8176] mb-1">Observation</label>
            <input
              type="text"
              value={payslipDraft.notes}
              onChange={(e) => setPayslipDraft({ ...payslipDraft, notes: e.target.value })}
              placeholder="Ex: Prime de performance fonderie..."
              className="w-full px-3 py-2 rounded-xl border border-[#E8D8BE] bg-[#FAF8F3]"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-[#E8D8BE]">
            <button
              type="button"
              onClick={() => setShowPayslipModal(false)}
              className="px-4 py-2 rounded-xl border border-[#E8D8BE] bg-white text-xs font-bold cursor-pointer"
            >
              Annuler
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-[#192A24] hover:bg-[#253D34] text-white text-xs font-extrabold cursor-pointer"
            >
              Enregistrer le bulletin
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL PAIEMENT SALAIRE */}
      <Modal
        isOpen={Boolean(paymentToPay)}
        onClose={() => setPaymentToPay(null)}
        title="Confirmer le Paiement du Salaire"
        maxWidth="max-w-md"
      >
        {paymentToPay && (
          <div className="space-y-4 text-xs">
            <div className="p-3.5 rounded-xl bg-[#FAF8F3] border border-[#E8D8BE] space-y-1">
              <div className="font-black text-sm text-[#192A24]">{paymentToPay.employeeName}</div>
              <div className="text-[#7D8176]">
                {paymentToPay.reference} · {formatPeriodLabel(paymentToPay.periodMonth)}
              </div>
              <div className="text-lg font-black text-emerald-700 pt-1">
                Net à verser : {formatMoney(paymentToPay.netSalaryXaf)} FCFA
              </div>
            </div>

            <div className="p-3 rounded-xl border border-[#E8D8BE] bg-white font-semibold">
              Paiement débité automatiquement de la caisse <strong>{cashAccountName}</strong> et comptabilisé en charge OPEX.
              <div className="mt-1 text-[#7D8176]">
                Solde actuel : {formatMoney(store.bankBalances[cashAccountName] || 0)} FCFA
              </div>
            </div>

            <div>
              <label className="block font-bold text-[#7D8176] mb-1">Note de paiement</label>
              <input
                type="text"
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
                placeholder="Ex: Versé en main propre / Virement bancaire"
                className="w-full px-3 py-2 rounded-xl border border-[#E8D8BE] bg-[#FAF8F3]"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[#E8D8BE]">
              <button
                type="button"
                onClick={() => setPaymentToPay(null)}
                className="px-4 py-2 rounded-xl border border-[#E8D8BE] bg-white text-xs font-bold cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={isPaying}
                onClick={handleConfirmPay}
                className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-[#008B62] hover:bg-[#007452] text-white text-xs font-extrabold cursor-pointer"
              >
                {isPaying ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                <span>Valider le paiement</span>
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* MODAL CONFIRMATION SUPPRESSION EMPLOYÉ */}
      <Modal
        isOpen={Boolean(empToDelete)}
        onClose={() => setEmpToDelete(null)}
        title="Supprimer cet employé ?"
        maxWidth="max-w-sm"
      >
        {empToDelete && (
          <div className="space-y-4 text-xs">
            <p className="text-[#555B54]">
              Voulez-vous supprimer définitivement la fiche de <strong>{empToDelete.fullName}</strong> ({empToDelete.matricule}) ?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEmpToDelete(null)}
                className="px-4 py-2 rounded-xl border border-[#E8D8BE] bg-white font-bold cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => {
                  store.deleteEmployee(empToDelete.id);
                  setFeedback({
                    type: 'info',
                    text: `Employé « ${empToDelete.fullName} » supprimé.`,
                  });
                  setEmpToDelete(null);
                }}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold cursor-pointer"
              >
                Supprimer
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* MODAL CONFIRMATION SUPPRESSION BROUILLON PAIE */}
      <Modal
        isOpen={Boolean(paymentToDelete)}
        onClose={() => setPaymentToDelete(null)}
        title="Supprimer ce bulletin ?"
        maxWidth="max-w-sm"
      >
        {paymentToDelete && (
          <div className="space-y-4 text-xs">
            <p className="text-[#555B54]">
              Supprimer le bulletin en brouillon <strong>{paymentToDelete.reference}</strong> de{' '}
              <strong>{paymentToDelete.employeeName}</strong> ?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPaymentToDelete(null)}
                className="px-4 py-2 rounded-xl border border-[#E8D8BE] bg-white font-bold cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => {
                  store.deleteSalaryPayment(paymentToDelete.id);
                  setPaymentToDelete(null);
                }}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold cursor-pointer"
              >
                Supprimer
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* MODAL APERÇU / IMPRESSION BULLETIN INDIVIDUEL */}
      <Modal
        isOpen={Boolean(payslipPrintRecord)}
        onClose={() => setPayslipPrintRecord(null)}
        title="Bulletin de Paie — Aperçu avant impression"
        maxWidth="max-w-2xl"
        printMode={true}
      >
        {payslipPrintRecord && (
          <div className="space-y-4 text-[#192A24] text-xs">
            <div className="no-print flex justify-end gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#192A24] hover:bg-[#253D34] text-white font-extrabold cursor-pointer"
              >
                <Printer size={14} />
                <span>Imprimer le bulletin</span>
              </button>
            </div>

            <div className="p-5 rounded-2xl border border-[#E8D8BE] bg-white print:border-0 space-y-5">
              <div className="flex justify-between items-start border-b-2 border-[#192A24] pb-3">
                <div>
                  <div className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#AA6B0B]">
                    CAMS GOLD · RESSOURCES HUMAINES
                  </div>
                  <h2 className="text-lg font-black mt-0.5">BULLETIN DE PAIE</h2>
                  <div className="text-[11px] text-[#555B54] capitalize">
                    Période : <strong>{formatPeriodLabel(payslipPrintRecord.periodMonth)}</strong>
                  </div>
                </div>
                <div className="text-right text-[11px] space-y-0.5">
                  <div>
                    Réf. : <strong>{payslipPrintRecord.reference}</strong>
                  </div>
                  <div>
                    Statut :{' '}
                    <strong>{payslipPrintRecord.status === 'paid' ? 'PAYÉ' : 'BROUILLON'}</strong>
                  </div>
                  {payslipPrintRecord.paidAt && (
                    <div>
                      Payé le : {new Date(payslipPrintRecord.paidAt).toLocaleDateString('fr-FR')}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 p-3 rounded-xl bg-[#FAF8F3] border border-[#E8D8BE]">
                <div className="space-y-0.5">
                  <div className="text-[10px] text-[#7D8176] uppercase font-bold">Salarié</div>
                  <div className="font-black text-sm">{payslipPrintRecord.employeeName}</div>
                  <div>Matricule : {payslipPrintRecord.employeeMatricule}</div>
                </div>
                <div className="space-y-0.5">
                  <div className="text-[10px] text-[#7D8176] uppercase font-bold">Affectation</div>
                  <div className="font-bold">{payslipPrintRecord.jobTitle}</div>
                  <div>{payslipPrintRecord.department}</div>
                </div>
              </div>

              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#FAF8F3] border-b border-[#E8D8BE]">
                    <th className="py-2 px-3">Rubrique de paie</th>
                    <th className="py-2 px-3 text-right">Gains (FCFA)</th>
                    <th className="py-2 px-3 text-right">Retenues (FCFA)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3EBDC]">
                  <tr>
                    <td className="py-2 px-3 font-bold">Salaire de base mensuel</td>
                    <td className="py-2 px-3 text-right">{formatMoney(payslipPrintRecord.baseSalaryXaf)}</td>
                    <td className="py-2 px-3 text-right">—</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3">Primes &amp; Gratifications</td>
                    <td className="py-2 px-3 text-right">{formatMoney(payslipPrintRecord.bonusXaf)}</td>
                    <td className="py-2 px-3 text-right">—</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3">Indemnités (transport / logement)</td>
                    <td className="py-2 px-3 text-right">{formatMoney(payslipPrintRecord.allowancesXaf)}</td>
                    <td className="py-2 px-3 text-right">—</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3">Heures supplémentaires</td>
                    <td className="py-2 px-3 text-right">{formatMoney(payslipPrintRecord.overtimeXaf)}</td>
                    <td className="py-2 px-3 text-right">—</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3">Retenue avance / acompte</td>
                    <td className="py-2 px-3 text-right">—</td>
                    <td className="py-2 px-3 text-right text-rose-700">
                      {formatMoney(payslipPrintRecord.advanceDeductionXaf)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3">Autres retenues</td>
                    <td className="py-2 px-3 text-right">—</td>
                    <td className="py-2 px-3 text-right text-rose-700">
                      {formatMoney(payslipPrintRecord.otherDeductionsXaf)}
                    </td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[#192A24] bg-[#FAF8F3] font-black text-sm">
                    <td className="py-2.5 px-3">NET À PAYER</td>
                    <td className="py-2.5 px-3 text-right text-emerald-800" colSpan={2}>
                      {formatMoney(payslipPrintRecord.netSalaryXaf)} FCFA
                    </td>
                  </tr>
                </tfoot>
              </table>

              <div className="grid grid-cols-2 gap-4 pt-6 text-[11px] text-[#555B54]">
                <div>Signature Direction / RH : _____________________</div>
                <div className="text-right">Signature Salarié : _____________________</div>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* MODAL APERÇU / IMPRESSION ÉTAT MENSUEL COMPLET */}
      <Modal
        isOpen={showMonthlyStatementPreview}
        onClose={() => setShowMonthlyStatementPreview(false)}
        title={`État de Paie · ${formatPeriodLabel(selectedMonth)}`}
        maxWidth="max-w-5xl"
        printMode={true}
      >
        <div className="space-y-4 text-[#192A24] text-xs">
          <div className="no-print flex justify-end gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#192A24] hover:bg-[#253D34] text-white font-extrabold cursor-pointer"
            >
              <Printer size={14} />
              <span>Imprimer / PDF</span>
            </button>
          </div>

          <div className="p-5 rounded-2xl border border-[#E8D8BE] bg-white print:border-0 space-y-4">
            <div className="flex justify-between items-start border-b-2 border-[#192A24] pb-3">
              <div>
                <div className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#AA6B0B]">
                  CAMS GOLD · ÉTAT RÉCAPITULATIF DES SALAIRES
                </div>
                <h2 className="text-lg font-black mt-0.5 capitalize">
                  Paie de {formatPeriodLabel(selectedMonth)}
                </h2>
              </div>
              <div className="text-right text-[11px]">
                <div>Édité le {new Date().toLocaleDateString('fr-FR')}</div>
                <div>Effectif : {monthPayrolls.length} bulletin(s)</div>
              </div>
            </div>

            <table className="w-full text-left border-collapse text-[11px]">
              <thead>
                <tr className="bg-[#FAF8F3] border-b border-[#E8D8BE]">
                  <th className="py-2 px-2.5">Réf.</th>
                  <th className="py-2 px-2.5">Employé</th>
                  <th className="py-2 px-2.5">Poste</th>
                  <th className="py-2 px-2.5 text-right">Base</th>
                  <th className="py-2 px-2.5 text-right">Primes &amp; Indem.</th>
                  <th className="py-2 px-2.5 text-right">Retenues</th>
                  <th className="py-2 px-2.5 text-right">Net à Payer</th>
                  <th className="py-2 px-2.5 text-right">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3EBDC]">
                {monthPayrolls.map((rec) => (
                  <tr key={rec.id}>
                    <td className="py-1.5 px-2.5 font-mono">{rec.reference}</td>
                    <td className="py-1.5 px-2.5 font-bold">{rec.employeeName}</td>
                    <td className="py-1.5 px-2.5">{rec.jobTitle}</td>
                    <td className="py-1.5 px-2.5 text-right">{formatMoney(rec.baseSalaryXaf)}</td>
                    <td className="py-1.5 px-2.5 text-right">
                      {formatMoney(rec.bonusXaf + rec.allowancesXaf + rec.overtimeXaf)}
                    </td>
                    <td className="py-1.5 px-2.5 text-right text-rose-700">
                      -{formatMoney(rec.advanceDeductionXaf + rec.otherDeductionsXaf)}
                    </td>
                    <td className="py-1.5 px-2.5 text-right font-black">
                      {formatMoney(rec.netSalaryXaf)} FCFA
                    </td>
                    <td className="py-1.5 px-2.5 text-right">
                      {rec.status === 'paid' ? 'Payé' : 'À payer'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[#192A24] bg-[#FAF8F3] font-black">
                  <td colSpan={6} className="py-2 px-2.5 text-right">
                    TOTAL NET MENSUEL :
                  </td>
                  <td className="py-2 px-2.5 text-right">{formatMoney(monthStats.totalNet)} FCFA</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </Modal>
    </div>
  );
};
