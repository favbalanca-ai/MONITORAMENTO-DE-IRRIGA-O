/**
 * Cadastro e lançamentos (até as telas ficarem prontas).
 *
 *   npm run banco -- cadastro config/fazenda.json             grava estação e pivôs (atualiza pelo nome)
 *   npm run banco -- pivos                                    lista os pivôs
 *   npm run banco -- irrigacao "Pivô 2" 2026-10-08 12         lança 12 mm líquidos aplicados no dia
 *   npm run banco -- umidade "Pivô 2" 2026-10-08 28 [--profunda 30] [--tensao -40] [--fonte TDR]
 *   npm run banco -- importar-csv dados/leituras              importa leituras gravadas em CSV
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { abrirBanco } from "../src/banco/banco.ts";
import { carregarCadastro, lancarAjuste, lancarIrrigacao, listarPivos, pivoPorNome, type CadastroFazenda } from "../src/banco/fazenda.ts";
import { RepositorioSqlite } from "../src/banco/leituras.ts";
import { configDoAmbiente } from "../src/coletor/config.ts";
import { RepositorioCsv } from "../src/coletor/repositorio.ts";
import { numero } from "../src/motor/unidades.ts";

const { positionals: [cmd, ...args], values } = parseArgs({
  allowPositionals: true,
  options: { profunda: { type: "string" }, tensao: { type: "string" }, fonte: { type: "string" } },
});

const exigirNumero = (s: string | undefined, nome: string): number => {
  const n = numero(s);
  if (n === null) throw new Error(`${nome} inválido: ${s}`);
  return n;
};

try {
  const db = abrirBanco(configDoAmbiente().banco);
  switch (cmd) {
    case "cadastro": {
      const cad = JSON.parse(await readFile(args[0] ?? "config/fazenda.json", "utf8")) as CadastroFazenda;
      carregarCadastro(db, cad);
      console.log(`Cadastro gravado: estação + ${cad.pivos.length} pivô(s).`);
      break;
    }
    case "pivos":
      for (const p of listarPivos(db))
        console.log(`${p.ativo ? "●" : "○"} ${p.nome} — ${p.cultura.nome}, plantio ${p.plantio}, balanço desde ${p.inicioBalanco ?? p.plantio}`);
      break;
    case "irrigacao": {
      const [nome, data, mm] = args;
      const p = pivoPorNome(db, nome ?? "");
      lancarIrrigacao(db, p.id, { data: data ?? "", mm: exigirNumero(mm, "Lâmina") });
      console.log(`Irrigação lançada: ${p.nome}, ${data}, ${mm} mm.`);
      break;
    }
    case "umidade": {
      const [nome, data, theta] = args;
      const p = pivoPorNome(db, nome ?? "");
      lancarAjuste(db, p.id, {
        data: data ?? "",
        umidadeRaizPct: exigirNumero(theta, "Umidade"),
        umidadeProfundaPct: values.profunda !== undefined ? exigirNumero(values.profunda, "Umidade profunda") : undefined,
        tensaoKpa: values.tensao !== undefined ? exigirNumero(values.tensao, "Tensão") : undefined,
        fonte: values.fonte,
      });
      console.log(`Medição lançada: ${p.nome}, ${data}, ${theta}%.`);
      break;
    }
    case "importar-csv": {
      const ls = await new RepositorioCsv(args[0] ?? "dados/leituras").intervalo("0000", "9999");
      const n = await new RepositorioSqlite(db).salvar(ls);
      console.log(`${n} de ${ls.length} leitura(s) importada(s).`);
      break;
    }
    default:
      console.log("Comandos: cadastro, pivos, irrigacao, umidade, importar-csv (ver o topo de scripts/banco.ts).");
      process.exitCode = 1;
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
}
