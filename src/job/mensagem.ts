import type { LinhaBalanco } from "../motor/balanco.ts";
import type { DataISO, DiaClima } from "../motor/tipos.ts";
import { diaAnterior } from "../motor/agregacao.ts";
import { avisoChuva, chuvaPrevista, type DiaPrevisao } from "../motor/previsao.ts";

/** Número no formato brasileiro (1.234,5) sem depender do Intl — o Apps Script nem sempre tem pt-BR. */
function br_(x: number, casas: number): string {
  const [int, dec] = Math.abs(x).toFixed(casas).split(".");
  const milhar = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${x < 0 && Number(x.toFixed(casas)) !== 0 ? "-" : ""}${milhar}${dec ? "," + dec : ""}`;
}
const n1 = (x: number) => br_(x, 1);
const n2 = (x: number) => br_(x, 2);
const n0 = (x: number) => br_(x, 0);
const br = (d: DataISO) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

function horas(h: number): string {
  const total = Math.round(h * 60);
  return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, "0")} min`;
}

export interface ItemRelatorio {
  pivo: { nome: string; cultura: { nome: string }; laminaMinimaMm?: number; equipamento?: { raioM: number; anguloGraus: number } };
  linha?: LinhaBalanco;
  /** Últimos 7 dias do balanço (para a tabelinha do relatório). */
  historico?: LinhaBalanco[];
  /** Dias do balanço com clima estimado ou sem dados suficientes. */
  diasIncertos?: number;
  /** Motivo para não ter linha (ex.: plantio no futuro). */
  aviso?: string;
  ultimaIrrigacao?: { data: DataISO; mm: number } | null;
  ultimaMedicao?: { data: DataISO; umidadeRaizPct: number } | null;
  /** Último DAS do ciclo da cultura. */
  fimCicloDas?: number;
}

export type Semaforo = "ruim" | "atencao" | "bom" | "sem";
/** Mesmo semáforo do app: vermelho irrigar, amarelo déficit ≥ 70 % da lâmina mínima, verde ok, cinza sem dados. */
export function semaforoDoItem(it: ItemRelatorio): Semaforo {
  const x = it.linha;
  if (!x || x.decisao === "SEM DADOS") return "sem";
  if (x.decisao === "IRRIGAR") return "ruim";
  const lm = it.pivo.laminaMinimaMm ?? 0;
  return lm > 0 && x.deficit / lm >= 0.7 ? "atencao" : "bom";
}
const SEM_EMOJI: Record<Semaforo, string> = { ruim: "🔴", atencao: "🟡", bom: "🟢", sem: "⚫" };
const SEM_COR: Record<Semaforo, string> = { ruim: "#c62828", atencao: "#f0b429", bom: "#2e7d32", sem: "#9e9e9e" };

const areaHa = (eq?: { raioM: number; anguloGraus: number }) => (eq ? (Math.PI * eq.raioM ** 2 * (eq.anguloGraus / 360)) / 10_000 : 0);

/** Totais do dia: pivôs em cada estado, água e energia das irrigações recomendadas. */
export function resumoDoDia(itens: ItemRelatorio[]) {
  const cont: Record<Semaforo, number> = { ruim: 0, atencao: 0, bom: 0, sem: 0 };
  let aguaM3 = 0, kwh = 0, custo = 0, ha = 0;
  for (const it of itens) {
    cont[semaforoDoItem(it)]++;
    const r = it.linha?.recomendacao;
    if (it.linha?.decisao === "IRRIGAR" && r) {
      const a = areaHa(it.pivo.equipamento);
      aguaM3 += r.laminaBrutaMm * a * 10; // mm × ha × 10 = m³
      ha += a;
      kwh += r.energiaKwh;
      custo += r.custoRs;
    }
  }
  return { cont, aguaM3, kwh, custo, ha };
}

