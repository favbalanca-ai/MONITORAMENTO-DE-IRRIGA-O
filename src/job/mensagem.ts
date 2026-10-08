import type { LinhaBalanco } from "../motor/balanco.ts";
import type { DataISO, DiaClima } from "../motor/tipos.ts";
import { diaAnterior } from "../motor/agregacao.ts";

const n1 = (x: number) => x.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const n2 = (x: number) => x.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n0 = (x: number) => Math.round(x).toLocaleString("pt-BR");
const br = (d: DataISO) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

function horas(h: number): string {
  const total = Math.round(h * 60);
  return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, "0")} min`;
}

export interface ItemRelatorio {
  pivo: { nome: string; cultura: { nome: string } };
  linha?: LinhaBalanco;
  /** Dias do balanço com clima estimado ou sem dados suficientes. */
  diasIncertos?: number;
  /** Motivo para não ter linha (ex.: plantio no futuro). */
  aviso?: string;
}

/** Texto do relatório do dia — curto para caber no WhatsApp, com *negrito* no estilo do WhatsApp. */
export function montarMensagem(data: DataISO, clima: DiaClima & { et0: number }, itens: ItemRelatorio[]): { assunto: string; texto: string } {
  const irrigar = itens.filter((i) => i.linha?.decisao === "IRRIGAR").length;
  const assunto = `Manejo ${br(data)}: ${irrigar ? `irrigar ${irrigar} pivô(s)` : "nenhum pivô para irrigar"}`;
  const l: string[] = [
    `💧 *Manejo de irrigação — ${br(data)}*`,
    `Janela ${br(diaAnterior(data))} 18h → ${br(data)} 18h`,
    `ET₀ ${n1(clima.et0)} mm · chuva ${n1(clima.chuva)} mm · ${clima.n} de 144 leituras`,
  ];
  if (clima.estimados?.length) l.push(`⚠️ Estação sem dado de ${clima.estimados.join(", ")}: valores do dia vizinho.`);

  for (const it of itens) {
    l.push("");
    const x = it.linha;
    if (!x) {
      l.push(`*${it.pivo.nome}* — ${it.aviso ?? "sem cálculo"}`);
      continue;
    }
    l.push(`*${it.pivo.nome}* — ${it.pivo.cultura.nome} ${x.estadio}, ${x.das} DAS`);
    if (x.decisao === "IRRIGAR") {
      l.push(`🚿 *IRRIGAR* — repor ${n1(x.deficit)} mm`);
      const r = x.recomendacao;
      if (r) {
        l.push(`   Percentímetro *${n0(r.percentimetroPct)}%* · volta ${horas(r.tempoVoltaH)} · ${n1(r.laminaBrutaMm)} mm brutos`);
        l.push(`   Energia ${n0(r.energiaKwh)} kWh · R$ ${n2(r.custoRs)}`);
      } else {
        l.push("   (cadastre o equipamento para ter percentímetro, tempo e custo)");
      }
    } else if (x.decisao === "SEM DADOS") {
      l.push(`⛔ *SEM DADOS* — estação com poucas leituras; déficit estimado ${n1(x.deficit)} mm`);
    } else {
      l.push(`✅ NÃO IRRIGAR — déficit ${n1(x.deficit)} mm`);
    }
    l.push(`   ETc ${n1(x.etc)} mm (Kc ${n2(x.kc)}) · AFD ${n1(x.afdMm)} mm${x.irrigacao ? ` · irrigado hoje ${n1(x.irrigacao)} mm` : ""}`);
    for (const a of x.alertas.filter((a) => !a.startsWith("Só ") && !a.startsWith("Clima estimado"))) l.push(`   ⚠️ ${a}`);
    if (it.diasIncertos) l.push(`   ℹ️ ${it.diasIncertos} dia(s) do balanço com clima estimado ou incompleto.`);
  }
  return { assunto, texto: l.join("\n") };
}
