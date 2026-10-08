# App de manejo de irrigação — Fazenda Água Viva

Documento de passagem da conversa no Claude (chat) para o Claude Code. Leia inteiro antes de escrever código.
O dono fala português do Brasil, informal. Responda assim. Prefere orientação direta, passo a passo e prática.

## 1. Objetivo
Substituir a planilha atual de manejo por um **app próprio**: coleta a estação Ecowitt, calcula o balanço hídrico por pivô e manda a decisão **todo dia às 18h** (quanto irrigar, percentímetro, tempo da volta, custo de energia) por WhatsApp ou e-mail.
A fazenda tem **9 pivôs** e **uma estação meteorológica** (a ET₀ e a chuva são iguais para todos; cultura, plantio, solo e equipamento são por pivô).
Começar pelo **Pivô 2** (soja, estádio R3 nos dados de exemplo) e deixar pronto para os outros 8.

## 2. Arquivos deste pacote
| Arquivo | O que é |
|---|---|
| `prototipo_manejo.html` | Protótipo visual de página única (HTML + JS puro) com toda a lógica de cálculo em JavaScript. É a **referência de comportamento**, não o código final. |
| `dados_pivo2_exemplo.json` | 20 dias reais da estação (20/01 a 08/02/2026), já agregados na janela 18h–18h. |
| `Irrigacao_Pivo2_original.xlsx` | Planilha original (abas METEO, DIARIO, IRRIGACAO, KC, CONFIG, CONFIG_PIVO). **Contém chaves da API da Ecowitt em texto** (ver seção 9). |
| `Irrigacao_Pivo2_corrigido.xlsx` | Mesma planilha com as fórmulas da aba DIARIO corrigidas e o METEO limpo. |
| `apps_script_original.txt` | Google Apps Script atual (backup, importação Ecowitt, ET₀, relatório por e-mail). |

## 3. Dados da estação (Ecowitt)
- API: `GET https://api.ecowitt.net/api/v3/device/real_time?application_key=...&api_key=...&mac=...`
- Campos usados: `outdoor.temperature`, `outdoor.humidity`, `solar_and_uvi.solar` (W/m²), `rainfall.daily`, `wind.wind_speed`. Todos vêm com `.value` e `.unit`.
- Leitura a cada ~10 min, ~144 por dia. A planilha tem 2.834 leituras (19/01 a 08/02/2026). **A coleta parou em 08/02.**
- Colunas do METEO: Data, Chuva_mm, Temp_C, UR_%, Rad_Wm2, Vento_ms, Fonte.

### Armadilhas dos dados (todas já aconteceram)
1. **Unidades misturadas**: duas leituras de temperatura vieram em °F (75,9 e 66,2) e sete de radiação em W/m² numa coluna que depois passou a guardar MJ/m² por leitura. Normalizar **na entrada**, olhando o `.unit` da API.
2. **Chuva é acumulada do dia e zera à meia-noite.** Numa janela 18h–18h, a chuva é: (máximo − mínimo da noite anterior) + máximo de hoje até 18h. O script original multiplica por 25,4 assumindo polegadas; os dados mostram múltiplos de 0,254, então a conversão faz sentido, mas confirme pelo `.unit`.
3. **Leituras irregulares**: há dias com 60 e outros com 183 leituras (repetidas ou faltando). Radiação diária = média por leitura × 144, nunca a soma.
4. **Células de texto** no METEO (um `'75.9'` virou texto e foi ignorado por AVERAGEIFS). Validar tipos.
5. Dias com menos de **100 leituras** na janela: decisão bloqueada ("SEM DADOS"). Radiação < 1 MJ no dia (20/01) é suspeita.

## 4. Bugs da planilha original (para não repetir)
1. Lâmina aplicada descontada **duas vezes** no déficit (coluna K e coluna M).
2. Déficit acumulado **sem piso em zero**: chegou a −52 mm depois de uma chuva e nunca mais mandou irrigar.
3. Janelas diferentes por coluna: radiação e irrigação de 0h a 24h; temperatura, umidade, vento e chuva de 18h a 18h do dia seguinte (o futuro).
4. Chuva por `MAXIFS` na janela 18h–18h: perde metade, porque o acumulado zera à meia-noite.
5. ET₀ simplificada (`0,408·Rs·(T+17)/100 + 0,063·u·(1−UR/100)`), que **subestima cerca de 25%** frente à Penman-Monteith nos dias bons.
6. Limite de decisão fixo em 5 mm no código.
7. `CONFIG!B4` está como LAT = −14738634 (faltou a vírgula; é −14,738634), mas o Apps Script lê `B4` como **altitude** e `B5/B6` como lat/lon. O script e a planilha são de versões diferentes. O script procura abas de pivô com dados a partir da linha 18.

