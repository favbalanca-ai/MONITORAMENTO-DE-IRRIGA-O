import { existsSync } from "node:fs";
import type { ConfigEcowitt } from "./ecowitt.ts";

export interface ConfigColetor {
  ecowitt: ConfigEcowitt;
  pastaLeituras: string;
}

/** Lê a configuração do ambiente (e do .env, se existir). As chaves nunca ficam no código. */
export function configDoAmbiente(env: NodeJS.ProcessEnv = process.env): ConfigColetor {
  if (env === process.env && existsSync(".env")) process.loadEnvFile(".env");
  const faltando = ["ECOWITT_APPLICATION_KEY", "ECOWITT_API_KEY", "ECOWITT_MAC"].filter((k) => !env[k]);
  if (faltando.length) throw new Error(`Faltam no .env: ${faltando.join(", ")} (ver .env.example)`);
  const grupo = env.ECOWITT_GRUPO_CHUVA;
  if (grupo && grupo !== "rainfall" && grupo !== "rainfall_piezo")
    throw new Error(`ECOWITT_GRUPO_CHUVA inválido: ${grupo} (use rainfall ou rainfall_piezo)`);
  return {
    ecowitt: {
      applicationKey: env.ECOWITT_APPLICATION_KEY!,
      apiKey: env.ECOWITT_API_KEY!,
      mac: env.ECOWITT_MAC!,
      fuso: env.ESTACAO_FUSO || "America/Sao_Paulo",
      grupoChuva: grupo as ConfigEcowitt["grupoChuva"],
    },
    pastaLeituras: env.PASTA_LEITURAS || "dados/leituras",
  };
}
