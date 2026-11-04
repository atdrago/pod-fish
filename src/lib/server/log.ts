const SAFE_FIELD_NAMES = ['step', 'status', 'host', 'key', 'durationMs', 'error'] as const;

type SafeFieldName = (typeof SAFE_FIELD_NAMES)[number];
type LogFields = Partial<Record<SafeFieldName, string | number | undefined>>;
type Level = 'info' | 'warn' | 'error';

const isSafeFieldName = (name: string): name is SafeFieldName =>
  SAFE_FIELD_NAMES.some((safeName) => safeName === name);

const emit = (level: Level, event: string, fields: LogFields = {}): void => {
  const safeFields: Record<string, unknown> = {};
  const rejectedFields: string[] = [];

  for (const [name, value] of Object.entries(fields)) {
    if (isSafeFieldName(name)) {
      safeFields[name] = value;
    } else {
      rejectedFields.push(name);
    }
  }

  const line = JSON.stringify({
    event,
    level,
    timestamp: new Date().toISOString(),
    ...safeFields,
    ...(rejectedFields.length > 0 ? { rejectedFields } : {})
  });

  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
};

export const log = {
  error: (event: string, fields?: LogFields): void => {
    emit('error', event, fields);
  },
  info: (event: string, fields?: LogFields): void => {
    emit('info', event, fields);
  },
  warn: (event: string, fields?: LogFields): void => {
    emit('warn', event, fields);
  }
};

export const errMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
