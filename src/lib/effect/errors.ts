import { Data } from "effect";

export class MissingConfigError extends Data.TaggedError("MissingConfigError")<{
  readonly message: string;
}> {}

export class UnauthorizedError extends Data.TaggedError("UnauthorizedError")<{
  readonly message: string;
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly message: string;
}> {}

export class MalformedRequestError extends Data.TaggedError("MalformedRequestError")<{
  readonly message: string;
}> {}

const ConfigurationErrorBase = Data.TaggedError("ConfigurationError")<{
  readonly message: string;
  readonly internalMessage: string;
}>;

export class ConfigurationError extends ConfigurationErrorBase {
  constructor({ message }: { readonly message: string }) {
    super({ message: "Internal server error", internalMessage: message });
  }
}

export class PayloadTooLargeError extends Data.TaggedError("PayloadTooLargeError")<{
  readonly message: string;
}> {}

export class UnsupportedMediaTypeError extends Data.TaggedError("UnsupportedMediaTypeError")<{
  readonly message: string;
}> {}

export class RateLimitError extends Data.TaggedError("RateLimitError")<{
  readonly message: string;
}> {}

export class NotFoundError extends Data.TaggedError("NotFoundError")<{
  readonly message: string;
}> {}

const DatabaseErrorBase = Data.TaggedError("DatabaseError")<{
  readonly message: string;
  readonly internalMessage: string;
}>;

export class DatabaseError extends DatabaseErrorBase {
  constructor({ message }: { readonly message: string }) {
    super({
      message: "Internal server error",
      internalMessage: message,
    });
  }
}

const InternalErrorBase = Data.TaggedError("InternalError")<{
  readonly message: string;
  readonly internalMessage: string;
}>;

export class InternalError extends InternalErrorBase {
  constructor({ message }: { readonly message: string }) {
    super({
      message: "Internal server error",
      internalMessage: message,
    });
  }
}

export type IngestError =
  | MissingConfigError
  | UnauthorizedError
  | ValidationError
  | MalformedRequestError
  | ConfigurationError
  | PayloadTooLargeError
  | UnsupportedMediaTypeError
  | RateLimitError
  | InternalError
  | DatabaseError;

export type QueryError =
  | ValidationError
  | NotFoundError
  | DatabaseError;

export type AppError = IngestError | QueryError;

export function errorStatus(error: AppError): number {
  switch (error._tag) {
    case "MissingConfigError":
      return 503;
    case "UnauthorizedError":
      return 401;
    case "RateLimitError":
      return 429;
    case "UnsupportedMediaTypeError":
      return 415;
    case "NotFoundError":
      return 404;
    case "MalformedRequestError":
      return 400;
    case "ValidationError":
      return 422;
    case "PayloadTooLargeError":
      return 400;
    case "InternalError":
    case "ConfigurationError":
    case "DatabaseError": {
      console.error(JSON.stringify({
        event: "pulsemon.internal_error",
        error_type: error._tag,
        status: 500,
      }));
      return 500;
    }
  }
}
