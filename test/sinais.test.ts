import { test } from "node:test";
import assert from "node:assert/strict";
import { sinalDoDia, aprenderSinais, aplicarSinais, completarChuvaDepois, textoSinalHoje, textoAprendizado, setorDoVento, somarDias, type LeituraSinal, type SinalDia, type DiaPrevisao } from "../src/motor/index.ts";

const leitura = (hora: string, dir: number | null, p: number | null, vento = 2): LeituraSinal => ({ quando: "2026-11-08T" + hora, ventoMs: vento, direcaoGraus: dir, pressaoHpa: p });

test("sinal do dia: % de vento de oeste (SW a NW), setor predominante e variação da pressão", () => {
  assert.equal(setorDoVento(270), "W"); assert.equal(setorDoVento(225), "SW"); assert.equal(setorDoVento(315), "NW"); assert.equal(setorDoVento(359), "N");
  const hoje = [leitura("06:00", 260, 1012), leitura("09:00", 275, 1011), leitura("12:00", 300, 1010), leitura("15:00", 90, 1009), leitura("18:00", 280, 1008, 0.3)];
  const ontem = [leitura("06:00", 100, 1014), leitura("12:00", 110, 1013), leitura("18:00", 120, 1012)];
  const s = sinalDoDia("2026-11-08", hoje, ontem);
  // a leitura das 18h está sem vento (1 km/h): a direção não conta; 3 de 4 com vento vieram do oeste
  assert.equal(s.oestePct, 75);
  assert.equal(s.direcao, "W");           // 260 → W, 275 → W, 300 → WNW, 90 → E
  assert.equal(s.pressaoMediaHpa, 1010);
  assert.equal(s.pressao24hHpa, -3);
  assert.equal(s.leituras, 5);
  assert.equal(s.chuvaDepoisMm, null);
  // sem direção nem pressão: nada
  const vazio = sinalDoDia("2026-11-08", [leitura("06:00", null, null)]);
  assert.deepEqual([vazio.oestePct, vazio.direcao, vazio.pressaoMediaHpa, vazio.pressao24hHpa, vazio.leituras], [null, null, null, null, 0]);
});

/** 40 dias: com vento de oeste chove depois em 80% das vezes; sem ele, em 20%. Pressão não diz nada. */
function historico(n = 40): SinalDia[] {
  const out: SinalDia[] = [];
  for (let i = 0; i < n; i++) {
    const oeste = i % 2 === 0;
    const chove = oeste ? i % 10 !== 0 : i % 10 === 1;   // oeste: 16 de 20 (80%); não oeste: 4 de 20 (20%)
    out.push({ data: somarDias("2026-09-01", i), oestePct: oeste ? 70 : 10, direcao: oeste ? "W" : "E", pressaoMediaHpa: 1010, pressao24hHpa: i % 8 === 0 || i % 8 === 3 ? -3 : 1, leituras: 100, chuvaDepoisMm: chove ? 8 : 0 });
  }
  return out;
}

test("aprende com a estação: oeste vira fator forte, pressão fica perto de 1; sem histórico vale o palpite", () => {
  const ap = aprenderSinais(historico());
  assert.equal(ap.dias, 40); assert.equal(ap.pesoDado, 1); assert.equal(ap.basePct, 50);
  assert.deepEqual([ap.oeste.com, ap.oeste.comChuva, ap.oeste.sem, ap.oeste.semChuva, ap.oeste.chuvaComPct, ap.oeste.chuvaSemPct], [20, 16, 20, 4, 80, 20]);
  assert.ok(ap.oeste.fator >= 2.5 && ap.oeste.fator <= 3, "oeste " + ap.oeste.fator);
  assert.ok(ap.pressao.fator > 0.7 && ap.pressao.fator < 1.4, "pressão " + ap.pressao.fator);
  const nada = aprenderSinais([]);
  assert.equal(nada.dias, 0); assert.equal(nada.pesoDado, 0); assert.equal(nada.basePct, null);
  assert.equal(nada.oeste.fator, 1.5); assert.equal(nada.pressao.fator, 1.3);
  // com 10 dias, o palpite ainda pesa 75%
  const pouco = aprenderSinais(historico(10));
  assert.equal(pouco.pesoDado, 0.25);
  assert.ok(pouco.oeste.fator > 1.5 && pouco.oeste.fator < 2.2, "10 dias " + pouco.oeste.fator);
  assert.match(textoAprendizado(ap), /^40 dias medidos · vento de oeste: choveu nos 2 dias seguintes em 80% dos 20 dias com o sinal \(20% sem ele\) · pressão caindo: /);
  assert.match(textoAprendizado(nada), /ainda não tem dias suficientes/);
});

