import { env, isTest } from '../../config/env.js';
import { randomToken, sha256 } from '../../common/utils/crypto.js';
import { logger } from '../../common/utils/logger.js';
import { mailer } from '../notifications/mailer.js';
import { OrganizationModel } from '../organizations/organization.model.js';
import { UserModel } from '../users/user.model.js';
import { InvitationModel } from './invitation.model.js';

const MAX_ATTEMPTS = 5;
const LOCK_MS = 2 * 60_000;
const POLL_MS = 10_000;
const BATCH = 20;

/**
 * Background delivery of invitation emails (FRD §5.3: MongoDB and email don't share a
 * transaction). Invitations are committed as `queued`; this worker claims them with an atomic
 * lock, mints a fresh token, emails it, and retries failures with exponential backoff. A crashed
 * worker's lock expires and the job is picked up again, so delivery is at-least-once.
 *
 * In-process for now. With several API instances the atomic claim keeps them from double-sending;
 * move it to a dedicated worker process when email volume grows.
 */
async function claimNext() {
  const now = new Date();
  return InvitationModel.findOneAndUpdate(
    {
      status: 'pending',
      expiresAt: { $gt: now },
      $or: [
        { 'delivery.status': { $in: ['queued', 'retrying'] }, 'delivery.nextAttemptAt': { $lte: now } },
        { 'delivery.status': 'sending', 'delivery.lockedUntil': { $lte: now } },
      ],
    },
    {
      $set: { 'delivery.status': 'sending', 'delivery.lockedUntil': new Date(now.getTime() + LOCK_MS) },
      $inc: { 'delivery.attempts': 1 },
    },
    { sort: { 'delivery.nextAttemptAt': 1 }, returnDocument: 'after' },
  );
}

async function deliver(invitation: NonNullable<Awaited<ReturnType<typeof claimNext>>>) {
  const token = randomToken();
  // Rotating the hash here invalidates the link from any earlier email for this invitation.
  await InvitationModel.updateOne({ _id: invitation._id, status: 'pending' }, { $set: { tokenHash: sha256(token) } });

  const [org, inviter, invitee] = await Promise.all([
    OrganizationModel.findById(invitation.organizationId, { name: 1 }).lean(),
    UserModel.findById(invitation.invitedBy, { firstName: 1, lastName: 1 }).lean(),
    UserModel.findById(invitation.userId, { firstName: 1 }).lean(),
  ]);
  const orgName = org?.name ?? 'a school';
  const from = inviter ? `${inviter.firstName} ${inviter.lastName}` : 'The Lekho team';
  const url = `${env.APP_URL.replace(/\/$/, '')}/invitations/accept?token=${encodeURIComponent(token)}`;
  const role = invitation.purpose === 'initial_admin' ? ' as its School Admin' : '';

  await mailer.send({
    to: invitation.email,
    subject: `You're invited to join ${orgName} on Lekho`,
    text: `Hi ${invitee?.firstName ?? 'there'},\n\n${from} has invited you to join ${orgName} on Lekho${role}.\n\nAccept the invitation:\n\n${url}\n\nThis invitation expires on ${invitation.expiresAt.toUTCString()}. If you weren't expecting it, you can ignore this email.`,
  });
}

let timer: NodeJS.Timeout | undefined;
let running: Promise<number> | undefined;

export const invitationDelivery = {
  /** Processes due deliveries. Returns how many were attempted. Safe to call concurrently. */
  async runOnce(): Promise<number> {
    if (running) return running;
    running = (async () => {
      await InvitationModel.updateMany({ status: 'pending', expiresAt: { $lte: new Date() } }, { $set: { status: 'expired' } });
      let processed = 0;
      for (; processed < BATCH; processed++) {
        const invitation = await claimNext();
        if (!invitation) break;
        try {
          await deliver(invitation);
          await InvitationModel.updateOne(
            { _id: invitation._id },
            { $set: { 'delivery.status': 'sent', 'delivery.sentAt': new Date() }, $unset: { 'delivery.lockedUntil': 1, 'delivery.lastError': 1 } },
          );
        } catch (err) {
          const attempts = invitation.delivery?.attempts ?? 1;
          const giveUp = attempts >= MAX_ATTEMPTS;
          await InvitationModel.updateOne(
            { _id: invitation._id },
            {
              $set: {
                'delivery.status': giveUp ? 'failed' : 'retrying',
                'delivery.nextAttemptAt': new Date(Date.now() + 2 ** attempts * 60_000),
                'delivery.lastError': err instanceof Error ? err.message.slice(0, 500) : 'Unknown error',
              },
              $unset: { 'delivery.lockedUntil': 1 },
            },
          );
          logger.error(`Invitation ${invitation._id} delivery attempt ${attempts} failed${giveUp ? '; giving up' : ''}`, err);
        }
      }
      return processed;
    })().finally(() => {
      running = undefined;
    });
    return running;
  },

  start(): void {
    if (timer || isTest) return;
    timer = setInterval(() => void this.runOnce().catch((err) => logger.error('Invitation worker failed', err)), POLL_MS);
    timer.unref();
    void this.runOnce().catch((err) => logger.error('Invitation worker failed', err));
  },

  stop(): void {
    clearInterval(timer);
    timer = undefined;
  },

  /** Nudge after queuing so the email goes out now rather than on the next poll. No-op in tests. */
  trigger(): void {
    if (!timer) return;
    setImmediate(() => void this.runOnce().catch((err) => logger.error('Invitation worker failed', err)));
  },
};
