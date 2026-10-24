# App — Manejo de Irrigação

Web app **estático** (sem backend), instalável no celular. Os dados vêm da planilha do Google pelo
Apps Script (`sync/`); o app guarda no aparelho só uma cópia para abrir rápido e a fila de lançamentos
feitos sem internet.

## Telas

- **Hoje** — os cartões (piscinão, pivôs, talhões) ficam **recolhidos**: cabeçalho, barra e uma linha-resumo; o
  toque abre o resto e o app lembra quais ficaram abertos. A decisão de cada pivô (IRRIGAR · NÃO IRRIGAR · SEM DADOS), déficit × AFD, percentímetro,
  tempo da volta, lâmina bruta, custo de energia e alertas. Botão **Recalcular**. Cartão **Próximos dias**
  (na tela Clima) com 7 dias em destaque — tempo (ícone), chuva, chance, temperatura e **quantos modelos
  veem chuva** (Open-Meteo: melhor ajuste + ECMWF, GFS, ICON, GEM, Météo-France, UKMO, JMA e ECMWF AIFS; texto do INMET;
  **ensemble do ECMWF**: 51 rodadas, de onde sai a chance de chuva mostrada e a faixa p10–p90 de cada dia). A previsão sazonal do NCEP (CFSv2, 60 dias) também é buscada pelo celular, mas só vai para a aba
  PREVISAO 60 DIAS da planilha (o cartão no app foi retirado a pedido da dona) — e, em
  "Detalhes", 14 dias com UR, vento/rajada, ET₀, horas de sol e UV e a tabela de chuva modelo a modelo.
  **Placar dos modelos**: a planilha compara o que cada modelo previu (1 a 7 dias antes) com o que a estação
  mediu e dá peso a quem acerta mais nos últimos 30 dias (erros recentes pesam mais); com 5 dias medidos, a
  chuva, a chance e a temperatura de cada dia passam a ser o **consenso ponderado** (o "melhor ajuste" fica entre
  parênteses nos detalhes) e a tabela do placar mostra peso, erro de chuva, erro de temperatura e acerto
  chove/não chove por modelo. Cartão **Chuva confirmada pelo INMET** (quando a fazenda tem o código da estação
  automática do INMET na aba FAZENDAS): últimos 7 dias, chuva da fazenda × chuva do INMET, diferença e
  temperaturas; o INMET preenche o placar nos dias em que a estação da fazenda falhou. Totais de chuva × ET₀ (saldo) em 7 e 14 dias. **Tendência** de cada dia: o que as rodadas anteriores
  (uma por dia) diziam da chance de chuva daquele dia (95% → 80% ↓ caindo), com mini-gráfico e um **índice de
  confiança** 0–100 (chance atual + concordância dos modelos + estabilidade entre rodadas). Aviso quando a
  chuva prevista cobre o déficit. **O próprio app busca o Open-Meteo** (o Open-Meteo bloqueia os endereços
  do Google de onde a planilha sai, "HTTP 429"): ao abrir o app com a previsão velha (> 3 h) ou pelo botão
  **Atualizar**, o celular baixa o diário e as horas e manda para a planilha (`__previsaoDados`); a fonte
  aparece como "Open-Meteo (6 modelos) via app". Qualquer usuário logado pode. Só a decisão: resumo no topo (quantos pivôs em cada estado) e, em cada pivô: **próxima irrigação prevista** (com a
  ET₀ prevista do Open-Meteo, sem contar chuva), **déficit ao fim da volta** e, com tarifa de ponta cadastrada,
  a **hora de ligar** e o custo. A borda de cada pivô é o semáforo: verde bom · amarelo atenção · vermelho irrigar ·
  cinza sem dados. Botão **PDF** baixa o relatório do dia (o mesmo que vai por e-mail, mais o balanço de 30 dias
  de cada pivô). Com piscinão cadastrado (aba RESERVATORIOS), um cartão mostra o volume estimado, o que entra pela bomba,
  o que os pivôs puxam, se cobre a irrigação de hoje e pra quantos dias de irrigação dá. É um painel: saída, entrada e
  saldo do dia, consumo previsto pelos próximos dias (Kc × ET₀ prevista, menos a chuva prevista) com barras do volume
  dia a dia, dia em que chega na reserva e horas de bomba sugeridas pra segurar o nível. Tema claro por padrão; em Ajustes dá pra escolher escuro ou automático (segue o aparelho); no computador os pivôs ficam em duas colunas.
