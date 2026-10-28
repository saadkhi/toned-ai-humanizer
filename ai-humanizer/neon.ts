import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Postgres exists on every Neon branch. This app uses DATABASE_URL from
  // `neon deploy` in its existing Vercel handlers via the serverless SQL driver.
  // Leave production retention and compute settings under the project policy.
});
