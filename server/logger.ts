// Structured logging: one JSON object per line, written to standard output
// (warnings and errors to standard error). systemd collects both on the server.

import type { LogLevel } from './config.js';

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogSink = (level: LogLevel, line: string) => void;

const defaultSink: LogSink = (level, line) => {
  if (ORDER[level] >= ORDER.warn) process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
};

function serialise(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

export function createLogger(minLevel: LogLevel, sink: LogSink = defaultSink): Logger {
  const write = (level: LogLevel, message: string, fields: LogFields = {}): void => {
    if (ORDER[level] < ORDER[minLevel]) return;
    const entry: LogFields = { time: new Date().toISOString(), level, message };
    for (const [key, value] of Object.entries(fields)) entry[key] = serialise(value);
    sink(level, JSON.stringify(entry));
  };
  return {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
  };
}
