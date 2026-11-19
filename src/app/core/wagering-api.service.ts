import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, firstValueFrom, map, of } from 'rxjs';
import {
  HealthLiveDto,
  HealthReadyDto,
  LedgerPageDto,
  MetricsSnapshotDto,
  MoneyDto,
  ReconciliationDto,
  SubmitWagerPayload,
  WagerCallOutcome,
  WagerTransactionDetailDto,
  WagerTransactionResultDto,
  WalletDto,
} from './wagering-api.models';

@Injectable({ providedIn: 'root' })
export class WageringApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api';

  createWallet(playerId: string, initialBalance: MoneyDto): Observable<WalletDto> {
    return this.http.post<WalletDto>(`${this.baseUrl}/wallets`, {
      playerId,
      initialBalance,
    });
  }

  getWallet(walletId: string): Observable<WalletDto> {
    return this.http.get<WalletDto>(`${this.baseUrl}/wallets/${walletId}`);
  }

  getLedger(walletId: string, cursor?: string | null, limit = 15): Observable<LedgerPageDto> {
    const params: Record<string, string> = { limit: String(limit) };
    if (cursor) {
      params['cursor'] = cursor;
    }
    return this.http.get<LedgerPageDto>(`${this.baseUrl}/wallets/${walletId}/ledger`, { params });
  }

  reconcileWallet(walletId: string): Observable<ReconciliationDto> {
    return this.http.post<ReconciliationDto>(`${this.baseUrl}/wallets/${walletId}/reconciliation`, {});
  }

  getTransactionById(transactionId: string): Observable<WagerTransactionDetailDto> {
    return this.http.get<WagerTransactionDetailDto>(
      `${this.baseUrl}/wagering/transactions/${transactionId}`,
    );
  }

  getTransactionByExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Observable<WagerTransactionDetailDto> {
    return this.http.get<WagerTransactionDetailDto>(
      `${this.baseUrl}/providers/${encodeURIComponent(providerId)}/wagering/transactions/${encodeURIComponent(externalTransactionId)}`,
    );
  }

  async submitWager(
    idempotencyKey: string,
    payload: SubmitWagerPayload,
  ): Promise<WagerCallOutcome> {
    const start = performance.now();
    const headers = new HttpHeaders({
      'Idempotency-Key': idempotencyKey,
    });

    return firstValueFrom(
      this.http
        .post<WagerTransactionResultDto>(`${this.baseUrl}/wagering/transactions`, payload, {
          headers,
          observe: 'response',
        })
        .pipe(
          map((res) => ({
            httpStatus: res.status,
            ok: true,
            durationMs: Number((performance.now() - start).toFixed(1)),
            idempotencyKey,
            payload,
            body: res.body ?? {},
          })),
          catchError((err: HttpErrorResponse) =>
            of({
              httpStatus: err.status || 0,
              ok: false,
              durationMs: Number((performance.now() - start).toFixed(1)),
              idempotencyKey,
              payload,
              body:
                err.error && typeof err.error === 'object'
                  ? (err.error as WagerTransactionResultDto)
                  : { error: 'HTTP_ERROR', message: err.message },
            }),
          ),
        ),
    );
  }

  getHealthLive(): Observable<HealthLiveDto> {
    return this.http.get<HealthLiveDto>(`${this.baseUrl}/health/live`);
  }

  getHealthReady(): Observable<HealthReadyDto> {
    return this.http
      .get<HealthReadyDto>(`${this.baseUrl}/health/ready`, { observe: 'response' })
      .pipe(
        map((res) => res.body ?? { status: 'down', checks: { postgres: 'down', sqs: 'down' } }),
        catchError((err: HttpErrorResponse) =>
          of(
            (err.error as HealthReadyDto) ?? {
              status: 'unreachable',
              checks: { postgres: 'down', sqs: 'down' },
            },
          ),
        ),
      );
  }

  getMetrics(): Observable<MetricsSnapshotDto> {
    return this.http.get<MetricsSnapshotDto>(`${this.baseUrl}/metrics/json`);
  }
}
