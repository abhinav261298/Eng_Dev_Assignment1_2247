/** Common exception pattern for the POC: coded errors with meaningful messages. */
export class PocError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PocError';
    this.code = code;
  }
}

export const invalidParam = (message: string): PocError => new PocError('INVALID_PARAM', message);
export const notFound = (message: string): PocError => new PocError('NOT_FOUND', message);
