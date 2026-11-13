// A small SMTP client (RFC 5321): hands one finished email to a mail server.
// On the VPS that server is Postfix, listening only on the machine itself;
// Postfix then delivers to the recipient's inbox, retrying if needed.

import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';

export interface SmtpOptions {
  host: string;
  port: number;
  heloName: string;
  user?: string;
  password?: string;
  /** Milliseconds to wait for any answer. */
  timeoutMs?: number;
}

export class SmtpError extends Error {
  override name = 'SmtpError';
  constructor(
    message: string,
    /** The server's reply code, when there was one. 5xx means the email will never be accepted. */
    readonly code: number | null = null,
  ) {
    super(message);
  }
  get permanent(): boolean {
    return this.code !== null && this.code >= 500;
  }
}

const loopback = (host: string): boolean => host === '127.0.0.1' || host === '::1' || host === 'localhost';

/** Reads SMTP replies (one line, or several "250-" lines ending with "250 "). */
class Replies {
  private buffer = '';
  private waiting: Array<(reply: { code: number; text: string }) => void> = [];
  private lines: string[] = [];
  private failure: Error | null = null;
  private failWaiters: Array<(error: Error) => void> = [];

  constructor(private socket: Socket | TLSSocket) {
    this.attach(socket);
  }

  attach(socket: Socket | TLSSocket): void {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => this.onData(chunk));
    socket.on('error', (error) => this.fail(error));
    socket.on('close', () => this.fail(new SmtpError('The mail server closed the connection')));
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let i: number;
    while ((i = this.buffer.indexOf('\r\n')) >= 0) {
      const line = this.buffer.slice(0, i);
      this.buffer = this.buffer.slice(i + 2);
      this.lines.push(line);
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
        const code = Number(line.slice(0, 3));
        const text = this.lines.map((l) => l.slice(4)).join('\n');
        this.lines = [];
        const next = this.waiting.shift();
        this.failWaiters.shift();
        next?.({ code, text });
      }
    }
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    for (const f of this.failWaiters) f(error);
    this.failWaiters = [];
    this.waiting = [];
  }

  next(timeoutMs: number): Promise<{ code: number; text: string }> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new SmtpError('The mail server did not answer in time')), timeoutMs);
      this.waiting.push((r) => {
        clearTimeout(timer);
        resolve(r);
      });
      this.failWaiters.push((e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  }
}

/** Lines starting with a dot get a second dot, so the end-of-message line cannot appear early. */
function dotStuff(message: string): string {
  return message.replace(/\r\n\./g, '\r\n..').replace(/^\./, '..');
}

/** Send one message. Throws SmtpError; `permanent` tells whether trying again could help. */
export async function sendSmtp(options: SmtpOptions, envelope: { from: string; to: string }, message: string): Promise<{ reply: string }> {
  const timeout = options.timeoutMs ?? 30_000;
  const implicitTls = options.port === 465;
  let socket: Socket | TLSSocket = await new Promise((resolve, reject) => {
    const s = implicitTls ? tlsConnect({ host: options.host, port: options.port, servername: options.host }) : netConnect({ host: options.host, port: options.port });
    const timer = setTimeout(() => {
      s.destroy();
      reject(new SmtpError(`Could not reach the mail server at ${options.host}:${options.port}`));
    }, timeout);
    s.once(implicitTls ? 'secureConnect' : 'connect', () => {
      clearTimeout(timer);
      resolve(s);
    });
    s.once('error', (error) => {
      clearTimeout(timer);
      reject(new SmtpError(`Could not reach the mail server: ${error.message}`));
    });
  });
  const replies = new Replies(socket);
  const expect = async (codes: number[], what: string): Promise<string> => {
    const r = await replies.next(timeout);
    if (!codes.includes(r.code)) throw new SmtpError(`The mail server refused ${what}: ${r.code} ${r.text}`, r.code);
    return r.text;
  };
  const say = (line: string): void => {
    socket.write(`${line}\r\n`);
  };
  try {
    await expect([220], 'the connection');
    say(`EHLO ${options.heloName}`);
    let features = await expect([250], 'the greeting');
    const secure = implicitTls;
    let upgraded = false;
    if (!secure && /^STARTTLS$/im.test(features) && !loopback(options.host)) {
      say('STARTTLS');
      await expect([220], 'STARTTLS');
      socket.removeAllListeners('data');
      socket = await new Promise<TLSSocket>((resolve, reject) => {
        const t = tlsConnect({ socket, servername: options.host }, () => resolve(t));
        t.once('error', (error) => reject(new SmtpError(`Could not secure the connection: ${error.message}`)));
      });
      replies.attach(socket);
      upgraded = true;
      say(`EHLO ${options.heloName}`);
      features = await expect([250], 'the greeting');
    }
    if (options.user) {
      // A password is only ever sent over an encrypted connection, or to the machine itself.
      if (!secure && !upgraded && !loopback(options.host)) throw new SmtpError('The mail server does not offer encryption, so the password was not sent');
      say(`AUTH PLAIN ${Buffer.from(`\0${options.user}\0${options.password ?? ''}`).toString('base64')}`);
      await expect([235], 'the login');
    }
    say(`MAIL FROM:<${envelope.from}>`);
    await expect([250], 'the sender');
    say(`RCPT TO:<${envelope.to}>`);
    await expect([250, 251], 'the recipient');
    say('DATA');
    await expect([354], 'the message');
    socket.write(`${dotStuff(message.endsWith('\r\n') ? message : `${message}\r\n`)}.\r\n`);
    const reply = await expect([250], 'the message');
    say('QUIT');
    return { reply };
  } finally {
    socket.end();
    setTimeout(() => socket.destroy(), 1000).unref();
  }
}
