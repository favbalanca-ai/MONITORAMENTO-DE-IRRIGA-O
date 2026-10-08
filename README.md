# Manejo de irrigação — Fazenda Água Viva

App que substitui a planilha de manejo: coleta a estação Ecowitt, calcula o balanço hídrico por pivô e manda a decisão do dia às 18h.
Contexto completo e especificação: [`docs/CONTEXT.md`](docs/CONTEXT.md).

## Estado

- [x] **Passo 1 — motor de cálculo** (`src/motor/`), validado contra a tabela da seção 7 do CONTEXT.md.
- [x] **Passo 2 — coletor Ecowitt** (`src/coletor/`): leitura ao vivo, normalização pelo `.unit`, deduplicação e recuperação de lacunas pelo histórico do ecowitt.net. Guarda em CSV por mês até decidirmos o banco.
- [ ] Banco · job das 18h · telas · importação do histórico da planilha · rodar em paralelo com a planilha.

## Como rodar

Precisa de Node 22.18+ (roda TypeScript direto, sem build).

```bash
npm install
npm run check              # typecheck + testes
npm run relatorio:exemplo  # tabela do Pivô 2 de exemplo
```

### Coletor

1. Copie `.env.example` para `.env` e preencha com as chaves **novas** da Ecowitt e o fuso da estação.
2. Teste: `npm run coletar` (uma leitura ao vivo, grava em `dados/leituras/AAAA-MM.csv`).
3. Recupere o período parado: `npm run coletar -- recuperar --de 2026-02-08 --ate 2026-10-08`.
4. Agende (crontab de exemplo; o host ainda não está decidido):

```cron
*/10 * * * *  cd /caminho/do/app && npm run -s coletar >> logs/coletor.log 2>&1
7 * * * *     cd /caminho/do/app && npm run -s coletar -- recuperar --dias 2 >> logs/coletor.log 2>&1
```

O histórico do ecowitt.net guarda leituras de 5 min por ~90 dias e de 30 min por ~1 ano; o coletor escolhe o ciclo pela idade do buraco. Leituras de 30 min contam como 3 no mínimo de leituras do dia, então um dia recuperado inteiro não cai em "SEM DADOS".

## Estrutura

```
src/motor/        cálculo puro, sem rede nem banco
  tipos.ts          modelo de dados (pivô, solo, cultura, equipamento, leituras)
  unidades.ts       normalização de unidades pelo .unit da Ecowitt
  agregacao.ts      leituras → dia (janela 18h–18h, regra da chuva, radiação por média)
  et0.ts            Penman-Monteith FAO-56 e Hargreaves-Samani (conferência)
  cultura.ts        DAS, estádio, Kc (soja) e palhada
  solo.ts           raiz, CAD, fator de depleção, déficit por umidade medida
  equipamento.ts    área, volta, lâmina, percentímetro, energia e custo
  balanco.ts        balanço diário, decisão e alertas
src/coletor/      coleta da estação
  ecowitt.ts        cliente da API v3 (tempo real e histórico) e conversão para leituras
  coleta.ts         leitura ao vivo sem duplicar; recuperação de lacunas
  lacunas.ts        onde faltam leituras
  repositorio.ts    armazenamento (CSV por mês por enquanto)
  tempo.ts / config.ts   fuso da estação; configuração do .env
scripts/          linha de comando (coletar, relatório de exemplo)
test/             testes (node:test) e fixtures
  fixtures/         20 dias agregados + leituras brutas do METEO corrigido
docs/             CONTEXT.md e o Apps Script antigo (referência)
```

## Segurança

Chaves da Ecowitt vão em `.env` (fora do git, ver `.env.example`). As planilhas `.xlsx` originais **não** são versionadas porque têm chaves em texto — gere chaves novas na Ecowitt.
