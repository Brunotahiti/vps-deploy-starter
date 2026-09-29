export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const notFound = (what = "Ressource") => new ApiError(404, "NOT_FOUND", `${what} introuvable`);
export const badRequest = (message: string, details?: unknown) => new ApiError(400, "BAD_REQUEST", message, details);
export const conflict = (message: string, details?: unknown) => new ApiError(409, "CONFLICT", message, details);
export const forbidden = (message = "Accès refusé") => new ApiError(403, "FORBIDDEN", message);
