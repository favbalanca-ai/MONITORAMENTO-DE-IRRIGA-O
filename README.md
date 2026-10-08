# Manejo de irrigação — Fazenda Água Viva

> **Versão em uso: Google Sheets + Apps Script** — ver [`apps-script/LEIA-ME.md`](apps-script/LEIA-ME.md).
> O motor de cálculo em `src/` é o mesmo nas duas versões (o `apps-script/Motor.gs` é gerado dele e testado no Node).

App que substitui a planilha de manejo: coleta a estação Ecowitt, calcula o balanço hídrico por pivô e manda a decisão do dia às 18h.
Contexto completo e especificação: [`docs/CONTEXT.md`](docs/CONTEXT.md).

## Estado

- [x] **Passo 1 — motor de cálculo** (`src/motor/`), validado contra a tabela da seção 7 do CONTEXT.md.
- [x] **Passo 2 — coletor Ecowitt** (`src/coletor/`): leitura ao vivo, normalização pelo `.unit`, deduplicação e recuperação de lacunas pelo histórico do ecowitt.net.
- [x] **Passos 3 e 4 — banco e job das 18h** (`src/banco/`, `src/job/`): SQLite embutido no Node, cadastro, lançamentos, balanço diário gravado e relatório por console, arquivo e e-mail.
- [x] **Versão Google Sheets** (`apps-script/`): mesma lógica rodando na planilha, com gatilhos, e-mail e backup no Drive. Testada no Node com uma imitação do Apps Script.
- [x] **App no celular** (`apps-script/App.gs` + `App.html`): telas Hoje, Lançar, Histórico e Pivôs, publicado como app da Web do próprio script. Testado no Chromium com a planilha simulada.
- [ ] WhatsApp (falta escolher o provedor) · telas · importação do histórico da planilha · rodar em paralelo com a planilha.

## Como rodar

Precisa de Node 22.18+ (roda TypeScript direto, sem build). O banco é SQLite embutido no Node: nada para instalar.

```bash
npm install
npm run check              # typecheck + testes
```

### Primeira vez

1. `cp .env.example .env` e preencha: chaves **novas** da Ecowitt, fuso da estação e, se quiser e-mail, o SMTP.
2. `cp config/fazenda.exemplo.json config/fazenda.json`, troque pelos valores reais e grave:
   `npm run banco -- cadastro config/fazenda.json` (pode rodar de novo sempre que mudar algo; atualiza pelo nome do pivô).
3. Teste a coleta: `npm run coletar`.
4. Recupere o período parado: `npm run coletar -- recuperar --de 2026-02-08 --ate 2026-10-08`.
5. Veja o relatório sem enviar: `npm run diario -- --sem-envio`.
6. Deixe rodando: `npm run servico` (coleta a cada 10 min, tapa buracos 1x por hora, relatório às 18:10).
   Para ficar sempre ligado e voltar sozinho depois de queda de energia: `pm2 start "npm run servico" --name manejo && pm2 save && pm2 startup` (Linux/Windows) ou um serviço do systemd.

### No dia a dia

```bash
npm run banco -- irrigacao "Pivô 2" 2026-10-08 12        # lâmina líquida aplicada (mm)
npm run banco -- umidade "Pivô 2" 2026-10-08 28 --profunda 30 --tensao -40 --fonte TDR
npm run diario -- --data 2026-10-08 --forcar             # recalcula e reenvia um dia
```

O relatório recalcula o balanço inteiro toda vez, então lançar uma irrigação ou medição atrasada corrige os dias seguintes automaticamente.

### Regras do job

- Dia do relatório = último dia com a janela 18h–18h fechada. Rodando antes das 18h, sai o de ontem.
- Dia sem leitura nenhuma (ou sensor sem dado) usa o clima do dia válido mais próximo, com chuva 0, e a decisão sai "SEM DADOS". O relatório avisa quantos dias do balanço foram assim.
- Cada canal recebe o relatório uma vez por dia; canal que falhou tenta de novo na próxima execução. `--forcar` reenvia.
- Antes do relatório, o serviço tenta recuperar buracos do dia pelo histórico da Ecowitt.
- O histórico do ecowitt.net guarda leituras de 5 min por ~90 dias e de 30 min por ~1 ano. Leituras de 30 min contam como 3 no mínimo de leituras do dia.

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
src/banco/        SQLite: esquema/migrações, leituras, cadastro, lançamentos, resultados
src/job/          relatório do dia: cálculo de todos os pivôs, mensagem, envio, agenda
src/coletor/      coleta da estação
  ecowitt.ts        cliente da API v3 (tempo real e histórico) e conversão para leituras
  coleta.ts         leitura ao vivo sem duplicar; recuperação de lacunas
  lacunas.ts        onde faltam leituras
  repositorio.ts    interface de armazenamento (+ CSV, para importar coletas antigas)
  tempo.ts / config.ts   fuso da estação; configuração do .env
apps-script/      versão Google Sheets: Codigo.gs (planilha, gatilhos, e-mail, Drive) + Motor.gs (gerado)
config/           cadastro da fazenda (fazenda.exemplo.json → fazenda.json)
scripts/          linha de comando: coletar, banco, diario, servico
test/             testes (node:test) e fixtures
  fixtures/         20 dias agregados + leituras brutas do METEO corrigido
docs/             CONTEXT.md e o Apps Script antigo (referência)
```

## Segurança

Chaves da Ecowitt vão em `.env` (fora do git, ver `.env.example`). As planilhas `.xlsx` originais **não** são versionadas porque têm chaves em texto — gere chaves novas na Ecowitt.
