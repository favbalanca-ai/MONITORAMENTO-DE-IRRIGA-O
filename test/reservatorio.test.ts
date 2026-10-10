import { test } from "node:test";
import assert from "node:assert/strict";
import { balancoReservatorio, retiradaM3 } from "../src/motor/reservatorio.ts";

const piscinao = { nome: "Piscinão 1", volumeUtilM3: 20_000, bombaM3h: 200, horasBombaDia: 10, reservaMinM3: 2_000 };
// dois pivôs de 50 ha, 85 % de eficiência
const pivos = [
  { nome: "Pivô 1", areaHa: 50, eficienciaPct: 85, etcMm: 5, pedidoBrutoMm: 12 },
  { nome: "Pivô 2", areaHa: 50, eficienciaPct: 85, etcMm: 5 },
];

test("retirada bruta: lâmina líquida ÷ eficiência × área", () => {
  assert.equal(Math.round(retiradaM3({ areaHa: 50, eficienciaPct: 85 }, 8.5)), 5000);
});

test("volume hoje = nível lançado + bomba × dias − o que os pivôs puxaram; autonomia com a reposição", () => {
  const b = balancoReservatorio(piscinao, [{ data: "2026-02-05", pct: 60 }], [{ data: "2026-02-06", m3: 3000 }, { data: "2026-02-08", m3: 2000 }], pivos, "2026-02-08");
  // 12.000 + 2.000 × 3 − 5.000 = 13.000 m³ (65 %)
  assert.equal(b.volumeM3, 13000);
  assert.equal(b.pct, 65);
  assert.equal(b.diasDesdeNivel, 3);
  assert.equal(b.reposicaoDiaM3, 2000);
  assert.equal(b.demandaDiaM3, Math.round((5 / 0.85) * 100 * 10)); // 5.882 m³/dia
  // pedido de hoje: 12 mm brutos × 50 ha = 6.000 m³, cabe nos 11.000 disponíveis
  assert.equal(b.pedidoHojeM3, 6000);
  assert.equal(b.cobreHoje, true);
  // saldo −3.882/dia → 11.000 / 3.882 ≈ 2,8 dias → atenção
  assert.equal(b.diasAutonomia, 2.8);
  assert.equal(b.semaforo, "atencao");
  assert.match(b.alertas[0]!, /2,?\.?8 dia/);
});

test("sem nível lançado: só avisa; reposição maior que o consumo: dias até encher", () => {
  const sem = balancoReservatorio(piscinao, [], [], pivos, "2026-02-08");
  assert.equal(sem.volumeM3, null);
  assert.equal(sem.semaforo, "sem");
  assert.equal(sem.cobreHoje, null);
  const folga = balancoReservatorio({ ...piscinao, horasBombaDia: 24 }, [{ data: "2026-02-08", pct: 50 }], [], [{ nome: "Pivô 1", areaHa: 50, eficienciaPct: 85, etcMm: 5 }], "2026-02-08");
  assert.equal(folga.diasAutonomia, null);
  assert.equal(folga.diasAteEncher, Math.round((10000 / (4800 - 2941)) * 10) / 10);
  assert.equal(folga.semaforo, "bom");
});

test("falta água pra hoje e nível velho", () => {
  const b = balancoReservatorio(piscinao, [{ data: "2026-01-20", pct: 20 }], [{ data: "2026-01-25", m3: 45000 }], pivos, "2026-02-08");
  // 4.000 + 2.000 × 19 − 45.000 < 0 → 0 m³ → reserva
  assert.equal(b.volumeM3, 0);
  assert.equal(b.semaforo, "ruim");
  assert.match(b.alertas.join(" "), /há 19 dias/);
  assert.match(b.alertas.join(" "), /reserva/);
  const quase = balancoReservatorio(piscinao, [{ data: "2026-02-08", pct: 20 }], [], pivos, "2026-02-08");
  // 4.000 − 2.000 de reserva = 2.000 disponíveis, pedido 6.000 → faltam 4.000 → 20 h de bomba
  assert.equal(quase.cobreHoje, false);
  assert.equal(quase.faltaHojeM3, 4000);
  assert.equal(quase.horasParaCobrir, 20);
  assert.equal(quase.semaforo, "ruim");
});

test("movimento do dia e projeção com a previsão: consumo = Kc × ET₀ − chuva útil; sugere horas de bomba", () => {
  const prev = [
    { data: "2026-02-09", chuvaMm: 0, probPct: 10, tmin: 19, tmax: 31, et0Mm: 5 },
    { data: "2026-02-10", chuvaMm: 12, probPct: 80, tmin: 19, tmax: 28, et0Mm: 4 },
    { data: "2026-02-11", chuvaMm: 0, probPct: 5, tmin: 19, tmax: 32, et0Mm: 6 },
  ];
  const ps = [{ nome: "Pivô 1", areaHa: 50, eficienciaPct: 100, etcMm: 5, kc: 1.0 }];
  const b = balancoReservatorio(piscinao, [{ data: "2026-02-08", pct: 50 }], [{ data: "2026-02-08", m3: 3000 }], ps, "2026-02-08", prev);
  assert.equal(b.saidaHojeM3, 3000);
  assert.equal(b.entradaHojeM3, 2000);
  assert.equal(b.saldoHojeM3, -1000);
  // 09: 5 mm × 50 ha × 10 = 2.500 m³ → 10.000 + 2.000 − 2.500 = 9.500
  // 10: chuva útil 10 mm cobre os 4 mm → consumo 0 → 11.500
  // 11: 6 mm → 3.000 → 10.500
  assert.deepEqual(b.projecao.map((d) => [d.consumoM3, d.volumeM3]), [[2500, 9500], [0, 11500], [3000, 10500]]);
  assert.equal(b.consumoPrevistoDiaM3, 1833);
  assert.equal(b.chegaNaReservaEm, null);
  assert.equal(b.horasBombaSugeridas, 9.2);
  assert.match(b.sugestao, /10 h\/dia de bomba cobrem o consumo previsto de 1\.833 m³\/dia/);
  // nível baixo e consumo alto: chega na reserva e pede mais bomba
  const seco = balancoReservatorio(piscinao, [{ data: "2026-02-08", pct: 15 }], [], [{ nome: "Pivô 1", areaHa: 100, eficienciaPct: 80, etcMm: 6, kc: 1.2 }], "2026-02-08", prev.map((d) => ({ ...d, chuvaMm: 0 })));
  assert.equal(seco.chegaNaReservaEm, "2026-02-09");
  assert.ok(seco.horasBombaSugeridas! > 10);
  assert.match(seco.sugestao, /a bomba precisa de .* h\/dia \(hoje são 10 h\)[\s\S]*chega na reserva em 09\/02/);
});
