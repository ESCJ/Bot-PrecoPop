export class AppError extends Error {
  readonly code: string;
  readonly userMessage: string;

  constructor(code: string, userMessage: string, message?: string) {
    super(message ?? userMessage);
    this.name = new.target.name;
    this.code = code;
    this.userMessage = userMessage;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(userMessage: string, message?: string) {
    super("VALIDATION", userMessage, message);
  }
}

export class NotFoundError extends AppError {
  constructor(userMessage: string, message?: string) {
    super("NOT_FOUND", userMessage, message);
  }
}

export class ConflictError extends AppError {
  constructor(userMessage: string, message?: string) {
    super("CONFLICT", userMessage, message);
  }
}

export class OutOfStockError extends ConflictError {
  constructor(userMessage: string, message?: string) {
    super(userMessage, message);
  }
}

export class PaymentError extends AppError {
  constructor(userMessage: string, message?: string) {
    super("PAYMENT", userMessage, message);
  }
}

export class ExternalServiceError extends AppError {
  constructor(userMessage: string, message?: string) {
    super("EXTERNAL_SERVICE", userMessage, message);
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
