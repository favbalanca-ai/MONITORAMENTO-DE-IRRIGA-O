/**
 * Relatório do dia, na mão.
 *
 *   npm run diario                         último dia fechado; envia pelos canais do .env
 *   npm run diario -- --data 2026-02-08    um dia específico
 *   npm run diario -- --sem-envio          só calcula e mostra
 *   npm run diario -- --forcar             reenvia mesmo se o canal já recebeu
 */
import { parseArgs } from "node:util";
import { abrirBanco } from "../src/banco/banco.ts";
import { configDoAmbiente, notificadoresDaConfig } from "../src/coletor/config.ts";
import { rodarDiario } from "../src/job/diario.ts";

const { values } = parseArgs({
  options: { data: { type: "string" }, "sem-envio": { type: "boolean" }, forcar: { type: "boolean" } },
});

try {
  const cfg = configDoAmbiente();
  const semEnvio = values["sem-envio"] ?? false;
  const r = await rodarDiario(abrirBanco(cfg.banco), {
    data: values.data,
    forcar: values.forcar,
    notificadores: semEnvio ? [] : notificadoresDaConfig(cfg),
  });
  if (semEnvio) console.log(`${r.assunto}\n\n${r.texto}`);
  for (const e of r.envios) console.log(`${e.canal}: ${e.status}${e.erro ? ` — ${e.erro}` : ""}`);
  if (r.envios.some((e) => e.status === "erro")) process.exitCode = 1;
} catch (e) {
  console.error(`Falha no relatório: ${(e as Error).message}`);
  process.exitCode = 1;
}
