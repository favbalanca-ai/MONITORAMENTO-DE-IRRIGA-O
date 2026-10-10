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
