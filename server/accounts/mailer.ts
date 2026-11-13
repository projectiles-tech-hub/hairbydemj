// Emails that accounts need to send. Sending itself is built in module 11
// (Notifications); until then each email is put in the jobs table, where the
// worker will pick it up.

import type { Db } from '../db/pool.js';
import type { Logger } from '../logger.js';

export type EmailTemplate = 'verify_email' | 'reset_password' | 'password_changed' | 'staff_invite' | 'order_confirmation' | 'order_cancelled' | 'return_update' | 'store_credit' | 'abandoned_cart' | 'back_in_stock' | 'low_stock' | 'gift_card' | 'review_reply' | 'chat_reply';

export interface Email {
  to: string;
  template: EmailTemplate;
  data: Record<string, string>;
}

export interface Mailer {
  send(email: Email): Promise<void>;
}

/** Puts each email in the jobs table. In development it is also logged, so codes and links can be read without an inbox. */
export function queueMailer(db: Db, logger: Logger, development: boolean): Mailer {
  return {
    async send(email) {
      await db.query("insert into jobs (kind, payload) values ('email.send', $1)", [JSON.stringify(email)]);
      if (development) logger.info('email queued (shown in development only)', { to: email.to, template: email.template, data: email.data });
    },
  };
}

/** Keeps emails in memory, for tests. */
export function memoryMailer(): Mailer & { sent: Email[]; last(template: EmailTemplate, to?: string): Email } {
  const sent: Email[] = [];
  return {
    sent,
    async send(email) {
      sent.push(email);
    },
    last(template, to) {
      const found = [...sent].reverse().find((e) => e.template === template && (to === undefined || e.to === to));
      if (!found) throw new Error(`No ${template} email was sent${to ? ' to ' + to : ''}`);
      return found;
    },
  };
}
