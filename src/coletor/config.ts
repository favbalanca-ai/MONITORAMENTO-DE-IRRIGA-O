import { existsSync } from "node:fs";
import type { ConfigEcowitt } from "./ecowitt.ts";
import { NotificadorArquivo, NotificadorConsole, NotificadorEmail, type ConfigEmail, type Notificador } from "../job/notificadores.ts";

export interface ConfigApp {
  /** `null` se as chaves da Ecowitt não estiverem no .env. */
  ecowitt: ConfigEcowitt | null;
  banco: string;
  /** Hora local ("HH:MM") em que o serviço roda o relatório. */
  horaRelatorio: string;
  canais: string[];
  email: ConfigEmail | null;
  pastaRelatorios: string;
}

/** Lê a configuração do ambiente (e do .env, se existir). Chaves e senhas nunca ficam no código. */
export function configDoAmbiente(env: NodeJS.ProcessEnv = process.env): ConfigApp {
  if (env === process.env && existsSync(".env")) process.loadEnvFile(".env");
  const grupo = env.ECOWITT_GRUPO_CHUVA;
  if (grupo && grupo !== "rainfall" && grupo !== "rainfall_piezo")
    throw new Error(`ECOWITT_GRUPO_CHUVA inválido: ${grupo} (use rainfall ou rainfall_piezo)`);
  const temEcowitt = env.ECOWITT_APPLICATION_KEY && env.ECOWITT_API_KEY && env.ECOWITT_MAC;
  const hora = env.HORA_RELATORIO || "18:10";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) throw new Error(`HORA_RELATORIO inválida: ${hora} (use HH:MM)`);
  if (hora < "18:00") throw new Error("HORA_RELATORIO precisa ser depois das 18:00, quando a janela do dia fecha.");
  const canais = (env.NOTIFICAR || "console,arquivo").split(",").map((s) => s.trim()).filter(Boolean);
  const temEmail = env.SMTP_HOST && env.SMTP_USUARIO && env.SMTP_SENHA && env.EMAIL_PARA;
  return {
    ecowitt: temEcowitt
      ? {
          applicationKey: env.ECOWITT_APPLICATION_KEY!,
          apiKey: env.ECOWITT_API_KEY!,
          mac: env.ECOWITT_MAC!,
          fuso: env.ESTACAO_FUSO || "America/Sao_Paulo",
          grupoChuva: grupo as ConfigEcowitt["grupoChuva"],
        }
      : null,
    banco: env.BANCO || "dados/manejo.db",
    horaRelatorio: hora,
    canais,
    email: temEmail
      ? {
          host: env.SMTP_HOST!,
          porta: Number(env.SMTP_PORTA || 465),
          usuario: env.SMTP_USUARIO!,
          senha: env.SMTP_SENHA!,
          de: env.EMAIL_DE || env.SMTP_USUARIO!,
          para: env.EMAIL_PARA!,
        }
      : null,
    pastaRelatorios: env.PASTA_RELATORIOS || "dados/relatorios",
  };
}

export function exigirEcowitt(cfg: ConfigApp): ConfigEcowitt {
  if (!cfg.ecowitt) throw new Error("Faltam no .env: ECOWITT_APPLICATION_KEY, ECOWITT_API_KEY e ECOWITT_MAC (ver .env.example)");
  return cfg.ecowitt;
}

export function notificadoresDaConfig(cfg: ConfigApp): Notificador[] {
  return cfg.canais.map((c) => {
    if (c === "console") return new NotificadorConsole();
    if (c === "arquivo") return new NotificadorArquivo(cfg.pastaRelatorios);
    if (c === "email") {
      if (!cfg.email) throw new Error("NOTIFICAR inclui email, mas faltam SMTP_HOST, SMTP_USUARIO, SMTP_SENHA ou EMAIL_PARA no .env.");
      return new NotificadorEmail(cfg.email);
    }
    throw new Error(`Canal desconhecido em NOTIFICAR: ${c} (há: console, arquivo, email)`);
  });
}
