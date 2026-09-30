/**
 * Error envelope of the public API: `{ error: { code, message, details } }`.
 *
 * Handlers throw `ApiError`; the route wrapper turns it into the response.
 * `details` is `null` or an object, e.g. field → message for validation
 * errors. Messages are written for the developer reading them.
 */

export type ApiErrorCode =
  | "api_disabled"
  | "unauthorized"
  | "invalid_api_key"
  | "revoked_api_key"
  | "insufficient_scope"
  | "rate_limited"
  | "invalid_json"
  | "unsupported_media_type"
  | "payload_too_large"
  | "validation_failed"
  | "not_found"
  | "conflict"
  | "forbidden"
  | "internal_error";

export type ApiErrorDetails = Record<string, unknown> | null;

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; details: ApiErrorDetails };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details: ApiErrorDetails;
  readonly headers: Record<string, string>;

  constructor(status: number, code: ApiErrorCode, message: string, details: ApiErrorDetails = null, headers: Record<string, string> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }

  toBody(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

export function validationError(details: Record<string, string>, message = "Some fields are invalid. See details for each one."): ApiError {
  return new ApiError(400, "validation_failed", message, details);
}

/** A single invalid field. */
export function fieldError(field: string, problem: string): ApiError {
  return validationError({ [field]: problem }, `${field}: ${problem}`);
}

export function notFound(resource: string, id?: string): ApiError {
  return new ApiError(404, "not_found", id ? `No ${resource} with id "${id}".` : `${resource} not found.`);
}

export function conflict(message: string, details: ApiErrorDetails = null): ApiError {
  return new ApiError(409, "conflict", message, details);
}

export function forbidden(message: string): ApiError {
  return new ApiError(403, "forbidden", message);
}