- **Lançar** — irrigação pelo **percentímetro usado** (a lâmina sai do equipamento cadastrado) ou pela lâmina em mm,
  umidade do solo (raiz, camada profunda, tensão) ou **nível do piscinão** (% do volume útil, medido no fim do dia). Sem sinal, o
  lançamento fica **na fila** e sobe sozinho quando a internet volta (reenviar nunca duplica). Lista dos
  últimos lançamentos com quem lançou e botão **Apagar**.
- **Histórico** — resumo do período (consumo ETc, chuva útil, irrigação em mm e m³, déficit e tendência, dias
  pedindo irrigação, dias em estresse, cobertura do consumo), gráfico em dois painéis com o mesmo eixo de datas
  (15 a 120 dias): em cima a **água disponível no solo** (CAD − déficit), com a capacidade de campo em cima
  (linha azul), a lâmina mínima ("irrigar abaixo daqui", azul-petróleo pontilhada), o limite de estresse
  (CAD − AFD, roxo) e o ponto de murcha no zero (vermelho tracejado); faixas verde (ok), amarela (irrigar) e rosa
  (estresse), dias em estresse e medições marcados e o valor de hoje com o déficit; embaixo chuva e irrigação em colunas e o consumo
  (ETc) em linha. Tocar ou passar o dedo mostra todos os números daquele dia (crosshair + balão), tabela com % da AFD e "Mais colunas" (DAS, estádio, Kc,
  ET₀, raiz, CAD) e **Baixar CSV**.
- **Clima** — cartão **Estação agora**: última leitura com sensação, orvalho, vento e rajada (bússola), UV, radiação,
  chuva de hoje e taxa, pressão com tendência de 3 h, raios e sensores de solo (o que a estação mandar). Avisos
  pra quem vai ligar o pivô: chovendo agora, vento forte (≥ 4 m/s, deriva), raios, estação sem leitura nova.
  Cartão **Vento nas últimas 24 h**: rosa dos ventos com 16 setores (de onde o vento veio, por faixa de
  velocidade), direção predominante e % de calmaria. Filtro por período (datas) — sem escolher, últimas 24 h.
  Bloco **Pulverização agora**: Delta T (bulbo seco − bulbo úmido, fórmula de Stull) e um semáforo único de
  aplicação com os motivos — faixas usuais Embrapa/ANDEF: Delta T 2–8 °C, vento 3–10 km/h (até 15 com atenção),
  UR > 55 %, temperatura < 30 °C, sem chuva. Abaixo, as **próximas 48 h** hora a hora (previsão horária do
  Open-Meteo) e a melhor hora pra aplicar (janelas boas; senão as de atenção; senão a hora menos ruim).
  A aplicação é **aérea**: só conta da **primeira à última luz do dia** (crepúsculo civil, calculado pela
  latitude/longitude da fazenda); as horas escuras aparecem hachuradas na faixa e ficam fora das janelas.
  Mostra a primeira luz, o nascer, o pôr e a última luz do dia.
- **Mapa** — imagem de satélite com o contorno (ou círculo do raio) de cada pivô na cor do semáforo; toque
  abre decisão, déficit e percentímetro. Precisa de internet (Leaflet e imagens vêm da rede). Chave **NDVI por
  satélite**: camada de vigor da vegetação do NASA GIBS (MODIS Terra, 250 m, composto de 16 dias), com data
  (vazio = mais recente) e transparência; gratuita e sem chave. Com o Instance ID do Copernicus na CONFIG APP da
  planilha aparece a segunda fonte, **Sentinel-2 10 m** (passagem mais recente com até 40 % de nuvem nos 30 dias
  até a data escolhida), com seletor de índice: **NDVI** (vigor), **NDMI** (umidade da folha, aviso cedo de estresse
  hídrico), **Infravermelho colorido** e **Cor natural**, cada um com legenda e dica de leitura. Os IDs das camadas
  vêm da CONFIG APP (padrão: VEGETATION_INDEX, MOISTURE_INDEX, COLOR_INFRARED, TRUE_COLOR).
  **Pivô em foco** (só com Sentinel-2, índices NDVI e NDMI): escolhe um pivô e o app pede ao Sentinel Hub as
  estatísticas do índice dentro do polígono dele (FIS, 10 m, 90 dias, até 60 % de nuvem), lista as passagens
  disponíveis, pinta só o pivô (recorte pelo contorno) em 6 faixas de cor esticadas entre os percentis 5 e 95
  daquela passagem e mostra a legenda numérica com média e variação, como nos apps de agricultura de precisão.
  As cores valem só dentro daquele pivô.
