# Manejo de irrigação — Fazenda Água Viva

App que substitui a planilha de manejo: coleta a estação Ecowitt, calcula o balanço hídrico por pivô e manda a decisão do dia às 18h.
Contexto completo e especificação: [`docs/CONTEXT.md`](docs/CONTEXT.md).

## Estado

- [x] **Passo 1 — motor de cálculo** (`src/motor/`), validado contra a tabela da seção 7 do CONTEXT.md.
- [ ] Coletor Ecowitt · banco · job das 18h · telas · importação do histórico · rodar em paralelo com a planilha.

## Como rodar

Precisa de Node 22.18+ (roda TypeScript direto, sem build).

```bash
npm install
npm run check              # typecheck + testes
npm run relatorio:exemplo  # tabela do Pivô 2 de exemplo
```

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
test/             testes (node:test) e fixtures
  fixtures/         20 dias agregados + leituras brutas do METEO corrigido
docs/             CONTEXT.md e o Apps Script antigo (referência)
```

## Segurança

Chaves da Ecowitt vão em `.env` (fora do git, ver `.env.example`). As planilhas `.xlsx` originais **não** são versionadas porque têm chaves em texto — gere chaves novas na Ecowitt.
