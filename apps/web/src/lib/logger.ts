/**
 * Local diagnostics for application failures. Keep note bodies, filenames,
 * exception messages, and stacks out of console output and future reporters.
 */
export type ErrorAction = 'open' | 'save' | 'create' | 'delete' | 'import' | 'render';
export type ErrorContext = 'route' | 'global' | `workspace.${ErrorAction}`;

export type ErrorCode = 'storage_unavailable' | 'storage_full' | 'invalid_import' | 'unexpected';

export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode) {
    super(`Noor Note error: ${code}`);
    this.name = 'AppError';
    this.code = code;
  }
}

function namedProperty(value: unknown, property: 'name' | 'digest'): string | null {
  if (typeof value !== 'object' || value === null || !(property in value)) return null;
  const candidate = (value as Record<string, unknown>)[property];
  return typeof candidate === 'string' ? candidate : null;
}

export function getErrorCode(error: unknown): ErrorCode {
  if (error instanceof AppError) return error.code;
  switch (namedProperty(error, 'name')) {
    case 'QuotaExceededError':
      return 'storage_full';
    case 'SecurityError':
      return 'storage_unavailable';
    default:
      return 'unexpected';
  }
}

const actionMessages: Record<ErrorAction, string> = {
  open: 'Could not open your local workspace. Check browser storage permissions, then reload Noor Note.',
  save: 'Could not save your note. Please try again and export a backup if the problem continues.',
  create: 'Could not create a note. Please try again.',
  delete: 'Could not delete the note. Please try again.',
  import: 'Import failed. Choose a valid Markdown file, Noor Note ZIP, or JSON backup.',
  render: 'Noor Note could not show this view. Please try again.',
};

export function getUserErrorMessage(error: unknown, action: ErrorAction): string {
  const code = getErrorCode(error);
  if (code === 'storage_full') {
    return 'Your browser storage is full. Free up space, then try again. Export a backup when you can.';
  }
  if (code === 'storage_unavailable') {
    return 'Noor Note cannot access browser storage. Check your browser permissions, then try again.';
  }
  return actionMessages[action];
}

export function logError(context: ErrorContext, error: unknown): void {
  const digest = namedProperty(error, 'digest');
  const diagnostic = {
    source: 'noor-note',
    context,
    code: getErrorCode(error),
    ...(digest && /^[A-Za-z0-9_-]{1,80}$/.test(digest) ? { digest } : {}),
  };
  console.error('[Noor Note]', diagnostic);
}