## 5. Modelo de cálculo (especificação)
Janela do dia D: de **18:00 de D−1 até 18:00 de D**. Uma linha por dia por pivô.

### 5.1 Agregação diária (estação)
Tmax, Tmin, Tmed (média das leituras), UR média, vento médio, radiação (MJ/m²/dia = média por leitura × 144), chuva (regra da seção 3), nº de leituras.

### 5.2 ET₀ — Penman-Monteith FAO-56 (padrão)
- P = 101,3·((293 − 0,0065·z)/293)^5,26 ; γ = 0,000665·P
- es = (e°(Tmax)+e°(Tmin))/2 ; ea = UR/100 · es ; Δ = 4098·e°(Tmed)/(Tmed+237,3)²
- u2 = u·4,87/ln(67,8·h − 5,42), com h = altura do anemômetro (m)
- Ra por latitude e dia do ano ; Rso = (0,75 + 2e-5·z)·Ra ; razão Rs/Rso limitada entre 0,3 e 1
- Rns = 0,77·Rs ; Rnl = 4,903e-9·((Tmax+273,16)⁴+(Tmin+273,16)⁴)/2·(0,34 − 0,14·√ea)·(1,35·razão − 0,35) ; Rn = Rns − Rnl ; G = 0
- ET₀ = (0,408·Δ·Rn + γ·900/(Tmed+273)·u2·(es−ea)) / (Δ + γ·(1+0,34·u2))
- **Conferência**: Hargreaves-Samani, ET₀ = 0,0023·0,408·Ra·(Tmed+17,8)·√(Tmax−Tmin). Avisar quando divergir mais de 35%.
- Parâmetros da estação (valores de exemplo, **confirmar**): latitude −14,74 (da planilha), altitude 900 m (estimada), anemômetro a 2 m (não se sabe).

### 5.3 Cultura, estádio e Kc
- DAS = data − data de plantio. Fração do ciclo f = DAS / ciclo. O estádio vem da fração.
- Soja (ciclo 120): V1 até 0,17 → Kc 0,45 · V3 até 0,30 → 0,75 · R1 até 0,46 → 1,05 · R3 até 0,63 → 1,15 · R5 até 0,83 → 1,20 · R7 até 1,00 → 0,90 (os mesmos Kc da aba KC da planilha).
- Milho (140 dias) e feijão (90 dias) têm tabelas de exemplo no protótipo. **Todas são valores de referência para o agrônomo validar.**
- Plantio direto sobre palhada: Kc do primeiro estádio × 0,5 (Embrapa Milho e Sorgo; vale para o milho, aplicado por analogia).
- ETc = ET₀ × Kc.

### 5.4 Solo
- Raiz cresce em linha reta de `zIni` no plantio até `z` em `diasRaiz` dias.
- CAD (mm) = (CC − PMP)/100 · z(cm) · 10 ; AFD = CAD · f
- Fator de depleção **variável pela ET₀ do dia** (Embrapa): ≤2,5 → 0,75 · ≤5 → 0,60 · ≤7,5 → 0,50 · >7,5 → 0,40. Opção de fator fixo.
- Déficit de uma umidade medida θ: (CC − θ)/100 · z · 10.

### 5.5 Balanço e decisão
```
déficit_0  = déficit(umidade inicial)
déficit_d  = max(0, déficit_{d-1} + ETc_d − chuva_d − irrigação_d)
se houve medição de umidade no dia d: déficit_d = déficit(θ medida)   (ajuste)
decisão    = SEM DADOS se leituras < 100; IRRIGAR se déficit_d ≥ lâmina mínima; senão NÃO IRRIGAR
```
Alertas: déficit ≥ AFD (risco de estresse); camada profunda ≥ CC (percolação) ou muito seca; última medição há mais de 15 dias; tensiômetro com tensão ≤ −70 kPa (verão do Cerrado; −300 kPa no inverno); lâmina mínima abaixo do que o pivô aplica a 100%.

