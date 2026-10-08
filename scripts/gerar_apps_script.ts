/**
 * Gera sync/Motor.gs a partir do código TypeScript testado (motor, parsing da Ecowitt,
 * lacunas e mensagem). Assim a planilha calcula exatamente o que os testes validam.
 *
 *   npm run gerar:apps-script
 *
 * Tudo fica dentro de um namespace `Motor` para não colidir com o Codigo.gs.
 */
import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

export const ARQUIVOS = [
  "src/motor/unidades.ts",
  "src/motor/agregacao.ts",
  "src/motor/completar.ts",
  "src/motor/et0.ts",
  "src/motor/cultura.ts",
  "src/motor/solo.ts",
  "src/motor/equipamento.ts",
  "src/motor/balanco.ts",
  "src/motor/cadastro.ts",
  "src/coletor/tempo.ts",
  "src/coletor/ecowitt.ts",
  "src/coletor/lacunas.ts",
  "src/job/mensagem.ts",
];

export const DESTINO = "sync/Motor.gs";

export function gerarMotorGs(raiz = "."): string {
  const exportados: string[] = [];
  const partes = ARQUIVOS.map((arq) => {
    const fonte = readFileSync(`${raiz}/${arq}`, "utf8");
    const js = ts.transpileModule(fonte, {
      compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.ESNext, removeComments: false },
    }).outputText;
    const limpo = js
      .replace(/^import\s[^;]*;\s*$/gm, "")
      .replace(/^export\s+\{\s*\};?\s*$/gm, "")
      .replace(/^export\s+(async\s+function|function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm, (_m, tipo: string, nome: string) => {
        exportados.push(nome);
        return `${tipo} ${nome}`;
      });
    if (/^\s*export\s/m.test(limpo)) throw new Error(`Sobrou "export" em ${arq}`);
    return `  // ---- ${arq} ----\n${limpo.trim().replace(/^/gm, "  ")}`;
  });
  return [
    "/**",
    " * GERADO AUTOMATICAMENTE por scripts/gerar_apps_script.ts — NÃO EDITE AQUI.",
    " * Para mudar o cálculo, altere o TypeScript em src/, rode os testes e gere de novo.",
    " */",
    "var Motor = (function () {",
    '  "use strict";',
    ...partes,
    "",
    "  // No Apps Script, a hora local vem do Utilities (independe do suporte a Intl).",
    '  if (typeof Utilities !== "undefined") {',
    "    paraLocal = function (ms, fuso) {",
    "      return Utilities.formatDate(new Date(ms), fuso, \"yyyy-MM-dd'T'HH:mm:ss\");",
    "    };",
    "  }",
    "",
    `  return { ${exportados.join(", ")} };`,
    "})();",
    "",
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(DESTINO, gerarMotorGs());
  console.log(`${DESTINO} gerado.`);
}
