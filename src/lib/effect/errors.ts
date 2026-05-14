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

export class PayloadTooLargeError extends Data.TaggedError("PayloadTooLargeError")<{
  readonly message: string;
}> {}

export class NotFoundError extends Data.TaggedError("NotFoundError")<{
  readonly message: string;
}> {}

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly message: string;
}> {}

export type IngestError =
  | MissingConfigError
  | UnauthorizedError
  | ValidationError
  | PayloadTooLargeError
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
    case "NotFoundError":
      return 404;
    case "ValidationError":
    case "PayloadTooLargeError":
      return 400;
    case "DatabaseError":
      return 500;
  }
}
