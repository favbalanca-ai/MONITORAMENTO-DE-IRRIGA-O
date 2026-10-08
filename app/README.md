# App — Manejo de Irrigação

Web app **estático** (sem backend), instalável no celular. Os dados vêm da planilha do Google pelo
Apps Script (`sync/`); o app guarda no aparelho só uma cópia para abrir rápido e a fila de lançamentos
feitos sem internet.

## Telas

- **Hoje** — a decisão de cada pivô (IRRIGAR · NÃO IRRIGAR · SEM DADOS), déficit × AFD, percentímetro,
  tempo da volta, lâmina bruta, custo de energia e alertas. Botão **Recalcular**.
- **Lançar** — irrigação (mm aplicados) ou umidade do solo (raiz, camada profunda, tensão). Sem sinal, o
  lançamento fica **na fila** e sobe sozinho quando a internet volta (reenviar nunca duplica). Lista dos
  últimos lançamentos com quem lançou e botão **Apagar**.
- **Histórico** — gráfico de déficit, AFD, lâmina mínima, chuva e irrigação (15 a 120 dias) e tabela.
- **Pivôs** — cadastro. Administrador edita (a planilha valida antes de gravar); operador só vê.
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