### 5.6 Equipamento
- área (ha) = π·R²·(ângulo/360)/10000
- tempo da volta a 100% (h) = (ângulo/360)·2π·R / (velocidade da última torre em m/min · 60)
- lâmina a 100% (mm) = vazão (m³/h) · t100 / (área · 10)
- lâmina máxima = lâmina100 / (percentímetro mínimo/100)
- Lâmina bruta recomendada = min(lâmina máxima, max(lâmina100, déficit / (eficiência/100)))
- Percentímetro (%) = lâmina100 / lâmina bruta · 100 ; tempo da volta = t100 / (percentímetro/100)
- Energia (kWh) = potência (kW) · tempo da volta ; custo = kWh · tarifa (R$/kWh)

## 6. Cadastro por pivô (modelo de dados)
nome · cultura · data de plantio · ciclo (dias) · umidade inicial (%) · umidade da camada profunda (%) · capacidade de campo (%) · ponto de murcha (%) · raiz no plantio / máxima (cm) · dias até a raiz máxima · fator de depleção (variável ou fixo) · plantio direto sobre palhada · fabricante e modelo · nº de torres · raio (m) · ângulo (°) · vazão (m³/h) · pressão (bar) · velocidade da última torre a 100% (m/min) · percentímetro mínimo (%) · eficiência (%) · potência (kW) · tarifa (R$/kWh) · lâmina mínima (mm) · horário de ponta · sensor e profundidades · tensão para irrigar (kPa).
Também: **ajustes de umidade** (data, fonte, umidade na raiz, camada profunda, tensão), **irrigações lançadas** (data, mm) e **histórico de safras** (nome, cultura, plantio, produtividade, irrigação e chuva totais).
Estação (global): método de ET₀, latitude, altitude, altura do anemômetro.

**Todos os valores padrão do protótipo são exemplos, não medições da fazenda** (ex.: 55 kW para 200 m³/h, raio 400 m, CC 32%, PMP 18%).

## 7. Resultados de referência para testes
Com latitude −14,74, altitude 900 m, anemômetro 2 m, Pivô 2 de exemplo (soja, plantio 25/11/2025, umidade inicial 30%, CC 32, PMP 18, raiz 10→50 cm em 55 dias, f variável, palhada Sim, nenhuma irrigação lançada). Colunas: dia, ET₀ Penman-Monteith, ET₀ Hargreaves, ET₀ da planilha original, déficit (mm), decisão.
| dia | PM | HS | planilha | déficit | decisão |
|---|---|---|---|---|---|
| 2026-01-20 | 0.61 | 3.68 | 0.03 | 5.7 | IRRIGAR |
| 2026-01-21 | 4.29 | 3.70 | 4.07 | 0.0 | SEM DADOS |
| 2026-01-22 | 3.21 | 3.69 | 2.78 | 0.0 | NÃO IRRIGAR |
| 2026-01-23 | 2.53 | 3.96 | 2.01 | 0.0 | NÃO IRRIGAR |
| 2026-01-24 | 3.54 | 4.49 | 2.87 | 0.0 | NÃO IRRIGAR |
| 2026-01-25 | 2.36 | 3.32 | 1.53 | 2.2 | NÃO IRRIGAR |
| 2026-01-26 | 3.77 | 4.68 | 2.97 | 6.0 | IRRIGAR |
| 2026-01-27 | 5.10 | 5.18 | 3.50 | 11.9 | IRRIGAR |
| 2026-01-28 | 4.52 | 4.83 | 3.23 | 17.1 | IRRIGAR |
| 2026-01-29 | 4.06 | 4.94 | 3.09 | 21.5 | IRRIGAR |
| 2026-01-30 | 3.50 | 4.19 | 2.74 | 20.5 | IRRIGAR |
| 2026-01-31 | 3.79 | 4.36 | 3.07 | 19.7 | IRRIGAR |
| 2026-02-01 | 4.23 | 4.36 | 3.47 | 22.8 | IRRIGAR |
| 2026-02-02 | 4.12 | 4.34 | 3.35 | 25.3 | IRRIGAR |
| 2026-02-03 | 2.59 | 3.89 | 2.16 | 17.9 | IRRIGAR |
| 2026-02-04 | 3.81 | 4.15 | 3.15 | 17.9 | IRRIGAR |
| 2026-02-05 | 2.30 | 3.96 | 1.62 | 20.6 | IRRIGAR |
| 2026-02-06 | 3.93 | 4.75 | 3.09 | 25.1 | IRRIGAR |
| 2026-02-07 | 3.19 | 3.61 | 2.21 | 24.4 | IRRIGAR |
| 2026-02-08 | 3.89 | 4.44 | 2.95 | 24.6 | IRRIGAR |