test("aplica o sinal de hoje só a amanhã e depois de amanhã, guardando a chance dos modelos", () => {
  const ap = aprenderSinais(historico());
  const dia = (data: string, prob: number | null): DiaPrevisao => ({ data, chuvaMm: 2, probPct: prob, tmax: 30, tmin: 20 } as DiaPrevisao);
  const dias = [dia("2026-11-08", 30), dia("2026-11-09", 50), dia("2026-11-10", 20), dia("2026-11-11", 60), dia("2026-11-12", null)];
  const hoje: SinalDia = { data: "2026-11-08", oestePct: 65, direcao: "W", pressaoMediaHpa: 1008, pressao24hHpa: -2.5, leituras: 120, chuvaDepoisMm: null };
  const r = aplicarSinais(dias, hoje, ap, "2026-11-08", somarDias);
  assert.equal(r[0]!.probPct, 30); assert.equal(r[0]!.sinalEstacao, undefined);   // hoje não muda
  assert.equal(r[3]!.probPct, 60);                                                 // 3 dias à frente também não
  const f = ap.oeste.fator * ap.pressao.fator;
  const esperado = (p: number) => Math.round((100 * (p / (1 - p)) * f) / (1 + (p / (1 - p)) * f));
  assert.equal(r[1]!.probPct, esperado(0.5));
  assert.equal(r[2]!.probPct, esperado(0.2));
  assert.ok(r[1]!.probPct! > 50 && r[1]!.probPct! <= 98);
  assert.deepEqual({ ...r[1]!.sinalEstacao }, { oeste: true, pressaoCai: true, fator: Math.round(f * 100) / 100, probModelosPct: 50 });
  // sem sinal hoje: nada muda
  const calmo: SinalDia = { ...hoje, oestePct: 10, pressao24hHpa: 1 };
  assert.deepEqual(aplicarSinais(dias, calmo, ap, "2026-11-08", somarDias), dias);
  assert.deepEqual(aplicarSinais(dias, null, ap, "2026-11-08", somarDias), dias);
  assert.equal(textoSinalHoje(hoje), "vento de oeste (65% do dia) · pressão -2,5 hPa em 24 h");
  assert.equal(textoSinalHoje(calmo), "");
});

test("completa a chuva dos 2 dias seguintes quando a estação já mediu os dois", () => {
  const hist: SinalDia[] = [{ data: "2026-11-05", oestePct: 50, direcao: "W", pressaoMediaHpa: 1010, pressao24hHpa: 0, leituras: 10, chuvaDepoisMm: null },
    { data: "2026-11-07", oestePct: 50, direcao: "W", pressaoMediaHpa: 1010, pressao24hHpa: 0, leituras: 10, chuvaDepoisMm: null }];
  const chuva = new Map<string, number | null>([["2026-11-06", 3.2], ["2026-11-07", 0], ["2026-11-08", 5]]);
  const r = completarChuvaDepois(hist, chuva, somarDias);
  assert.equal(r[0]!.chuvaDepoisMm, 3.2);
  assert.equal(r[1]!.chuvaDepoisMm, null);   // falta 09/11
});
