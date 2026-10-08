/** Quais tarefas rodam em cada minuto (hora local da estação, "HH:MM"). */
export type Tarefa = "coletar" | "recuperar" | "diario";

export function tarefasDoMinuto(hhmm: string, horaRelatorio: string, relatorioFeitoHoje: boolean): Tarefa[] {
  const min = Number(hhmm.slice(3, 5));
  const t: Tarefa[] = [];
  if (min % 10 === 0) t.push("coletar");
  if (min === 7) t.push("recuperar");
  // ">=" e não "==": se o serviço estava parado às 18:10, o relatório sai assim que ele voltar.
  if (hhmm >= horaRelatorio && !relatorioFeitoHoje) t.push("diario");
  return t;
}
