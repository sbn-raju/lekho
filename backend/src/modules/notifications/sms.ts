import { env, isProduction, isTest } from '../../config/env.js';
import { logger } from '../../common/utils/logger.js';
import { ApiError } from '../../common/errors/ApiError.js';

export interface SmsMessage {
  /** E.164, e.g. +919876543210. */
  to: string;
  text: string;
}

/** Messages captured in NODE_ENV=test instead of being sent. */
export const testSmsOutbox: SmsMessage[] = [];

async function sendTwilio(message: SmsMessage) {
  const sid = env.TWILIO_ACCOUNT_SID!;
  const from = env.TWILIO_FROM!;
  const body = new URLSearchParams({ To: message.to, Body: message.text, ...(from.startsWith('MG') ? { MessagingServiceSid: from } : { From: from }) });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    // Never log the message body: it carries the OTP.
    logger.error(`SMS provider rejected a message (HTTP ${res.status})`);
    throw new ApiError('SERVICE_UNAVAILABLE', 'The SMS could not be sent. Please try again shortly.');
  }
}

/**
 * Outbound SMS. Messages may contain one-time codes, so their text is never written to logs,
 * except by the `console` provider, which env validation forbids in production.
 */
export const sms = {
  async send(message: SmsMessage): Promise<void> {
    if (isTest) {
      testSmsOutbox.push(message);
      return;
    }
    if (env.SMS_PROVIDER === 'twilio') return sendTwilio(message);
    if (isProduction) throw new ApiError('SERVICE_UNAVAILABLE', 'SMS is not configured.');
    logger.warn(`[dev-sms] SMS_PROVIDER=console; printing SMS instead of sending.\nTo: ${message.to}\n${message.text}`);
  },
};
