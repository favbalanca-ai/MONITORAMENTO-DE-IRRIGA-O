# Planilha e ponte com o app (Apps Script)

Tudo roda no Google, sem servidor nem PC ligado: a planilha guarda os dados e o Apps Script coleta a estação, calcula e manda o relatório.

## Instalar (uma vez, ~10 min)

1. No Google Drive da conta que vai ser dona do sistema, crie uma pasta (ex.: `05_MANEJO_IRRIGACAO_APP`) e, dentro dela, uma planilha em branco (ex.: `MANEJO_IRRIGACAO`).
2. Na planilha: **Extensões → Apps Script**.
3. No editor:
   - Apague o conteúdo do `Código.gs` que vem pronto e cole o conteúdo de [`Code.gs`](Code.gs).
   - Clique em **+ → Script**, chame de `Motor` e cole o conteúdo de [`Motor.gs`](Motor.gs).
   - Em **Configurações do projeto** (engrenagem), marque "Mostrar o arquivo de manifesto appsscript.json" e cole o conteúdo de [`appsscript.json`](appsscript.json) no arquivo que aparecer.
   - Salve (ícone de disquete).
4. Volte para a planilha e recarregue a página. Vai aparecer o menu **💧 Manejo**.
5. **💧 Manejo → 1. Instalar / atualizar**. O Google vai pedir autorização (planilha, Drive, e-mail, acesso à internet para a Ecowitt). Aceite. Isso cria as abas, as pastas `BACKUP` e `RELATORIOS` ao lado da planilha e os gatilhos.
6. **💧 Manejo → 2. Configurar chaves Ecowitt**: cole as chaves **novas** (as antigas ficaram expostas na planilha MASTER). Elas ficam guardadas nas propriedades do script, não aparecem na planilha nem nos backups.
7. Revise as abas:
   - **FAZENDAS**: uma linha por fazenda (criada no Instalar a partir da antiga ESTACAO). Em cada linha: nome, **MAC da
     estação Ecowitt** (vazio = fazenda sem estação: o clima do ciclo vem do Open-Meteo), latitude, **longitude**,
     altitude, altura do anemômetro, fuso (Mato Grosso = `America/Cuiaba`), **e-mails do relatório**, o **código IBGE
     do município** (Formoso-MG = 3126208) para a previsão do INMET, chuva mínima e horário de ponta. Para uma segunda
     fazenda (ex.: Novo Pago) basta acrescentar a linha; cada fazenda tem a sua coleta, previsão, PAINEL e relatório.
   - **RESERVATORIOS** (também pelo app, em Pivôs → Fontes de água → **+ Novo piscinão**): um piscinão por linha — fazenda, nome, **volume útil (m³)**, **bomba de reposição (m³/h)**,
     **horas de bomba por dia** e **reserva mínima (m³)**. Na PIVOS, a coluna **Fonte de água** liga o pivô ao
     piscinão (vazio = abastecimento direto do rio/poço). O operador lança o **nível (%)** pelo app (Lançar → Nível
     do piscinão; aba `NIVEL RESERVATORIO`), de preferência no fim do dia. A planilha estima o volume de hoje
     (nível lançado + bomba × dias − o que os pivôs ligados puxaram, lâmina ÷ eficiência × área), o consumo diário
     dos pivôs (ETc), se o que tem cobre a irrigação de hoje e **pra quantos dias de irrigação dá** com a reposição.
     Vai no relatório, no PAINEL e num cartão na tela Hoje.
   - **PIVOS** tem as colunas **Fazenda** e **Tipo (pivô/talhão)**. Um *talhão* é área sem pivô: não entra no balanço
     hídrico, só ganha o **relatório do ciclo da cultura** (graus-dia, fotoperíodo, horas de sol, chuva, ET₀, extremos).
   - **PIVOS**: uma linha por pivô. A linha do Pivô 2 é **exemplo** — troque pelos dados reais (plantio, solo, equipamento).
     Na coluna **Cultura** vale `soja`, `soja precoce`, `milho`, `sorgo`, `feijao`, `feijao pd`, `trigo` ou `algodao` (ver `docs/CULTURAS.md`).
     A coluna **Ciclo (dias, vazio = padrão)** é opcional: preenchida, estica/encurta a curva de Kc para a cultivar plantada.
   - Ainda na FAZENDAS: **Chuva mínima que conta** (padrão 2 mm — chuva menor fica na folha) e o **horário de ponta**
     da energia (padrão 18–21 h), usado no custo e na hora sugerida de ligar o pivô.
   - Colunas opcionais da PIVOS: **Tarifa na ponta** (R$/kWh; preenchida, o app mostra "ligar às 21:00" e o custo nas
     duas tarifas) e **Graus-dia do ciclo** da cultivar (preenchido, o estádio anda pela soma térmica, não por dias).
   - **LEITURAS** ganhou a coluna **Extras (JSON)**: tudo o mais que a estação manda em cada coleta (UV, rajada, direção,
     pressão, orvalho, sensores de solo, raios…), já em unidades SI. Coluna opcional da PIVOS **Sensor de solo da
     estação (canal 1-8)** liga um sensor WH51 ao pivô: aparece no cartão (só informativo, não entra no balanço).
   - O **relatório das 18h** vai por e-mail em texto (cabe no WhatsApp) e em HTML (cores do semáforo, tabelinha por
     pivô): resumo do dia (pivôs em cada estado, água em m³, energia e custo), clima da janela, previsão, e por pivô
     déficit × AFD × lâmina mínima, ajuste do pivô, hora de ligar, próxima irrigação, última irrigação/medição,
     o déficit dos últimos 7 dias e, por pivô ou talhão, o ciclo da cultura (graus-dia acumulados e % do ciclo,
     fotoperíodo e horas de sol, chuva e ET₀ do ciclo, dias quentes/frios). Com mais de uma fazenda, sai um
     relatório por fazenda para os e-mails dela. O mesmo relatório vai em **PDF** anexo ao e-mail e fica em `RELATORIOS/AAAA-MM-DD.pdf`
     (também pelo menu **📄 Relatório de hoje em PDF** e pelo botão PDF do app).
   - **PREVISAO** é preenchida sozinha a cada 3 h (gatilho `atualizarPrevisao`) ou pelo menu **🌧 Atualizar previsão do tempo**:
     mm e probabilidade do Open-Meteo (pela latitude/longitude) e o texto do INMET (pelo município). A previsão
     só avisa — não entra no balanço.
