# App — Manejo de Irrigação

Web app **estático** (sem backend), instalável no celular. Os dados vêm da planilha do Google pelo
Apps Script (`sync/`); o app guarda no aparelho só uma cópia para abrir rápido e a fila de lançamentos
feitos sem internet.

## Telas

- **Hoje** — a decisão de cada pivô (IRRIGAR · NÃO IRRIGAR · SEM DADOS), déficit × AFD, percentímetro,
  tempo da volta, lâmina bruta, custo de energia e alertas. Botão **Recalcular**. Cartão **Próximos dias**
  com a previsão de chuva (mm e % do Open-Meteo, texto do INMET) e aviso quando a chuva prevista cobre o
  déficit. Só a decisão: resumo no topo (quantos pivôs em cada estado) e, em cada pivô: **próxima irrigação prevista** (com a
  ET₀ prevista do Open-Meteo, sem contar chuva), **déficit ao fim da volta** e, com tarifa de ponta cadastrada,
  a **hora de ligar** e o custo. A borda de cada pivô é o semáforo: verde bom · amarelo atenção · vermelho irrigar ·
  cinza sem dados. Botão **PDF** baixa o relatório do dia (o mesmo que vai por e-mail, mais o balanço de 30 dias
  de cada pivô). Com piscinão cadastrado (aba RESERVATORIOS), um cartão mostra o volume estimado, o que entra pela bomba,
  o que os pivôs puxam, se cobre a irrigação de hoje e pra quantos dias de irrigação dá. Tema claro por padrão; em Ajustes dá pra escolher escuro ou automático (segue o aparelho); no computador os pivôs ficam em duas colunas.
- **Lançar** — irrigação pelo **percentímetro usado** (a lâmina sai do equipamento cadastrado) ou pela lâmina em mm,
  umidade do solo (raiz, camada profunda, tensão) ou **nível do piscinão** (% do volume útil, medido no fim do dia). Sem sinal, o
  lançamento fica **na fila** e sobe sozinho quando a internet volta (reenviar nunca duplica). Lista dos
  últimos lançamentos com quem lançou e botão **Apagar**.
- **Histórico** — resumo do período (consumo ETc, chuva útil, irrigação em mm e m³, déficit e tendência, dias
  pedindo irrigação, dias em estresse, cobertura do consumo), gráfico de déficit/AFD/lâmina mínima/chuva/irrigação
  com os dias de estresse em vermelho (15 a 120 dias), tabela com % da AFD e "Mais colunas" (DAS, estádio, Kc,
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
- **Mapa** — imagem de satélite com o contorno (ou círculo do raio) de cada pivô na cor do semáforo; toque
  abre decisão, déficit e percentímetro. Precisa de internet (Leaflet e imagens vêm da rede).
- **Pivôs** — cadastro. Administrador edita (a planilha valida antes de gravar); operador só vê. Cada área tem
  **Fazenda** e **Tipo**: *pivô* (balanço hídrico completo) ou *talhão* (sem pivô: só o relatório do ciclo da
  cultura — graus-dia, fotoperíodo, horas de sol, chuva e ET₀ acumulados; aparece em Hoje, nos Detalhes e no Histórico).
  Em Equipamento, **Fonte de água**: abastecimento direto ou um piscinão. Abaixo da lista, **Fontes de água
  (piscinões)**: o administrador cadastra, edita e apaga piscinões (volume útil, bomba m³/h × horas/dia, reserva);
  um piscinão em uso por algum pivô não pode ser apagado.
  Posição: **Importar KMZ com os pivôs** (um desenho por pivô, casado pelo nome ou número), ou no pivô
  **KMZ/KML** de um desenho só, ou **📍 Usar minha posição** parado no centro do pivô.
- **Fazendas** — com mais de uma fazenda na planilha aparece um seletor no topo; cada usuário só vê as fazendas
  que o administrador liberou para ele (Ajustes → Usuários).
- **Ajustes** — endereço da planilha (/exec), puxar/enviar agora, lançamentos recusados, conta,
  usuários (administrador) e o registro das conversas com a planilha.
- **Entrar** — login + PIN. **Minha conta** — trocar PIN, sair.

## Sincronização

- Ao abrir, ao voltar para o app e a cada 1 min: envia a fila e pergunta à planilha só o "hash"; baixa
  tudo apenas se algo mudou.
- O indicador no topo mostra 🟢 Sincronizado · 🟡 Sincronizando · 🔴 Erro / Sem internet.

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
