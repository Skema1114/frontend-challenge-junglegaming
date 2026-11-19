export type WagerKind = 'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'ROLLBACK';
export type WagerStatus = 'PENDING' | 'PENDING_REFERENCE' | 'PROCESSED' | 'REJECTED' | 'FAILED';
export type LedgerDirection = 'DEBIT' | 'CREDIT';

export interface MoneyDto {
  amount: string;
  currency: string;
}

export interface WalletDto {
  id: string;
  playerId: string;
  balance: MoneyDto;
  version: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface LedgerEntryDto {
  id: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyDto;
  balanceBefore: MoneyDto;
  balanceAfter: MoneyDto;
  createdAt: string;
}

export interface LedgerPageDto {
  walletId: string;
  items: LedgerEntryDto[];
  nextCursor: string | null;
}

export interface ReconciliationDto {
  walletId: string;
  storedBalance: MoneyDto;
  calculatedBalance: MoneyDto;
  difference: MoneyDto;
  consistent: boolean;
  checkedEntries: number;
}

export interface SubmitWagerPayload {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerKind;
  money: MoneyDto;
  referenceExternalTransactionId?: string;
}

export interface WagerTransactionResultDto {
  transactionId?: string;
  status?: WagerStatus;
  balance?: MoneyDto;
  failureCode?: string;
  idempotentReplay?: boolean;
  error?: string;
  message?: string;
}

export interface WagerCallOutcome {
  httpStatus: number;
  ok: boolean;
  durationMs: number;
  idempotencyKey: string;
  payload: SubmitWagerPayload;
  body: WagerTransactionResultDto;
}

export interface WagerTransactionDetailDto {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: MoneyDto;
  status: WagerStatus;
  referenceExternalTransactionId?: string;
  referenceTransactionId?: string;
  failureCode?: string;
  balance?: MoneyDto;
  createdAt: string;
  processedAt?: string;
}

export interface HealthLiveDto {
  status: string;
  instanceId: string;
  uptimeSec: number;
}

export interface HealthReadyDto {
  status: string;
  checks: {
    postgres: string;
    sqs: string;
  };
}

export interface MetricsSnapshotDto {
  transactionsByStatus: Record<string, number>;
  duplicatesDetected: number;
  retries: number;
  dlqMessages: number;
  lockConflicts: number;
  reconciliationDivergences: number;
  outboxLagMs: number;
  outboxPendingCount: number;
  latency: {
    count: number;
    avgMs: number;
    maxMs: number;
  };
}
