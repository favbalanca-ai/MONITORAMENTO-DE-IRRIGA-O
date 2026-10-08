# Manejo de irrigação no Google Sheets

Tudo roda no Google, sem servidor nem PC ligado: a planilha guarda os dados e o Apps Script coleta a estação, calcula e manda o relatório.

## Instalar (uma vez, ~10 min)

1. No Google Drive da conta que vai ser dona do sistema, crie uma pasta (ex.: `05_MANEJO_IRRIGACAO_APP`) e, dentro dela, uma planilha em branco (ex.: `MANEJO_IRRIGACAO`).
2. Na planilha: **Extensões → Apps Script**.
3. No editor:
   - Apague o conteúdo do `Código.gs` que vem pronto e cole o conteúdo de [`Codigo.gs`](Codigo.gs).
   - Clique em **+ → Script**, chame de `Motor` e cole o conteúdo de [`Motor.gs`](Motor.gs).
   - Em **Configurações do projeto** (engrenagem), marque "Mostrar o arquivo de manifesto appsscript.json" e cole o conteúdo de [`appsscript.json`](appsscript.json) no arquivo que aparecer.
   - Salve (ícone de disquete).
4. Volte para a planilha e recarregue a página. Vai aparecer o menu **💧 Manejo**.
5. **💧 Manejo → 1. Instalar / atualizar**. O Google vai pedir autorização (planilha, Drive, e-mail, acesso à internet para a Ecowitt). Aceite. Isso cria as abas, as pastas `BACKUP` e `RELATORIOS` ao lado da planilha e os gatilhos.
6. **💧 Manejo → 2. Configurar chaves Ecowitt**: cole as chaves **novas** (as antigas ficaram expostas na planilha MASTER). Elas ficam guardadas nas propriedades do script, não aparecem na planilha nem nos backups.
7. Revise as abas:
   - **ESTACAO**: latitude, altitude, altura do anemômetro, fuso (Mato Grosso = `America/Cuiaba`) e **e-mails do relatório**.
   - **PIVOS**: uma linha por pivô. A linha do Pivô 2 é **exemplo** — troque pelos dados reais (plantio, solo, equipamento).
8. Teste: **Coletar leitura agora** (deve aparecer uma linha em LEITURAS) e **Calcular agora (sem enviar)** (veja o PAINEL).
9. Para trazer o histórico: **Recuperar buracos (período)** a partir de 08/02/2026, e/ou **Importar METEO de outra planilha** com o link da `MANEJO_IRRIGACAO_MASTER`.

## O que roda sozinho

| Quando | O quê |
|---|---|
| a cada 10 min | lê a estação (aba LEITURAS) |
| de hora em hora | busca no histórico da Ecowitt o que faltou nas últimas 48 h |
| ~18:05–18:35 | tapa buracos do dia, calcula todos os pivôs ativos, atualiza PAINEL/BALANCO/CLIMA, salva o relatório em `RELATORIOS/AAAA-MM-DD.txt` e manda o e-mail |
| 4h | cópia da planilha em `BACKUP` (guarda as 30 mais novas) |

Se o relatório falhar, chega um e-mail "⚠️ Manejo: relatório não saiu" com o motivo. Tudo fica registrado na aba **LOG**.

## No dia a dia

- **IRRIGACOES**: data, pivô, lâmina líquida aplicada (mm).
- **UMIDADE**: data, pivô, umidade na raiz (%), camada profunda (%), tensão (kPa), fonte. A medição substitui o déficit calculado daquele dia.
- Lançou algo atrasado? **Enviar relatório agora** recalcula tudo e reenvia.

## Atualizar o cálculo

`Motor.gs` é gerado a partir do código testado em `src/` (`npm run gerar:apps-script`). Não edite à mão: mude o TypeScript, rode `npm run check` e cole o `Motor.gs` novo no editor.
