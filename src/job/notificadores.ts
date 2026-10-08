import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import nodemailer from "nodemailer";
import type { DataISO } from "../motor/tipos.ts";

export interface Notificador {
  /** Nome do canal (usado para não enviar duas vezes no mesmo dia). */
  readonly canal: string;
  enviar(data: DataISO, assunto: string, texto: string): Promise<void>;
}

export class NotificadorConsole implements Notificador {
  readonly canal = "console";
  async enviar(_data: DataISO, assunto: string, texto: string) {
    console.log(`\n=== ${assunto} ===\n${texto}\n`);
  }
}

/** Grava o relatório em `pasta/AAAA-MM-DD.txt` — útil como histórico e para conferir. */
export class NotificadorArquivo implements Notificador {
  readonly canal = "arquivo";
  private readonly pasta: string;
  constructor(pasta: string) {
    this.pasta = pasta;
  }
  async enviar(data: DataISO, assunto: string, texto: string) {
    await mkdir(this.pasta, { recursive: true });
    await writeFile(join(this.pasta, `${data}.txt`), `${assunto}\n\n${texto}\n`);
  }
}

export interface ConfigEmail {
  host: string;
  porta: number;
  usuario: string;
  senha: string;
  de: string;
  /** Destinatários separados por vírgula. */
  para: string;
}

/** E-mail por SMTP. Para Gmail: smtp.gmail.com, porta 465, senha de app (não a senha da conta). */
export class NotificadorEmail implements Notificador {
  readonly canal = "email";
  private readonly cfg: ConfigEmail;
  constructor(cfg: ConfigEmail) {
    this.cfg = cfg;
  }
  async enviar(_data: DataISO, assunto: string, texto: string) {
    const t = nodemailer.createTransport({
      host: this.cfg.host,
      port: this.cfg.porta,
      secure: this.cfg.porta === 465,
      auth: { user: this.cfg.usuario, pass: this.cfg.senha },
    });
    await t.sendMail({ from: this.cfg.de, to: this.cfg.para, subject: assunto, text: texto.replace(/\*/g, "") });
  }
}
