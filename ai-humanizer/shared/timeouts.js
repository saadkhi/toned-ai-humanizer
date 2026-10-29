// Vercel allows 300 seconds for a stage. Reserve up to 15 seconds for the
// shared limiter and 5 seconds for validation/serialization. The browser's
// deadline also allows time to receive the function's response.
export const DEFAULT_MODEL_TIMEOUT_MS = 270000;
export const MAX_MODEL_BUDGET_MS = 280000;
export const API_REQUEST_TIMEOUT_MS = 310000;
