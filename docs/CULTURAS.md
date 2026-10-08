# Culturas cadastradas

Escreva a chave na coluna **Cultura** da aba PIVOS (ou escolha no app, em Pivôs). Acento e maiúscula
não importam ("Feijão PD" = `feijao pd`). Os números são de boletins da Embrapa e do FAO-56 adotado
por ela — são **referência**: o agrônomo precisa validar para a fazenda e a cultivar.

| Chave | Ciclo | Como o Kc anda | Kc |
|---|---|---|---|
| `soja` | 120 DAS | degraus por fração do ciclo | 0,45 · 0,75 · 1,05 · 1,15 · 1,20 · 0,90 (aba KC da planilha original) |
| `milho` | 120 DAS | curva de 4 fases (17/28/33/22% do ciclo), reta nas fases 2 e 4 | 0,50 → 1,20 → 0,60 |
| `sorgo` | 120 DAS | 4 fases de 24/42/30/24 dias | 0,50 → 1,10 → 0,55 |
| `feijao` | 94 DAE (emergência 7 d) | degraus de 10 dias | 0,49 · 0,69 · 0,77 · 0,90 · 1,06 · 0,89 · 0,74 · 0,48 · 0,27 |
| `feijao pd` | 80 DAE (emergência 7 d) | 35 / 25 / 20 dias; já medido sobre palhada | 0,69 · 1,28 · 1,04 |
| `trigo` | 115 DAE (emergência 5 d) | equação: −0,000268·DAE² + 0,032979·DAE + 0,392945 | pico ≈ 1,41 aos 62 DAE |
| `algodao` | 150 DAE (emergência 5 d) | equação: −0,00006·DAE² + 0,009·DAE + 0,632 | pico ≈ 0,97 aos 75 DAE |

Em plantio direto (coluna Palhada = SIM) o Kc da primeira fase cai pela metade, menos no `feijao pd`.

Cuidados:
- **Trigo**: a equação foi ajustada com a ET₀ de Hargreaves-Samani; aqui usamos Penman-Monteith. A Embrapa
  recomenda irrigar com 40% da CAD consumida (fator fixo 0,4) e raiz de 40 cm.
- **Algodão**: dados do Nordeste (BRS 200 Marrom). No Cerrado o ciclo e o pico podem ser maiores.
- **Feijão**: irrigar com tensiômetro a 15 cm entre 30 e 40 kPa, a partir de 15–20 DAE.
- Solo e raiz (CC, PMP, raiz inicial/máxima, dias até a raiz máxima) continuam no cadastro de cada pivô.

Fontes:
- Milho: Embrapa Milho e Sorgo, Comunicado Técnico 47 — https://www.infoteca.cnptia.embrapa.br/bitstream/doc/487012/1/Com47.pdf ;
  Circular Técnica 10 — https://www.infoteca.cnptia.embrapa.br/bitstream/doc/485226/1/Circ10.pdf ;
  Irrigação e manejo — https://ainfo.cnptia.embrapa.br/digital/bitstream/item/27341/1/Irrigacao-Manejo.pdf
- Sorgo: Comunicado Técnico 254 (2021) — https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/1136374/1/COT-254-Planilha-obtencao-coeficiente-de-cultura.pdf
- Feijão: Agência de Informação Embrapa — https://www.agencia.cnptia.embrapa.br/gestor/feijao/arvore/CONTAG01_86_1311200215104.html ;
  https://www.embrapa.br/en/web/agencia-de-informacao-tecnologica/cultivos/feijao/producao/manejo-de-irrigacao
- Trigo BRS 394: Embrapa Cerrados — https://www.alice.cnptia.embrapa.br/alice/bitstream/doc/1162347/1/AA-CPAC-27022024-p-2086-2091.pdf
- Algodão: Embrapa Algodão — https://www.alice.cnptia.embrapa.br/alice/bitstream/doc/1173334/1/CoeficientesCultivoAlgodoeiroHerbaceo2009.pdf