/** Texto do relatório do dia — cabe no WhatsApp, com *negrito* no estilo do WhatsApp. */
export function montarMensagem(
  data: DataISO,
  clima: DiaClima & { et0: number },
  itens: ItemRelatorio[],
  previsao: DiaPrevisao[] = [],
): { assunto: string; texto: string } {
  const irrigar = itens.filter((i) => i.linha?.decisao === "IRRIGAR").length;
  const assunto = `Manejo ${br(data)}: ${irrigar ? `irrigar ${irrigar} pivô(s)` : "nenhum pivô para irrigar"}`;
  const rs = resumoDoDia(itens);
  const l: string[] = [
    `💧 *Manejo de irrigação — ${br(data)}*`,
    `Janela ${br(diaAnterior(data))} 18h → ${br(data)} 18h`,
    `🔴 ${rs.cont.ruim} irrigar · 🟡 ${rs.cont.atencao} atenção · 🟢 ${rs.cont.bom} ok${rs.cont.sem ? ` · ⚫ ${rs.cont.sem} sem dados` : ""}`,
  ];
  if (rs.ha > 0) l.push(`Hoje: ${n0(rs.aguaM3)} m³ de água em ${n1(rs.ha)} ha · ${n0(rs.kwh)} kWh · R$ ${n2(rs.custo)}`);
  l.push(`ET₀ ${n1(clima.et0)} mm · chuva ${n1(clima.chuva)} mm · ${n0(clima.tmin)}–${n0(clima.tmax)} °C · UR ${n0(clima.ur)}% · vento ${n1(clima.vento)} m/s · ${clima.n} de 144 leituras`);
  if (clima.estimados?.length) l.push(`⚠️ Estação sem dado de ${clima.estimados.join(", ")}: valores do dia vizinho.`);
  const prox = previsao.filter((d) => d.data > data).slice(0, 3);
  if (prox.length) {
    const p = chuvaPrevista(previsao, data, 2);
    l.push(
      `🌧 Previsão: ${prox.map((d) => `${br(d.data)} ${d.chuvaMm === null ? "?" : n1(d.chuvaMm)} mm${d.probPct === null ? "" : ` (${n0(d.probPct)}%)`}`).join(" · ")}` +
        ` — ${n1(p.mm)} mm em 2 dias`,
    );
    const r = prox[0]?.resumo;
    if (r) l.push(`   INMET amanhã: ${r}`);
  }

  for (const it of itens) {
    l.push("");
    const x = it.linha;
    if (!x) {
      l.push(`⚫ *${it.pivo.nome}* — ${it.aviso ?? "sem cálculo"}`);
      continue;
    }
    const sem = semaforoDoItem(it);
    const fim = it.fimCicloDas !== undefined ? it.fimCicloDas - x.das : null;
    l.push(`${SEM_EMOJI[sem]} *${it.pivo.nome}* — ${it.pivo.cultura.nome} ${x.estadio}, ${x.das} DAS${fim !== null ? (fim >= 0 ? ` (faltam ${fim} d do ciclo)` : ` (ciclo encerrado há ${-fim} d)`) : ""}`);
    const pctAfd = x.afdMm > 0 ? Math.round((x.deficit / x.afdMm) * 100) : 0;
    if (x.decisao === "IRRIGAR") {
      l.push(`🚿 *IRRIGAR* — repor ${n1(x.deficit)} mm (${pctAfd}% da AFD de ${n1(x.afdMm)} mm)`);
      const chuva = avisoChuva(x.deficit, previsao, data);
      if (chuva) l.push(`   🌧 ${chuva}`);
      const r = x.recomendacao;
      if (r) {
        l.push(`   Percentímetro *${n0(r.percentimetroPct)}%* · volta ${horas(r.tempoVoltaH)} · ${n1(r.laminaBrutaMm)} mm brutos (${n0(r.laminaBrutaMm * areaHa(it.pivo.equipamento) * 10)} m³)`);
        if (r.ponta) l.push(`   Ligar às *${r.ponta.inicioSugerido}* (fora da ponta): ${n0(r.energiaKwh)} kWh · R$ ${n2(r.custoRs)} — no começo da ponta sairia R$ ${n2(r.ponta.custoPiorRs)}`);
        else l.push(`   Energia ${n0(r.energiaKwh)} kWh · R$ ${n2(r.custoRs)}`);
        if (x.projecao?.deficitFimVoltaMm !== undefined) l.push(`   Déficit ao fim da volta ≈ ${n1(x.projecao.deficitFimVoltaMm)} mm`);
        if (r.limitadoPelaLaminaMax) l.push("   ⚠️ Uma volta no percentímetro mínimo não repõe tudo: vai precisar de outra.");
      } else {
        l.push("   (cadastre o equipamento para ter percentímetro, tempo e custo)");
      }
    } else if (x.decisao === "SEM DADOS") {
      l.push(`⛔ *SEM DADOS* — estação com poucas leituras; déficit estimado ${n1(x.deficit)} mm`);
    } else {
      l.push(`✅ NÃO IRRIGAR — déficit ${n1(x.deficit)} mm (${pctAfd}% da AFD; lâmina mínima ${n1(it.pivo.laminaMinimaMm ?? 0)} mm)`);
      const pj = x.projecao;
      if (pj && pj.horizonte > 0) {
        l.push(pj.proximaIrrigacao
          ? `   Próxima irrigação prevista: ${br(pj.proximaIrrigacao)} (em ${pj.emDias} dia${pj.emDias === 1 ? "" : "s"}, sem chuva)`
          : `   Sem irrigação prevista nos próximos ${pj.horizonte} dias (sem chuva)`);
      }
    }
    l.push(`   ETc ${n1(x.etc)} mm (Kc ${n2(x.kc)}) · raiz ${n0(x.raizCm)} cm · CAD ${n1(x.cadMm)} mm${x.irrigacao ? ` · irrigado hoje ${n1(x.irrigacao)} mm` : ""}${x.chuva ? ` · chuva ${n1(x.chuva)} mm` : ""}`);
    const ui = it.ultimaIrrigacao, um = it.ultimaMedicao;
    if (ui || um) l.push(`   ${ui ? `Última irrigação ${br(ui.data)} (${n1(ui.mm)} mm)` : "Sem irrigação lançada"}${um ? ` · última medição ${br(um.data)} (${n0(um.umidadeRaizPct)}%)` : ""}`);
    if (it.historico && it.historico.length > 1) {
      l.push(`   Déficit (mm) nos últimos dias: ${it.historico.map((h) => `${br(h.data)} ${n0(h.deficit)}`).join(" · ")}`);
    }
    for (const a of x.alertas.filter((a) => !a.startsWith("Só ") && !a.startsWith("Clima estimado"))) l.push(`   ⚠️ ${a}`);
    if (it.diasIncertos) l.push(`   ℹ️ ${it.diasIncertos} dia(s) do balanço com clima estimado ou incompleto.`);
  }
  l.push("", "Legenda: 🔴 irrigar · 🟡 déficit chegando na lâmina mínima · 🟢 ok · ⚫ sem dados. Chuva prevista não entra no balanço: só avisa.");
  return { assunto, texto: l.join("\n") };
}