- **Pivôs** — cadastro. Administrador edita (a planilha valida antes de gravar); operador só vê. Cada área tem
  **Fazenda** e **Tipo**: *pivô* (balanço hídrico completo) ou *talhão* (sem pivô: só o relatório do ciclo da
  cultura — graus-dia, fotoperíodo, horas de sol, chuva e ET₀ acumulados; aparece em Hoje, nos Detalhes e no Histórico).
  Em Solo e raiz: **Textura do solo** com valores de referência (botão Usar) pra quem não tem análise; abaixo dos
  campos, o app mostra ao vivo a CAD e a AFD que aquele solo dá (raiz máxima e planta nova) e os dias de folga; e
  "Tenho o laudo" converte CC e PMP de % de peso pra % de volume pela densidade, com média pesada de duas camadas.
  Em Equipamento, o cadastro simples é **raio + vazão + tempo da volta a 100 %**: o app estima a lâmina a 100 % e,
  a partir dela, a lâmina e o tempo de cada porcentagem do percentímetro (tabela ao vivo abaixo dos campos). Em
  "Outros jeitos de informar (opcional)" ficam a velocidade da última torre (no lugar do tempo) e a lâmina bruta a
  100 % da placa (no lugar da vazão); o que vier da placa vale sobre o calculado.
  **Fonte de água**: abastecimento direto ou um piscinão. Abaixo da lista, **Fontes de água
  (piscinões)**: o administrador cadastra, edita e apaga piscinões (volume útil, bomba m³/h × horas/dia, reserva);
  um piscinão em uso por algum pivô não pode ser apagado.
  Posição: **Importar KMZ com os pivôs** (um desenho por pivô, casado pelo nome ou número), ou no pivô
  **KMZ/KML** de um desenho só, ou **📍 Usar minha posição** parado no centro do pivô.
- **Fazendas** — com mais de uma fazenda na planilha aparece um seletor no topo; cada usuário só vê as fazendas
  que o administrador liberou para ele (Ajustes → Usuários).
- **Ajustes** — endereço da planilha (/exec), puxar/enviar agora, lançamentos recusados, conta,
  usuários (administrador) e o registro das conversas com a planilha. **Avisos no celular**: chave que pede
  permissão de notificação e inscreve o aparelho no push da planilha (Web Push com VAPID, sem Firebase nem
  serviço de terceiros). Todo dia, depois das 18h, a planilha manda um push vazio assinado; o service worker
  acorda, busca `?acao=alerta&endpoint=…` e mostra "Irrigar N pivôs · dd/mm" com percentímetro e déficit de cada
  um (ou piscinão no vermelho, ou "nenhum pivô pra irrigar"), mesmo com o app fechado. Toque abre a tela Hoje.
  Além disso, quando o app sincroniza um dia novo com pivô pedindo irrigação, avisa na hora. No iPhone precisa
  instalar o app na tela de início (iOS 16.4+). Cada celular liga o seu; desligar tira a inscrição.
- **Entrar** — login + PIN. **Minha conta** — trocar PIN, sair.

## Sincronização

- Ao abrir, ao voltar para o app e a cada 1 min: envia a fila e pergunta à planilha só o "hash"; baixa
  tudo apenas se algo mudou.
- O indicador no topo mostra 🟢 Sincronizado · 🟡 Sincronizando · 🔴 Erro / Sem internet.
- **Carregamento:** o service worker (`sw.js`) pede o app sempre à rede (versão publicada mais nova) e guarda
  uma cópia no aparelho; se a rede demorar mais de 4 s ou não houver sinal, o app abre na hora com a cópia e
  os dados do `localStorage`. "Atualizar app" (rodapé) apaga a cópia e o worker e recarrega da rede. O
  histórico de 30 dias da tela Clima é reaproveitado por 10 minutos.

## Publicar no GitHub Pages (uma vez)

1. O repositório precisa ser **público** (o Pages grátis não publica repositório privado).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Qualquer push na `main` que mexa em `app/` publica sozinho (ou **Actions → Deploy app to GitHub Pages →
   Run workflow**).
4. O app fica em `https://favbalanca-ai.github.io/MONITORAMENTO-DE-IRRIGA-O/`.

## Rodar no computador

```bash
cd app && python3 -m http.server 8092   # abra http://localhost:8092
```
