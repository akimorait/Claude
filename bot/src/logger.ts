const LEVELS = ['error', 'warn', 'info', 'debug'] as const;
export type LogLevel = (typeof LEVELS)[number];

let threshold: number = LEVELS.indexOf('info');

export function setLogLevel(level: LogLevel): void {
  threshold = LEVELS.indexOf(level);
}

function write(level: LogLevel, args: unknown[]): void {
  if (LEVELS.indexOf(level) > threshold) return;
  const line = `${new Date().toISOString()} [${level.toUpperCase().padEnd(5)}]`;
  // eslint-disable-next-line no-console
  (level === 'error' ? console.error : console.log)(line, ...args);
}

export const log = {
  error: (...args: unknown[]) => write('error', args),
  warn: (...args: unknown[]) => write('warn', args),
  info: (...args: unknown[]) => write('info', args),
  debug: (...args: unknown[]) => write('debug', args),
};
