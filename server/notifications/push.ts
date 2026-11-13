// App push notifications, sent straight to Apple (APNs, over HTTP/2) and
// Google (Firebase Cloud Messaging HTTP v1). Both are free. No SDKs: each
// needs only a signed token and one request per phone.

import { createPrivateKey, sign } from 'node:crypto';
import { connect, type ClientHttp2Session } from 'node:http2';

export interface PushMessage {
  title: string;
  body: string;
  /** Where the app opens when the notification is tapped, such as /orders/HBD-10001. */
  link?: string;
}

export type PushResult = 'sent' | 'invalid_token' | 'failed';

export interface PushSender {
  platform: 'ios' | 'android';
  configured: boolean;
  send(token: string, message: PushMessage): Promise<{ result: PushResult; detail?: string }>;
}

const b64url = (data: Buffer | string): string => Buffer.from(data).toString('base64url');

function jwt(header: Record<string, unknown>, claims: Record<string, unknown>, key: string, algorithm: 'ES256' | 'RS256'): string {
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const privateKey = createPrivateKey(key);
  const signature = algorithm === 'ES256' ? sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' }) : sign('sha256', Buffer.from(input), privateKey);
  return `${input}.${b64url(signature)}`;
}

// ----- Apple -----

export function apns(options: { keyId: string; teamId: string; privateKey: string; bundleId: string; url: string }, now: () => Date = () => new Date()): PushSender & { close(): void } {
  const configured = options.keyId !== '' && options.teamId !== '' && options.privateKey !== '';
  let token: { value: string; at: number } | null = null;
  let session: ClientHttp2Session | null = null;
  const bearer = (): string => {
    // Apple wants a fresh token at least every hour, and not more than every 20 minutes.
    const at = now().getTime();
    if (!token || at - token.at > 40 * 60_000) token = { value: jwt({ alg: 'ES256', kid: options.keyId }, { iss: options.teamId, iat: Math.floor(at / 1000) }, options.privateKey, 'ES256'), at };
    return token.value;
  };
  const connection = (): ClientHttp2Session => {
    if (!session || session.closed || session.destroyed) {
      session = connect(options.url);
      session.on('error', () => {
        session = null;
      });
      session.unref();
    }
    return session;
  };
  return {
    platform: 'ios',
    configured,
    async send(deviceToken, message) {
      if (!configured) return { result: 'failed', detail: 'APNs is not set up' };
      if (!/^[0-9a-fA-F]{32,200}$/.test(deviceToken)) return { result: 'invalid_token', detail: 'Not an Apple device token' };
      const body = JSON.stringify({ aps: { alert: { title: message.title, body: message.body }, sound: 'default' }, ...(message.link ? { link: message.link } : {}) });
      return new Promise((resolve) => {
        const req = connection().request({
          ':method': 'POST',
          ':path': `/3/device/${deviceToken}`,
          authorization: `bearer ${bearer()}`,
          'apns-topic': options.bundleId,
          'apns-push-type': 'alert',
          'apns-priority': '10',
          'content-type': 'application/json',
        });
        let status = 0;
        let text = '';
        const timer = setTimeout(() => {
          req.close();
          resolve({ result: 'failed', detail: 'Apple did not answer in time' });
        }, 15_000);
        req.setEncoding('utf8');
        req.on('response', (headers) => {
          status = Number(headers[':status']);
        });
        req.on('data', (chunk: string) => {
          text += chunk;
        });
        req.on('end', () => {
          clearTimeout(timer);
          if (status === 200) return resolve({ result: 'sent' });
          let reason = '';
          try {
            reason = String((JSON.parse(text) as { reason?: string }).reason ?? '');
          } catch {
            // no body
          }
          // The phone uninstalled the app, or the token is not for our app.
          if (status === 410 || ['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic'].includes(reason)) return resolve({ result: 'invalid_token', detail: reason || String(status) });
          resolve({ result: 'failed', detail: `${status} ${reason}`.trim() });
        });
        req.on('error', (error) => {
          clearTimeout(timer);
          resolve({ result: 'failed', detail: error.message });
        });
        req.end(body);
      });
    },
    close() {
      session?.close();
    },
  };
}

// ----- Google -----

export function fcm(options: { projectId: string; clientEmail: string; privateKey: string; apiUrl: string; tokenUrl: string }, now: () => Date = () => new Date()): PushSender {
  const configured = options.projectId !== '' && options.clientEmail !== '' && options.privateKey !== '';
  let access: { value: string; until: number } | null = null;
  const bearer = async (): Promise<string> => {
    const at = now().getTime();
    if (access && access.until > at) return access.value;
    const iat = Math.floor(at / 1000);
    const assertion = jwt({ alg: 'RS256', typ: 'JWT' }, { iss: options.clientEmail, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: options.tokenUrl, iat, exp: iat + 3600 }, options.privateKey, 'RS256');
    const response = await fetch(options.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!response.ok || !body.access_token) throw new Error(`Google refused the push login (${response.status})`);
    access = { value: body.access_token, until: at + Math.max(60, (body.expires_in ?? 3600) - 120) * 1000 };
    return access.value;
  };
  return {
    platform: 'android',
    configured,
    async send(deviceToken, message) {
      if (!configured) return { result: 'failed', detail: 'Firebase is not set up' };
      try {
        const response = await fetch(`${options.apiUrl}/v1/projects/${encodeURIComponent(options.projectId)}/messages:send`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${await bearer()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: { token: deviceToken, notification: { title: message.title, body: message.body }, ...(message.link ? { data: { link: message.link } } : {}), android: { priority: 'high' } } }),
          signal: AbortSignal.timeout(15_000),
        });
        if (response.ok) return { result: 'sent' };
        const body = (await response.json().catch(() => ({}))) as { error?: { status?: string; message?: string; details?: Array<{ errorCode?: string }> } };
        const code = body.error?.details?.find((d) => d.errorCode)?.errorCode ?? body.error?.status ?? '';
        if (response.status === 404 || code === 'UNREGISTERED' || (response.status === 400 && code === 'INVALID_ARGUMENT')) return { result: 'invalid_token', detail: code || String(response.status) };
        return { result: 'failed', detail: `${response.status} ${code}`.trim() };
      } catch (error) {
        return { result: 'failed', detail: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
