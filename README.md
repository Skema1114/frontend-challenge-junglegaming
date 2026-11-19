# Painel de apostas (Angular 18 + PrimeNG)

Interface web para operar e testar manualmente a API do `backend-challenge-junglegaming` sem precisar montar requisições `curl` na mão.

O painel permite criar e buscar carteiras, reconciliar o saldo com o ledger e enviar transações (`BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`), incluindo replay com a mesma `Idempotency-Key` e conflito `409` com payload alterado. Também traz paginação por cursor do ledger, métricas da API, alternância entre tema escuro (`lara-dark-blue`) e claro (`lara-light-blue`) na barra superior e três simulações automáticas de concorrência e entrega fora de ordem.

## Como rodar

Suba o back-end em `http://localhost:3100` com PostgreSQL e LocalStack ativos, depois rode o servidor Angular na pasta deste projeto:

```bash
npm install
npm start
```

O `proxy.conf.json` redireciona `/api/*` para `http://localhost:3100/*`, então basta abrir `http://localhost:4200`.

## Scripts úteis

```bash
npm start      # servidor de desenvolvimento com proxy /api -> localhost:3100
npm run build  # build de produção em dist/wagering-ops-console
```
