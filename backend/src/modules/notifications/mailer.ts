import nodemailer, { type Transporter } from 'nodemailer';
import { env, isTest } from '../../config/env.js';
import { logger } from '../../common/utils/logger.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Messages captured in NODE_ENV=test instead of being sent. */
export const testOutbox: MailMessage[] = [];

let transporter: Transporter | undefined;

function getTransporter(): Transporter | undefined {
  if (!env.SMTP_URL) return undefined;
  transporter ??= nodemailer.createTransport(env.SMTP_URL);
  return transporter;
}

export const mailer = {
  async send(message: MailMessage): Promise<void> {
    if (isTest) {
      testOutbox.push(message);
      return;
    }
    const smtp = getTransporter();
    if (smtp) {
      await smtp.sendMail({ from: env.MAIL_FROM, ...message });
      return;
    }
    // Development without SMTP only (env validation forbids this in production). The body contains
    // a one-time link, so this must never be enabled anywhere real users exist.
    logger.warn(`[dev-mail] SMTP_URL not set; printing email instead of sending.\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`);
  },

  /** Sends without blocking the request, so response time doesn't reveal whether an account exists. */
  sendInBackground(message: MailMessage): void {
    this.send(message).catch((err) => logger.error(`Failed to send "${message.subject}" email`, err));
  },
};
