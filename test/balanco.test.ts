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

test("chuva abaixo do mínimo efetivo não entra no balanço (padrão 2 mm) e avisa", () => {
  // zera as outras chuvinhas da série para isolar o efeito de um dia só
  const dias = DIAS_PIVO2.map((d) => ({ ...d, chuva: d.data === "2026-01-29" ? 1.5 : d.chuva < 2 ? 0 : d.chuva }));
  const com2 = simularBalanco({ ...base, dias });
  const com0 = simularBalanco({ ...base, dias, chuvaMinimaMm: 0 });
  const i = com2.findIndex((l) => l.data === "2026-01-29");
  assert.equal(com2[i]!.chuva, 0);
  assert.equal(com0[i]!.chuva, 1.5);
  assert.ok(Math.abs(com2[i]!.deficit - com0[i]!.deficit - 1.5) < 1e-9);
  assert.ok(com2[i]!.alertas.some((a) => /1\.5 mm abaixo de 2 mm/.test(a)));
});

test("dia sem leituras usa a ET₀ do Open-Meteo em vez de travar em SEM DADOS", () => {
  const dias = DIAS_PIVO2.map((d) => (d.data === "2026-02-08" ? { ...d, n: 20, et0Externa: 4.2 } : d));
  const r = simularBalanco({ ...base, dias });
  const u = r[r.length - 1]!;
  assert.equal(u.et0, 4.2);
  assert.notEqual(u.decisao, "SEM DADOS");
  assert.ok(u.alertas.some((a) => /Open-Meteo \(4\.20 mm\)/.test(a)));
  const sem = simularBalanco({ ...base, dias: DIAS_PIVO2.map((d) => (d.data === "2026-02-08" ? { ...d, n: 20 } : d)) });
  assert.equal(sem[sem.length - 1]!.decisao, "SEM DADOS");
});

test("projeção: com a ET₀ prevista diz quando o déficit passa da lâmina mínima e o déficit ao fim da volta", () => {
  const prev = (data: string, et0: number) => ({ data, chuvaMm: 0, probPct: 0, tmin: 18, tmax: 30, et0Mm: et0 });
  const previsao = ["09", "10", "11", "12", "13"].map((d) => prev("2026-02-" + d, 5));
  // pivô "molhado" hoje: lâmina mínima alta para a decisão ser NÃO IRRIGAR e a projeção apontar o dia
  const pivo = { ...PIVO2_EXEMPLO, laminaMinimaMm: 35 };
  const r = simularBalanco({ ...base, pivo, previsao });
  const u = r[r.length - 1]!;
  assert.equal(u.decisao, "NÃO IRRIGAR");
  const p = u.projecao!;
  assert.equal(p.horizonte, 5);
  assert.equal(p.dias[0]!.data, "2026-02-09");
  assert.ok(p.dias[0]!.deficit > u.deficit);
  assert.ok(p.proximaIrrigacao !== null && p.emDias! >= 1, JSON.stringify(p));
  assert.equal(r[0]!.projecao, undefined); // só a última linha
  // hoje já IRRIGAR: próxima = hoje, e déficit ao fim da volta > déficit de hoje
  const eq = { raioM: 400, anguloGraus: 360, vazaoM3h: 200, velocidadeUltimaTorreMMin: 3, percentimetroMinPct: 10, eficienciaPct: 85, potenciaKw: 55, tarifaRsKwh: 0.5 };
  const hoje = simularBalanco({ ...base, pivo: { ...PIVO2_EXEMPLO, equipamento: eq }, previsao })[DIAS_PIVO2.length - 1]!;
  assert.equal(hoje.decisao, "IRRIGAR");
  assert.equal(hoje.projecao!.emDias, 0);
  assert.ok(hoje.projecao!.deficitFimVoltaMm! > hoje.deficit);
});

test("graus-dia: com GD do ciclo no pivô, o estádio anda pela soma térmica", () => {
  // tmed ≈ 22 °C, base 10 → ~12 GD/dia; ciclo de 1200 GD anda ~1%/dia, como o ciclo de 120 dias (parecido)
  const rapido = simularBalanco({ ...base, pivo: { ...PIVO2_EXEMPLO, grausDiaCiclo: 1000 } });
  const normal = simularBalanco(base);
  const u = DIAS_PIVO2.length - 1;
  // cultivar de 1000 GD fecha o ciclo mais cedo: estádio mais adiantado que por dias corridos (R5 × R3)
  assert.equal(normal[u]!.estadio, "R3");
  assert.equal(rapido[u]!.estadio, "R5");
  assert.ok(rapido[u]!.kc > normal[u]!.kc);
});
