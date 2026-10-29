// Vercel allows 300 seconds for a stage. Leave room for the shared limiter,
// response validation and serialization, then let the browser receive errors.
export const DEFAULT_MODEL_TIMEOUT_MS = 240000;
export const MAX_MODEL_BUDGET_MS = 270000;
export const API_REQUEST_TIMEOUT_MS = 310000;