8. Teste: **Coletar leitura agora** (mostra a leitura na tela e grava em LEITURAS; se der erro, mostra o motivo — use **Testar conexão Ecowitt** para ver o que a estação responde) e **Calcular agora (sem enviar)** (veja o PAINEL).
9. Para trazer o histórico: **Recuperar buracos (período)** a partir de 08/02/2026, e/ou **Importar METEO de outra planilha** com o link da `MANEJO_IRRIGACAO_MASTER`.

## Ligar o app do celular (GitHub Pages)

O app fica em `https://favbalanca-ai.github.io/MONITORAMENTO-DE-IRRIGA-O/` (ver `app/README.md`) e conversa com
esta planilha pelo Apps Script, igual ao Planejamento.

1. No editor do Apps Script: **Implantar → Nova implantação** → engrenagem → **App da Web**:
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa** (quem protege é o login com PIN)
   - **Implantar** e autorize. Copie o endereço que termina em **/exec** (também aparece em **💧 Manejo → 📱 Endereço para o app**).
   - **Nunca** coloque esse endereço no GitHub.
2. **💧 Manejo → 👤 Criar administrador do app**: nome, login e PIN (4 a 6 números).
3. No celular, abra o app, toque em **⚙️ Ajustes**, cole o endereço /exec, **Salvar** e entre com o login e PIN.
4. Para virar ícone: Chrome → menu ⋮ → **Adicionar à tela inicial** · iPhone (Safari) → Compartilhar → **Adicionar à Tela de Início**.
5. Outras pessoas: o administrador cria em **Ajustes → 👥 Usuários** (Operador vê e lança; Administrador também edita pivôs e usuários).
   Com mais de uma fazenda, marque no usuário **quais fazendas ele vê** (coluna FAZENDAS da aba `USUÁRIOS APP`; vazio = todas).

Toda vez que o `Code.gs` ou o `Motor.gs` mudar: cole os arquivos e vá em **Implantar → Gerenciar implantações → lápis →
Versão: Nova versão → Implantar**. O endereço /exec continua o mesmo.

### Como a ponte funciona (técnico)

- `doGet ?acao=dados` devolve resumo do dia, cadastro, últimos lançamentos e um `hash`; `?acao=hash` só o hash (o app
  baixa tudo apenas quando ele muda); `?acao=historico&pivo=&dias=`; `?acao=usuarios` (admin). Sessão em `&s=`.
- `doPost` (corpo JSON em `text/plain`, um tipo por pedido, sessão em `s`): `__login {login, pin}`,
  `__lancamento {id, tipo: irrigacao|umidade, pivo, data, …}` (mesmo id = regrava, não duplica), `__apagar {id}`,
  `__recalcular`, `__pivo {dados, original}` (admin), `__usuario {salvar|excluir}` (admin), `__trocarPin {atual, novo}`.
  Toda gravação usa trava (`LockService`); planilha ocupada responde `{ocupado:true}` e o app tenta de novo.
- Abas criadas sozinhas: **USUÁRIOS APP** (NOME · LOGIN · PERFIL · PIN NOVO · PIN · ATIVO · VERSÃO · ÚLTIMO ACESSO) e
  **CONFIG APP** (`EXIGIR LOGIN` = SIM). Um PIN digitado em PIN NOVO vira hash no primeiro login e some da planilha.
  Trocar PIN, desativar ou mudar perfil derruba as sessões antigas daquela pessoa. 5 PINs errados bloqueiam por 10 min.
- IRRIGACOES e UMIDADE ganham as colunas **Por** (quem lançou) e **ID**. Lançamentos digitados à mão na planilha ganham ID
  na próxima leitura do app.

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
