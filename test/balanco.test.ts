import { test } from "node:test";
import assert from "node:assert/strict";
import { simularBalanco, type DiaClima } from "../src/motor/index.ts";
import { DIAS_PIVO2, ESTACAO_EXEMPLO, PIVO2_EXEMPLO } from "./pivo2_exemplo.ts";

const base = { pivo: PIVO2_EXEMPLO, estacao: ESTACAO_EXEMPLO, dias: DIAS_PIVO2 };
const semIrrig = simularBalanco(base);

test("irrigação lançada desconta UMA vez do déficit (bug 1 da planilha)", () => {
  const com = simularBalanco({ ...base, irrigacoes: [{ data: "2026-01-29", mm: 10 }] });
  const i = com.findIndex((l) => l.data === "2026-01-29");
  assert.ok(Math.abs(semIrrig[i]!.deficit - 10 - com[i]!.deficit) < 1e-9);
  assert.equal(com[i]!.irrigacao, 10);
});

test("déficit tem piso em zero e volta a acumular depois da chuva (bug 2 da planilha)", () => {
  const chuva = semIrrig.find((l) => l.data === "2026-01-24")!;
  assert.equal(chuva.deficit, 0);
  assert.ok(semIrrig.find((l) => l.data === "2026-01-26")!.deficit > 0);
});

test("medição de umidade substitui o déficit do dia e o balanço segue dali", () => {
  const ajustado = simularBalanco({ ...base, ajustes: [{ data: "2026-02-01", umidadeRaizPct: 31 }] });
  const i = ajustado.findIndex((l) => l.data === "2026-02-01");
  assert.equal(ajustado[i]!.deficit, 5);
  assert.equal(ajustado[i]!.ajustado, true);
  const prox = ajustado[i + 1]!;
  assert.ok(Math.abs(prox.deficit - Math.max(0, 5 + prox.etc - prox.chuva)) < 1e-9);
});

test("alertas de sensor: tensão, camada profunda e medição velha", () => {
  const r = simularBalanco({
    ...base,
    ajustes: [{ data: "2026-01-20", umidadeRaizPct: 30, umidadeProfundaPct: 33, tensaoKpa: -75 }],
  });
  assert.ok(r[0]!.alertas.some((a) => a.includes("percolação")));
  assert.ok(r[0]!.alertas.some((a) => a.includes("Tensiômetro")));
  assert.ok(r.at(-1)!.alertas.some((a) => a.includes("Última medição")));
  assert.ok(!r[15]!.alertas.some((a) => a.includes("Última medição")));
});

test("déficit acima da AFD gera alerta de estresse", () => {
  const seco: DiaClima[] = DIAS_PIVO2.map((d) => ({ ...d, chuva: 0 }));
  const r = simularBalanco({ ...base, dias: seco });
  const l = r.find((x) => x.deficit >= x.afdMm)!;
  assert.ok(l.alertas.some((a) => a.includes("AFD")));
});

test("com equipamento cadastrado, dia de IRRIGAR traz percentímetro e custo", () => {
  const pivo = {
    ...PIVO2_EXEMPLO,
    equipamento: {
      raioM: 400, anguloGraus: 360, vazaoM3h: 200, velocidadeUltimaTorreMMin: 3,
      percentimetroMinPct: 10, eficienciaPct: 85, potenciaKw: 55, tarifaRsKwh: 0.5,
    },
  };
  const r = simularBalanco({ ...base, pivo });
  const irrigar = r.find((l) => l.decisao === "IRRIGAR")!;
  assert.ok(irrigar.recomendacao && irrigar.recomendacao.percentimetroPct <= 100);
  assert.equal(r.find((l) => l.decisao === "NÃO IRRIGAR")!.recomendacao, undefined);
});