const h = (t: unknown) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Versão em HTML do mesmo relatório, para o e-mail (cores do semáforo e tabelinha por pivô). */
export function montarMensagemHtml(
  data: DataISO,
  clima: DiaClima & { et0: number },
  itens: ItemRelatorio[],
  previsao: DiaPrevisao[] = [],
  linkApp = "",
): string {
  const rs = resumoDoDia(itens);
  const prox = previsao.filter((d) => d.data > data).slice(0, 3);
  const p2 = chuvaPrevista(previsao, data, 2);
  const chip = (txt: string, cor: string) => `<span style="display:inline-block;background:${cor};color:#fff;border-radius:999px;padding:3px 10px;font-weight:700;font-size:12px;margin-right:4px">${txt}</span>`;
  const linha = (rot: string, val: string) => `<tr><td style="padding:3px 8px 3px 0;color:#64757d;white-space:nowrap">${rot}</td><td style="padding:3px 0">${val}</td></tr>`;
  let html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#33474f;max-width:640px;font-size:14px;line-height:1.45">`;
  html += `<h2 style="color:#16404d;margin:0 0 4px">💧 Manejo de irrigação — ${h(br(data))}</h2>`;
  html += `<div style="color:#64757d;font-size:13px;margin-bottom:10px">Janela ${h(br(diaAnterior(data)))} 18h → ${h(br(data))} 18h</div>`;
  html += `<div style="margin-bottom:10px">${chip(`${rs.cont.ruim} irrigar`, SEM_COR.ruim)}${chip(`${rs.cont.atencao} atenção`, SEM_COR.atencao)}${chip(`${rs.cont.bom} ok`, SEM_COR.bom)}${rs.cont.sem ? chip(`${rs.cont.sem} sem dados`, SEM_COR.sem) : ""}</div>`;
  if (rs.ha > 0) html += `<div style="margin-bottom:6px"><b>Hoje:</b> ${n0(rs.aguaM3)} m³ de água em ${n1(rs.ha)} ha · ${n0(rs.kwh)} kWh · R$ ${n2(rs.custo)}</div>`;
  html += `<div style="background:#f4f6f8;border-radius:10px;padding:8px 12px;margin-bottom:10px">ET₀ <b>${n1(clima.et0)}</b> mm · chuva <b>${n1(clima.chuva)}</b> mm · ${n0(clima.tmin)}–${n0(clima.tmax)} °C · UR ${n0(clima.ur)}% · vento ${n1(clima.vento)} m/s · ${clima.n}/144 leituras`;
  if (clima.estimados?.length) html += `<br><span style="color:#b7791f">⚠️ Estação sem dado de ${h(clima.estimados.join(", "))}: valores do dia vizinho.</span>`;
  if (prox.length) html += `<br>🌧 Previsão: ${prox.map((d) => `${h(br(d.data))} <b>${d.chuvaMm === null ? "?" : n1(d.chuvaMm)}</b> mm${d.probPct === null ? "" : ` (${n0(d.probPct)}%)`}`).join(" · ")} — ${n1(p2.mm)} mm em 2 dias${prox[0]?.resumo ? `<br><span style="color:#64757d">INMET amanhã: ${h(prox[0].resumo)}</span>` : ""}`;
  html += `</div>`;
  for (const it of itens) {
    const x = it.linha, sem = semaforoDoItem(it);
    html += `<div style="border:1px solid #e2e8ec;border-left:5px solid ${SEM_COR[sem]};border-radius:10px;padding:10px 12px;margin-bottom:10px">`;
    const fim = it.fimCicloDas !== undefined && x ? it.fimCicloDas - x.das : null;
    html += `<div style="display:flex;justify-content:space-between"><b style="font-size:15px;color:#16404d">${h(it.pivo.nome)}</b>${x ? chip(x.decisao, SEM_COR[sem]) : ""}</div>`;
    if (!x) { html += `<div style="color:#64757d">${h(it.aviso ?? "sem cálculo")}</div></div>`; continue; }
    html += `<div style="color:#64757d;font-size:13px;margin-bottom:6px">${h(it.pivo.cultura.nome)} · ${h(x.estadio)} · ${x.das} DAS${fim !== null ? (fim >= 0 ? ` · faltam ${fim} d do ciclo` : ` · <span style="color:#c62828">ciclo encerrado há ${-fim} d</span>`) : ""}</div>`;
    const pct = x.afdMm > 0 ? Math.min(100, (x.deficit / x.afdMm) * 100) : 0;
    html += `<div style="height:10px;background:#eef2f4;border-radius:6px;overflow:hidden;margin:4px 0"><div style="width:${pct.toFixed(0)}%;height:10px;background:#e65100"></div></div>`;
    html += `<table style="border-collapse:collapse;font-size:13px">`;
    html += linha("Déficit", `<b>${n1(x.deficit)} mm</b> (${Math.round(pct)}% da AFD de ${n1(x.afdMm)} mm; lâmina mínima ${n1(it.pivo.laminaMinimaMm ?? 0)} mm)`);
    const r = x.recomendacao;
    if (x.decisao === "IRRIGAR" && r) {
      html += linha("Ajuste", `Percentímetro <b>${n0(r.percentimetroPct)}%</b> · volta ${h(horas(r.tempoVoltaH))} · ${n1(r.laminaBrutaMm)} mm brutos (${n0(r.laminaBrutaMm * areaHa(it.pivo.equipamento) * 10)} m³)`);
      html += linha("Energia", r.ponta ? `Ligar às <b>${h(r.ponta.inicioSugerido)}</b>: ${n0(r.energiaKwh)} kWh · R$ ${n2(r.custoRs)} (na ponta: R$ ${n2(r.ponta.custoPiorRs)})` : `${n0(r.energiaKwh)} kWh · R$ ${n2(r.custoRs)}`);
      if (x.projecao?.deficitFimVoltaMm !== undefined) html += linha("Fim da volta", `déficit ≈ ${n1(x.projecao.deficitFimVoltaMm)} mm`);
      const chuva = avisoChuva(x.deficit, previsao, data);
      if (chuva) html += linha("Chuva", `🌧 ${h(chuva)}`);
    } else if (x.decisao === "IRRIGAR") html += linha("Ajuste", "cadastre o equipamento para ter percentímetro, tempo e custo");
    else if (x.projecao && x.projecao.horizonte > 0) html += linha("Próxima", x.projecao.proximaIrrigacao ? `${h(br(x.projecao.proximaIrrigacao))} (em ${x.projecao.emDias} dia${x.projecao.emDias === 1 ? "" : "s"}, sem chuva)` : `sem irrigação prevista em ${x.projecao.horizonte} dias (sem chuva)`);
    html += linha("Hoje", `ETc ${n1(x.etc)} mm (Kc ${n2(x.kc)}) · raiz ${n0(x.raizCm)} cm · CAD ${n1(x.cadMm)} mm${x.irrigacao ? ` · irrigado ${n1(x.irrigacao)} mm` : ""}${x.chuva ? ` · chuva ${n1(x.chuva)} mm` : ""}`);
    if (it.ultimaIrrigacao || it.ultimaMedicao) html += linha("Lançamentos", `${it.ultimaIrrigacao ? `última irrigação ${h(br(it.ultimaIrrigacao.data))} (${n1(it.ultimaIrrigacao.mm)} mm)` : "sem irrigação lançada"}${it.ultimaMedicao ? ` · última medição ${h(br(it.ultimaMedicao.data))} (${n0(it.ultimaMedicao.umidadeRaizPct)}%)` : ""}`);
    if (it.historico && it.historico.length > 1) html += linha("Déficit (mm)", it.historico.map((d) => `${h(br(d.data))} <b>${n0(d.deficit)}</b>`).join(" · "));
    html += `</table>`;
    const alertas = x.alertas.filter((a) => !a.startsWith("Só ") && !a.startsWith("Clima estimado"));
    if (alertas.length) html += `<div style="margin-top:6px">${alertas.map((a) => `<div style="background:#fff2cc;color:#7a5200;border-radius:8px;padding:5px 9px;font-size:13px;margin-top:4px">⚠️ ${h(a)}</div>`).join("")}</div>`;
    if (it.diasIncertos) html += `<div style="color:#64757d;font-size:12px;margin-top:4px">ℹ️ ${it.diasIncertos} dia(s) do balanço com clima estimado ou incompleto.</div>`;
    html += `</div>`;
  }
  html += `<div style="color:#64757d;font-size:12px">Legenda: vermelho irrigar · amarelo déficit chegando na lâmina mínima · verde ok · cinza sem dados. Chuva prevista não entra no balanço: só avisa.${linkApp ? ` <a href="${h(linkApp)}" style="color:#2e7d8c">Abrir o app</a>` : ""}</div></div>`;
  return html;
}
