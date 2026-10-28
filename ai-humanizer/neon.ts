import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Postgres exists on every Neon branch. Vercel uses NEON_DATABASE_URL;
  // DATABASE_URL from `neon deploy` is supported as a fallback by the SQL driver.
  // Leave production retention and compute settings under the project policy.
});