## 8. O que a pesquisa encontrou
**Embrapa** (modelos publicados):
- Clima-solo-planta por fase, f variável pela demanda, raiz crescendo em linha reta, lâmina bruta = líquida/eficiência: [Cultivo do Milho, capítulo Irrigação](https://ainfo.cnptia.embrapa.br/digital/bitstream/item/81707/1/Manejo-irrigacao.pdf).
- Sensor define *quando*, ET₀ acumulada define *quanto*; tensão de −70 kPa no verão do Cerrado; sensores a 20 e 40 cm após 30 DAS (mesmo documento).
- Tanque Classe A para soja no Cerrado (ETc = Kc·Kp·Ev; Kc até 1,61 aos 75 dias): [Comunicado Técnico 120](https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/557528/1/comtec120.pdf). **Esse Kc é referido à evaporação do tanque, não à ET₀. Não misturar com a ET₀ da estação.**
- FAO-56 com Kc quadrático por dias após a emergência, irrigar com 40% da AFD esgotada (trigo, Cerrado): [Embrapa Cerrados](https://www.alice.cnptia.embrapa.br/alice/bitstream/doc/1162347/1/AA-CPAC-27022024-p-2086-2091.pdf).
- Não achei Kc, f nem raiz específicos de **soja** nas fontes abertas. A Embrapa cita a planilha da Circular Técnica 97 e o programa IrrigaFácil, que não consegui abrir.

**iCrop** ([iCrop Gestão de Irrigação](https://icrop.com.br/gestao-irrigacao/)): é serviço de gestão, **não fabricante de pivô**. O site não revela método de ET₀ nem Kc. Faz análise físico-hídrica do solo, monitoramento de umidade, fenologia, previsão semanal, diagnóstico do pivô e custo por mm. Contato: atendimento@icrop.com.br, (34) 3210-0520. Pedir um relatório quinzenal deles ajudaria a comparar métodos.

## 9. Segurança
A aba CONFIG da planilha original tem **API key, application key e MAC da Ecowitt em texto**. No projeto novo: guardar em variáveis de ambiente (`.env`, fora do git), não colocar em código nem em planilha, e **gerar chaves novas** na Ecowitt, porque estas já circularam em arquivos.
O e-mail de alerta no CONFIG_PIVO é diferente do e-mail da fazenda. Confirmar com o dono quem deve receber os avisos antes de usar.

## 10. Decisões e pendências
Decidido:
- Decisão **uma vez por dia, às 18h**, com janela fechada de 24 h.
- Estação única para todos os pivôs; parâmetros por pivô.
- ET₀ por Penman-Monteith; Hargreaves-Samani só como conferência.
Em aberto (perguntar ao dono antes de assumir):
1. Formato: **app web com login e telas** ou **só o motor de cálculo mandando mensagem**? (a pergunta foi feita e ainda não foi respondida)
2. Onde roda e onde guarda os dados (hospedagem e banco)? WhatsApp por qual provedor? E-mail só como alternativa?
3. Fabricante e modelo do pivô (a planilha cita "Valley") e os dados da placa.
4. Latitude, altitude e altura do anemômetro reais da estação.
5. Quem valida Kc, f, CC, PMP e raiz de soja (agrônomo)?
6. Como entrar a leitura de sensor de umidade (marca e modelo)?
7. Por que a coleta parou em 08/02 e como retomar o histórico?

## 11. Roteiro sugerido
1. Projeto com testes: motor de cálculo puro (ET₀ PM e HS, Kc, solo, balanço, equipamento), validado contra a tabela da seção 7 e contra o `prototipo_manejo.html`.
2. Coletor Ecowitt com normalização de unidades, deduplicação e rotina que recupera lacunas.
3. Banco: leituras brutas, diário por pivô, pivôs, irrigações, ajustes e safras.
4. Job das 18h: calcula todos os pivôs e envia a mensagem.
5. Telas: Hoje, Cadastro, histórico (reaproveitar o desenho do protótipo).
6. Importar o histórico da planilha original.
7. Rodar em paralelo com a planilha por 2 semanas e comparar antes de desligar a planilha.

## 12. Como o dono quer trabalhar
Respostas em português informal, diretas, passo a passo. Mostre o que mudou em poucas linhas, e confirme números rodando o código, não só lendo.
