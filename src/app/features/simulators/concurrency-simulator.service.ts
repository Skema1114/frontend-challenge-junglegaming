import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { WageringApiService } from '../../core/wagering-api.service';
import {
  ReconciliationDto,
  WagerCallOutcome,
  WagerStatus,
  WalletDto,
} from '../../core/wagering-api.models';

export interface SimulationReport {
  id: string;
  title: string;
  walletId: string;
  passed: boolean;
  summary: string;
  durationMs: number;
  reconciliation: ReconciliationDto;
  steps: Array<{
    label: string;
    httpStatus: number;
    status: string;
    detail: string;
  }>;
}

@Injectable({ providedIn: 'root' })
export class ConcurrencySimulatorService {
  private readonly api = inject(WageringApiService);

  private uniqueTag(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  async runRace100vs2x80(): Promise<{ report: SimulationReport; wallet: WalletDto }> {
    const start = performance.now();
    const tag = this.uniqueTag();
    const wallet = await firstValueFrom(
      this.api.createWallet(`sim-race-${tag}`, { amount: '100.00', currency: 'BRL' }),
    );

    const [a, b] = await Promise.all([
      this.api.submitWager(`sim-prov:race-a-${tag}`, {
        providerId: 'sim-prov',
        externalTransactionId: `race-a-${tag}`,
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: `round-a-${tag}`,
        gameId: 'chimp-mines',
        kind: 'BET',
        money: { amount: '80.00', currency: 'BRL' },
      }),
      this.api.submitWager(`sim-prov:race-b-${tag}`, {
        providerId: 'sim-prov',
        externalTransactionId: `race-b-${tag}`,
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: `round-b-${tag}`,
        gameId: 'chimp-mines',
        kind: 'BET',
        money: { amount: '80.00', currency: 'BRL' },
      }),
    ]);

    const reconciliation = await firstValueFrom(this.api.reconcileWallet(wallet.id));
    const updatedWallet = await firstValueFrom(this.api.getWallet(wallet.id));
    const outcomes = [a, b];
    const processed = outcomes.filter((o) => o.body.status === 'PROCESSED').length;
    const rejected = outcomes.filter(
      (o) => o.body.status === 'REJECTED' && o.body.failureCode === 'INSUFFICIENT_FUNDS',
    ).length;

    const passed =
      processed === 1 &&
      rejected === 1 &&
      reconciliation.consistent &&
      reconciliation.storedBalance.amount === '20.00';

    return {
      wallet: updatedWallet,
      report: {
        id: `race-${tag}`,
        title: 'Concorrência: saldo 100 vs 2x BET 80',
        walletId: wallet.id,
        passed,
        summary: passed
          ? '1 aposta aprovada (201) e 1 rejeitada por INSUFFICIENT_FUNDS (422). Saldo final 20.00 BRL reconciliado.'
          : `Resultado inesperado: aprovadas=${processed}, rejeitadas=${rejected}, saldo=${reconciliation.storedBalance.amount}.`,
        durationMs: Number((performance.now() - start).toFixed(1)),
        reconciliation,
        steps: outcomes.map((o, i) => ({
          label: `Aposta simultânea #${i + 1} (80.00 BRL)`,
          httpStatus: o.httpStatus,
          status: o.body.status ?? o.body.error ?? 'ERROR',
          detail: o.body.failureCode
            ? `código=${o.body.failureCode}, saldo=${o.body.balance?.amount ?? '-'} (${o.durationMs} ms)`
            : `tx=${o.body.transactionId?.slice(0, 8) ?? '-'}, saldo=${o.body.balance?.amount ?? '-'} (${o.durationMs} ms)`,
        })),
      },
    };
  }

  async runParallelIdempotency(count = 25): Promise<{ report: SimulationReport; wallet: WalletDto }> {
    const start = performance.now();
    const tag = this.uniqueTag();
    const wallet = await firstValueFrom(
      this.api.createWallet(`sim-idem-${tag}`, { amount: '100.00', currency: 'BRL' }),
    );

    const payload = {
      providerId: 'sim-prov',
      externalTransactionId: `idem-bet-${tag}`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: `round-${tag}`,
      gameId: 'fortune-chimp',
      kind: 'BET' as const,
      money: { amount: '15.00', currency: 'BRL' },
    };
    const key = `sim-prov:idem-bet-${tag}`;

    const outcomes: WagerCallOutcome[] = await Promise.all(
      Array.from({ length: count }, () => this.api.submitWager(key, payload)),
    );

    const created = outcomes.filter((o) => o.httpStatus === 201 && !o.body.idempotentReplay).length;
    const replays = outcomes.filter((o) => o.httpStatus === 200 && o.body.idempotentReplay).length;
    const errors = outcomes.filter((o) => o.httpStatus >= 400 || o.httpStatus === 0).length;
    const uniqueTxIds = new Set(outcomes.map((o) => o.body.transactionId).filter(Boolean)).size;
    const distinctBalances = Array.from(
      new Set(outcomes.map((o) => o.body.balance?.amount).filter(Boolean)),
    );

    const reconciliation = await firstValueFrom(this.api.reconcileWallet(wallet.id));
    const updatedWallet = await firstValueFrom(this.api.getWallet(wallet.id));

    const passed =
      created === 1 &&
      replays === count - 1 &&
      errors === 0 &&
      uniqueTxIds === 1 &&
      reconciliation.consistent &&
      reconciliation.storedBalance.amount === '85.00';

    return {
      wallet: updatedWallet,
      report: {
        id: `idem-${tag}`,
        title: `Idempotência paralela (${count}x mesma aposta)`,
        walletId: wallet.id,
        passed,
        summary: passed
          ? `${created} criação (201) e ${replays} replays idempotentes (200). Saldo final 85.00 BRL com ${reconciliation.checkedEntries} lançamentos.`
          : `Criadas=${created}, replays=${replays}, erros=${errors}, saldo=${reconciliation.storedBalance.amount}.`,
        durationMs: Number((performance.now() - start).toFixed(1)),
        reconciliation,
        steps: [
          {
            label: `Disparo paralelo (${count} requisições)`,
            httpStatus: created > 0 ? 201 : outcomes[0]?.httpStatus ?? 0,
            status: `${created} NOVAS / ${replays} REPLAYS`,
            detail: `IDs únicos=${uniqueTxIds}, saldos retornados=[${distinctBalances.join(', ') || '-'}], erros=${errors}`,
          },
        ],
      },
    };
  }

  async runOutOfOrderRefund(): Promise<{ report: SimulationReport; wallet: WalletDto }> {
    const start = performance.now();
    const tag = this.uniqueTag();
    const wallet = await firstValueFrom(
      this.api.createWallet(`sim-ooo-${tag}`, { amount: '100.00', currency: 'BRL' }),
    );

    const betExternalId = `bet-ooo-${tag}`;
    const refundOutcome = await this.api.submitWager(`sim-prov:ref-${tag}`, {
      providerId: 'sim-prov',
      externalTransactionId: `ref-${tag}`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: `round-ooo-${tag}`,
      gameId: 'fortune-chimp',
      kind: 'REFUND',
      money: { amount: '30.00', currency: 'BRL' },
      referenceExternalTransactionId: betExternalId,
    });

    const betOutcome = await this.api.submitWager(`sim-prov:${betExternalId}`, {
      providerId: 'sim-prov',
      externalTransactionId: betExternalId,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: `round-ooo-${tag}`,
      gameId: 'fortune-chimp',
      kind: 'BET',
      money: { amount: '30.00', currency: 'BRL' },
    });

    let resolvedStatus: WagerStatus = refundOutcome.body.status ?? 'PENDING_REFERENCE';
    if (refundOutcome.body.transactionId) {
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 250));
        const detail = await firstValueFrom(
          this.api.getTransactionById(refundOutcome.body.transactionId),
        );
        resolvedStatus = detail.status;
        if (detail.status === 'PROCESSED' || detail.status === 'REJECTED') {
          break;
        }
      }
    }

    const reconciliation = await firstValueFrom(this.api.reconcileWallet(wallet.id));
    const updatedWallet = await firstValueFrom(this.api.getWallet(wallet.id));
    const passed =
      refundOutcome.httpStatus === 202 &&
      betOutcome.httpStatus === 201 &&
      resolvedStatus === 'PROCESSED' &&
      reconciliation.consistent &&
      reconciliation.storedBalance.amount === '100.00';

    return {
      wallet: updatedWallet,
      report: {
        id: `ooo-${tag}`,
        title: 'Entrega fora de ordem (REFUND antes da BET)',
        walletId: wallet.id,
        passed,
        summary: passed
          ? 'REFUND ficou em 202 PENDING_REFERENCE, BET debitou para 70.00 BRL e o worker concluiu o estorno para 100.00 BRL.'
          : `Status final do REFUND: ${resolvedStatus}.`,
        durationMs: Number((performance.now() - start).toFixed(1)),
        reconciliation,
        steps: [
          {
            label: '1. REFUND chega antes da BET',
            httpStatus: refundOutcome.httpStatus,
            status: refundOutcome.body.status ?? '-',
            detail: `Aguardando referência ${betExternalId}`,
          },
          {
            label: '2. BET chega em seguida',
            httpStatus: betOutcome.httpStatus,
            status: betOutcome.body.status ?? '-',
            detail: `Saldo após débito=${betOutcome.body.balance?.amount ?? '-'} BRL`,
          },
          {
            label: '3. Reprocessamento em background',
            httpStatus: 200,
            status: resolvedStatus,
            detail: `Saldo final=${reconciliation.storedBalance.amount} BRL (${reconciliation.checkedEntries} lançamentos verificados)`,
          },
        ],
      },
    };
  }
}
