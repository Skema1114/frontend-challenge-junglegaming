import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { DialogModule } from 'primeng/dialog';
import { DividerModule } from 'primeng/divider';
import { DropdownModule } from 'primeng/dropdown';
import { InputSwitchModule } from 'primeng/inputswitch';
import { InputTextModule } from 'primeng/inputtext';
import { PanelModule } from 'primeng/panel';
import { TableModule } from 'primeng/table';
import { TabViewModule } from 'primeng/tabview';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { ToolbarModule } from 'primeng/toolbar';
import { firstValueFrom } from 'rxjs';
import {
  HealthReadyDto,
  LedgerEntryDto,
  MetricsSnapshotDto,
  ReconciliationDto,
  SubmitWagerPayload,
  WagerCallOutcome,
  WagerKind,
  WalletDto,
} from './core/wagering-api.models';
import { WageringApiService } from './core/wagering-api.service';
import {
  ConcurrencySimulatorService,
  SimulationReport,
} from './features/simulators/concurrency-simulator.service';

const STORAGE_KEY = 'wagering_ops_recent_wallets_v1';
const THEME_STORAGE_KEY = 'wagering_ops_dark_theme_v1';

interface KindOption {
  label: string;
  value: WagerKind;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ToolbarModule,
    CardModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    DropdownModule,
    TableModule,
    TagModule,
    TabViewModule,
    ToastModule,
    InputSwitchModule,
    DividerModule,
    PanelModule,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly api = inject(WageringApiService);
  private readonly simulator = inject(ConcurrencySimulatorService);
  private readonly toast = inject(MessageService);
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  readonly kindOptions: KindOption[] = [
    { label: 'BET (Débito)', value: 'BET' },
    { label: 'WIN (Crédito)', value: 'WIN' },
    { label: 'LOSS (Sem mover saldo)', value: 'LOSS' },
    { label: 'REFUND (Reverte BET)', value: 'REFUND' },
    { label: 'ROLLBACK (Inverte transação)', value: 'ROLLBACK' },
  ];

  activeTabIndex = 0;
  createDialogVisible = false;
  darkMode = true;

  readonly health = signal<HealthReadyDto | null>(null);
  readonly metrics = signal<MetricsSnapshotDto | null>(null);
  autoRefresh = true;

  readonly activeWallet = signal<WalletDto | null>(null);
  readonly recentWallets = signal<WalletDto[]>([]);
  readonly reconciliation = signal<ReconciliationDto | null>(null);
  readonly ledgerEntries = signal<LedgerEntryDto[]>([]);
  readonly ledgerNextCursor = signal<string | null>(null);
  readonly loadingWallet = signal<boolean>(false);

  newPlayerId = this.generatePlayerId();
  newInitialAmount = '100.00';
  newCurrency = 'BRL';
  lookupWalletId = '';

  txProviderId = 'provider-a';
  txExternalId = this.generateTxId('tx');
  txIdempotencyKey = `provider-a:${this.txExternalId}`;
  txRoundId = 'round-1';
  txGameId = 'fortune-chimp';
  txKind: WagerKind = 'BET';
  txAmount = '25.00';
  txCurrency = 'BRL';
  txReferenceExternalId = '';

  readonly submittingTx = signal<boolean>(false);
  readonly lastOutcome = signal<WagerCallOutcome | null>(null);
  readonly lastSentPayload = signal<{ key: string; payload: SubmitWagerPayload } | null>(null);

  readonly runningSimulation = signal<boolean>(false);
  readonly simulationReports = signal<SimulationReport[]>([]);

  readonly statusEntries = computed(() => {
    const m = this.metrics();
    if (!m) return [];
    return Object.entries(m.transactionsByStatus);
  });

  readonly walletDropdownOptions = computed(() =>
    this.recentWallets().map((w) => ({
      label: `${w.playerId} · ${w.id.slice(0, 6)} (${w.balance.amount} ${w.balance.currency}, v${w.version})`,
      value: w.id,
    })),
  );

  ngOnInit(): void {
    this.restoreTheme();
    this.restoreRecentWallets();
    void this.refreshTelemetry();
    this.pollTimer = setInterval(() => {
      if (this.autoRefresh) {
        void this.refreshTelemetry();
      }
    }, 3000);
  }

  ngOnDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
  }

  private restoreTheme(): void {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    this.darkMode = saved === null ? true : saved === 'true';
    this.applyTheme();
  }

  onThemeToggle(): void {
    localStorage.setItem(THEME_STORAGE_KEY, String(this.darkMode));
    this.applyTheme();
  }

  private applyTheme(): void {
    const themeName = this.darkMode ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', themeName);
    const link = document.getElementById('app-theme') as HTMLLinkElement | null;
    if (link) {
      link.href = this.darkMode ? 'theme-dark.css' : 'theme-light.css';
    }
  }

  private generateTxId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  private generatePlayerId(): string {
    return `jogador-${Math.random().toString(36).slice(2, 6)}`;
  }

  private restoreRecentWallets(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as WalletDto[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        this.recentWallets.set(parsed);
        void this.selectWallet(parsed[0].id, false);
      }
    } catch {
      // ignore invalid storage
    }
  }

  private saveWalletToRecent(wallet: WalletDto): void {
    const filtered = this.recentWallets().filter((w) => w.id !== wallet.id);
    const updated = [wallet, ...filtered].slice(0, 10);
    this.recentWallets.set(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }

  openCreateDialog(): void {
    this.newPlayerId = this.generatePlayerId();
    this.createDialogVisible = true;
  }

  async refreshTelemetry(): Promise<void> {
    try {
      const [h, m] = await Promise.all([
        firstValueFrom(this.api.getHealthReady()),
        firstValueFrom(this.api.getMetrics()),
      ]);
      this.health.set(h);
      this.metrics.set(m);
    } catch {
      this.health.set({ status: 'unreachable', checks: { postgres: 'down', sqs: 'down' } });
    }
  }

  async createWallet(switchToOps = true): Promise<void> {
    if (!this.newPlayerId.trim() || !this.newInitialAmount.trim() || !this.newCurrency.trim()) {
      this.toast.add({
        severity: 'warn',
        summary: 'Campos obrigatórios',
        detail: 'Preencha Player ID, saldo inicial e moeda.',
      });
      return;
    }
    this.loadingWallet.set(true);
    try {
      const wallet = await firstValueFrom(
        this.api.createWallet(this.newPlayerId.trim(), {
          amount: this.newInitialAmount.trim(),
          currency: this.newCurrency.trim().toUpperCase(),
        }),
      );
      this.createDialogVisible = false;
      this.newPlayerId = this.generatePlayerId();
      this.activeWallet.set(wallet);
      this.saveWalletToRecent(wallet);
      this.txCurrency = wallet.balance.currency;
      await this.loadLedgerReset(wallet.id);
      await this.runReconciliation(false);
      await this.refreshTelemetry();
      if (switchToOps) {
        this.activeTabIndex = 0;
      }
      this.toast.add({
        severity: 'success',
        summary: 'Carteira criada',
        detail: `${wallet.playerId} (${wallet.balance.amount} ${wallet.balance.currency})`,
      });
    } catch (err: unknown) {
      this.toast.add({
        severity: 'error',
        summary: 'Erro ao criar carteira',
        detail: this.extractErrorMessage(err),
      });
    } finally {
      this.loadingWallet.set(false);
    }
  }

  async loadWalletById(): Promise<void> {
    if (!this.lookupWalletId.trim()) return;
    await this.selectWallet(this.lookupWalletId.trim(), true);
  }

  async selectWallet(walletId: string, notify = false): Promise<void> {
    if (!walletId) return;
    this.loadingWallet.set(true);
    try {
      const wallet = await firstValueFrom(this.api.getWallet(walletId));
      this.activeWallet.set(wallet);
      this.saveWalletToRecent(wallet);
      this.txCurrency = wallet.balance.currency;
      await this.loadLedgerReset(wallet.id);
      await this.runReconciliation(false);
      if (notify) {
        this.toast.add({
          severity: 'info',
          summary: 'Carteira carregada',
          detail: `${wallet.playerId}: ${wallet.balance.amount} ${wallet.balance.currency}`,
        });
      }
    } catch (err: unknown) {
      this.toast.add({
        severity: 'error',
        summary: 'Carteira não encontrada',
        detail: this.extractErrorMessage(err),
      });
    } finally {
      this.loadingWallet.set(false);
    }
  }

  async loadLedgerReset(walletId: string): Promise<void> {
    try {
      const page = await firstValueFrom(this.api.getLedger(walletId, null, 12));
      this.ledgerEntries.set(page.items);
      this.ledgerNextCursor.set(page.nextCursor);
    } catch (err: unknown) {
      this.toast.add({
        severity: 'error',
        summary: 'Erro ao carregar ledger',
        detail: this.extractErrorMessage(err),
      });
    }
  }

  async loadNextLedgerPage(): Promise<void> {
    const w = this.activeWallet();
    const cursor = this.ledgerNextCursor();
    if (!w || !cursor) return;
    try {
      const page = await firstValueFrom(this.api.getLedger(w.id, cursor, 12));
      this.ledgerEntries.update((curr) => [...curr, ...page.items]);
      this.ledgerNextCursor.set(page.nextCursor);
    } catch (err: unknown) {
      this.toast.add({
        severity: 'error',
        summary: 'Erro ao paginar ledger',
        detail: this.extractErrorMessage(err),
      });
    }
  }

  async runReconciliation(notify = true): Promise<void> {
    const w = this.activeWallet();
    if (!w) return;
    try {
      const rec = await firstValueFrom(this.api.reconcileWallet(w.id));
      this.reconciliation.set(rec);
      if (notify) {
        this.toast.add({
          severity: rec.consistent ? 'success' : 'error',
          summary: rec.consistent ? 'Saldo reconciliado' : 'Divergência encontrada',
          detail: `Saldo=${rec.storedBalance.amount} | Ledger=${rec.calculatedBalance.amount} (${rec.checkedEntries} lançamentos)`,
        });
      }
    } catch (err: unknown) {
      this.toast.add({
        severity: 'error',
        summary: 'Erro na reconciliação',
        detail: this.extractErrorMessage(err),
      });
    }
  }

  syncIdempotencyKey(): void {
    this.txIdempotencyKey = `${this.txProviderId}:${this.txExternalId}`;
  }

  regenerateIds(): void {
    this.txExternalId = this.generateTxId('tx');
    this.syncIdempotencyKey();
  }

  showReferenceField(): boolean {
    return this.txKind === 'REFUND' || this.txKind === 'ROLLBACK' || this.txKind === 'WIN';
  }

  async submitTransaction(): Promise<void> {
    const wallet = this.activeWallet();
    if (!wallet) {
      this.toast.add({
        severity: 'warn',
        summary: 'Nenhuma carteira ativa',
        detail: 'Crie ou selecione uma carteira primeiro.',
      });
      return;
    }

    if (!this.txProviderId.trim() || !this.txExternalId.trim() || !this.txIdempotencyKey.trim() || !this.txAmount.trim()) {
      this.toast.add({
        severity: 'warn',
        summary: 'Campos obrigatórios',
        detail: 'Preencha Provider ID, External Tx ID, Idempotency-Key e valor.',
      });
      return;
    }

    this.submittingTx.set(true);
    try {
      const payload: SubmitWagerPayload = {
        providerId: this.txProviderId.trim(),
        externalTransactionId: this.txExternalId.trim(),
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: this.txRoundId.trim(),
        gameId: this.txGameId.trim(),
        kind: this.txKind,
        money: {
          amount: this.txAmount.trim(),
          currency: this.txCurrency.trim().toUpperCase(),
        },
        ...(this.showReferenceField() && this.txReferenceExternalId.trim()
          ? { referenceExternalTransactionId: this.txReferenceExternalId.trim() }
          : {}),
      };
      const key = this.txIdempotencyKey.trim();
      const outcome = await this.api.submitWager(key, payload);
      this.lastOutcome.set(outcome);
      this.lastSentPayload.set({ key, payload });

      if (outcome.httpStatus >= 200 && outcome.httpStatus < 300) {
        await this.selectWallet(wallet.id, false);
      }
      await this.refreshTelemetry();
      this.toastOutcome(outcome);
    } finally {
      this.submittingTx.set(false);
    }
  }

  async replayLastTransaction(): Promise<void> {
    const last = this.lastSentPayload();
    if (!last) return;
    this.submittingTx.set(true);
    try {
      const outcome = await this.api.submitWager(last.key, last.payload);
      this.lastOutcome.set(outcome);
      await this.refreshTelemetry();
      this.toastOutcome(outcome);
    } finally {
      this.submittingTx.set(false);
    }
  }

  async forceConflictWithLastKey(): Promise<void> {
    const last = this.lastSentPayload();
    if (!last) return;
    this.submittingTx.set(true);
    try {
      const alteredPayload: SubmitWagerPayload = {
        ...last.payload,
        money: {
          ...last.payload.money,
          amount: '999.99',
        },
      };
      const outcome = await this.api.submitWager(last.key, alteredPayload);
      this.lastOutcome.set(outcome);
      await this.refreshTelemetry();
      this.toastOutcome(outcome);
    } finally {
      this.submittingTx.set(false);
    }
  }

  async useTransactionAsReference(transactionId: string): Promise<void> {
    try {
      const detail = await firstValueFrom(this.api.getTransactionById(transactionId));
      if (detail.kind === 'OPENING') {
        this.toast.add({
          severity: 'warn',
          summary: 'Transação interna OPENING',
          detail: 'Abertura de saldo não pode ser estornada por REFUND ou ROLLBACK.',
        });
        return;
      }

      this.txKind = detail.kind === 'BET' ? 'REFUND' : 'ROLLBACK';
      this.txProviderId = detail.providerId;
      this.txRoundId = detail.roundId;
      this.txGameId = detail.gameId;
      this.txAmount = detail.money.amount;
      this.txCurrency = detail.money.currency;
      this.txReferenceExternalId = detail.externalTransactionId;
      this.regenerateIds();
      this.activeTabIndex = 0;
      this.toast.add({
        severity: 'info',
        summary: `${this.txKind} preparado`,
        detail: `Referência apontando para ${detail.externalTransactionId}`,
      });
    } catch (err: unknown) {
      this.toast.add({
        severity: 'error',
        summary: 'Erro ao consultar transação',
        detail: this.extractErrorMessage(err),
      });
    }
  }

  async runSimulation(type: 'race' | 'idempotency' | 'outOfOrder'): Promise<void> {
    this.runningSimulation.set(true);
    try {
      const res =
        type === 'race'
          ? await this.simulator.runRace100vs2x80()
          : type === 'idempotency'
            ? await this.simulator.runParallelIdempotency(25)
            : await this.simulator.runOutOfOrderRefund();

      this.simulationReports.update((list) => [res.report, ...list].slice(0, 6));
      this.activeWallet.set(res.wallet);
      this.saveWalletToRecent(res.wallet);
      this.reconciliation.set(res.report.reconciliation);
      await this.loadLedgerReset(res.wallet.id);
      await this.refreshTelemetry();
      this.toast.add({
        severity: res.report.passed ? 'success' : 'error',
        summary: res.report.passed ? 'Teste concluído' : 'Teste falhou',
        detail: res.report.title,
      });
    } catch (err: unknown) {
      this.toast.add({
        severity: 'error',
        summary: 'Erro ao executar teste',
        detail: this.extractErrorMessage(err),
      });
    } finally {
      this.runningSimulation.set(false);
    }
  }

  copyWalletId(id: string): void {
    void navigator.clipboard?.writeText(id);
    this.toast.add({
      severity: 'info',
      summary: 'ID copiado',
      detail: id,
      life: 1800,
    });
  }

  outcomeSeverity(status: number): 'success' | 'info' | 'warning' | 'danger' {
    if (status === 201 || status === 200) return 'success';
    if (status === 202) return 'info';
    if (status === 409 || status === 422) return 'warning';
    return 'danger';
  }

  private toastOutcome(outcome: WagerCallOutcome): void {
    const severity = this.outcomeSeverity(outcome.httpStatus);
    const title = outcome.body.idempotentReplay
      ? `Replay idempotente (HTTP ${outcome.httpStatus})`
      : `HTTP ${outcome.httpStatus} (${outcome.body.status ?? outcome.body.error ?? 'Resposta'})`;
    const detail = outcome.body.failureCode
      ? `failureCode=${outcome.body.failureCode}`
      : `Saldo=${outcome.body.balance?.amount ?? '-'} ${outcome.body.balance?.currency ?? ''}`;
    this.toast.add({ severity, summary: title, detail, life: 3200 });
  }

  private extractErrorMessage(err: unknown): string {
    if (err && typeof err === 'object' && 'error' in err) {
      const httpErr = err as { error?: { message?: string; error?: string }; message?: string };
      if (httpErr.error?.message) {
        return `${httpErr.error.error ?? 'Erro'}: ${httpErr.error.message}`;
      }
      if (httpErr.message) return httpErr.message;
    }
    return 'Não foi possível conectar na API em localhost:3100.';
  }
}
