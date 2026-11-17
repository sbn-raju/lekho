type Level = 'info' | 'warn' | 'error' | 'debug';

function log(level: Level, message: string, ...meta: unknown[]): void {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()}: ${message}`;
  const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  out(line, ...meta);
}

export const logger = {
  info: (msg: string, ...meta: unknown[]) => log('info', msg, ...meta),
  warn: (msg: string, ...meta: unknown[]) => log('warn', msg, ...meta),
  error: (msg: string, ...meta: unknown[]) => log('error', msg, ...meta),
  debug: (msg: string, ...meta: unknown[]) => {
    if (process.env.NODE_ENV !== 'production') log('debug', msg, ...meta);
  },
};
