# CLAUDE.md — MONITORAMENTO-DE-IRRIGA-O

Instruções para o Claude Code trabalhar neste repositório. Leia inteiro antes de qualquer tarefa.
Contexto agronômico e especificação do cálculo: `docs/CONTEXT.md`.

## Sobre o projeto

Manejo de irrigação por pivô da Fazenda Água Viva: coleta a estação Ecowitt, calcula o balanço
hídrico (ET₀ Penman-Monteith, Kc, solo, déficit) e diz todo dia às 18h se irriga, quanto, com que
percentímetro, em quanto tempo e a que custo. Mesma arquitetura do **PLANEJAMENTO-INSUMOS**:

- `app/` — web app **estático** (PWA), publicado no GitHub Pages pelo workflow
  `.github/workflows/deploy-pages.yml` a cada push na `main` que mexa em `app/**`.
- `sync/Code.gs` + `sync/Motor.gs` — Apps Script vinculado à planilha do Google Sheets e publicado
  como Web App. É a ponte app ↔ planilha e também faz o trabalho automático (coleta a cada 10 min,
  recuperação de buracos, relatório das 18h por e-mail, backup).
- `src/motor/` — o cálculo em TypeScript, com testes. **`sync/Motor.gs` é gerado dele**
  (`npm run gerar:apps-script`) — nunca editar o `Motor.gs` à mão.

A dona do projeto **não é programadora profissional**. Explique o que mudou em linguagem simples ao
final de cada tarefa, em português do Brasil, informal e direto.

## Regras de arquitetura (não quebrar)

1. **A planilha é a fonte da verdade.** O app puxa dela (`doGet`) e envia lançamentos (`doPost`).
2. **O app não tem build nem framework.** `app/` é `index.html` + `styles.css` + `app.js` (JS puro).
   O npm deste repositório serve só para os testes e para gerar o `Motor.gs`.
3. **Bibliotecas externas** só via `<script>` de `cdn.jsdelivr.net` ou `cdnjs.cloudflare.com`, com
   versão fixa, e só se não houver API nativa.
4. **Padrão do `doPost`:** um tipo por pedido, com chave `__nome` (`__login`, `__lancamento`,
   `__apagar`, `__recalcular`, `__pivo`, `__usuario`, `__trocarPin`). Tipo novo = um `if` no roteador.
5. **Idempotência:** todo lançamento tem `id` (coluna ID das abas IRRIGACOES/UMIDADE). Reenviar o mesmo
   id regrava a mesma linha, nunca duplica. É isso que permite a fila sem internet do app.
6. **Abas novas** são criadas pelo `Code.gs` quando faltam. Localize colunas **pelo cabeçalho**.
7. **Texto do usuário** gravado em célula passa por `T_()` (não vira fórmula).
8. **Estado local** do app (cache dos dados, fila, sessão, log) fica no `localStorage`. Tudo que outros
   aparelhos precisam ver sobe para a planilha.
9. **Login:** PIN com hash na aba `USUÁRIOS APP`; sessão assinada (HMAC) no aparelho, enviada em todo
   pedido (`s`). `CONFIG APP` → `EXIGIR LOGIN`. Perfis: ADMIN (tudo) e OPERADOR (vê e lança).

## Checklist de entrega (toda mudança)

- [ ] Mudou `app/app.js`? Suba a `APP_VERSION` (formato `AAAA.MM.DD-N`) e o `app/version.json`.
- [ ] Mudou `app/sw.js`? Troque o texto de `VERSAO`.
- [ ] Mudou `src/motor/`, `src/coletor/` ou `src/job/mensagem.ts`? Rode `npm run gerar:apps-script`.
- [ ] Mudou `sync/Code.gs` ou `sync/Motor.gs`? Suba `VERSAO_SERVIDOR` e avise no final: **a dona precisa
      colar o arquivo no Apps Script e criar uma Nova versão em Implantar → Gerenciar implantações**.
- [ ] `npm run check` passando (tipos + testes, inclusive os do navegador em `test/e2e/`).
- [ ] Atualize `README.md` / `app/README.md` / `sync/README.md` se o comportamento mudou.

## Como testar

```bash
npm install
npm run check                    # tipos + todos os testes
cd app && python3 -m http.server 8092   # abrir http://localhost:8092 (precisa do endereço /exec em Ajustes)
```

- `test/apps_script/fake.ts` imita o Apps Script (planilha, Drive, e-mail, gatilhos, criptografia):
  os testes rodam o `sync/Code.gs` + `Motor.gs` de verdade, no Node.
- `test/e2e/app_pages.test.ts` abre o `app/` num Chromium e desvia o endereço /exec para essa planilha
  simulada. Prints em `test/e2e/prints/` (fora do git).
- Teste em tela de celular: o app é usado no campo.

## Segurança — o repositório é PÚBLICO

- **Nunca** commitar chaves da Ecowitt, a URL `/exec` do Web App, PIN, e-mail, planilhas `.xlsx`
  (as originais tinham chaves em texto) ou o `.env`.
- Em testes e exemplos, use valores fictícios (ex.: `A1B2C3D4…`, `AA:BB:CC:DD:EE:FF`).
- As chaves da Ecowitt ficam só nas propriedades do script (menu 💧 Manejo → Configurar chaves).

## Como trabalhar

- **Planeje antes de codar** em mudanças grandes: arquivos, funções, payloads do `doPost`, abas novas e
  como testar. Espere o ok.
- Siga o estilo do `app.js`: telas em `V.nome = function(){...}` (e `V.nome_depois` para ligar eventos),
  rotas `#/nome`, ações por `data-act`, `toast()`, `chamar()`, texto em português.
- `src/banco/`, `src/job/diario.ts` e `scripts/servico.ts` são uma versão antiga em Node (SQLite) que
  **não está em uso**; o que vale é a planilha + `sync/`.
