import { z } from "zod";

/**
 * Environment validation. (Spec §33.)
 *
 * The app must boot in fully-mocked demo mode when optional credentials are
 * missing, so every third-party key is optional. Only the app URL has a default.
 * `hasX` flags below let services decide mock-vs-live without re-reading env.
 *
 * Server-only secrets (never exposed to the browser): SUPABASE_SERVICE_ROLE_KEY,
 * OPENAI_API_KEY, ELEVENLABS_API_KEY, TAVILY_API_KEY, GOOGLE_PLACES_API_KEY.
 */
const boolish = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const EnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  DEMO_MODE: boolish,

  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),

  ELEVENLABS_API_KEY: z.string().optional(),

  TAVILY_API_KEY: z.string().optional(),
  GOOGLE_PLACES_API_KEY: z.string().optional(),

  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(15),
  DEFAULT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/** Parse & cache process.env. Throws a readable error on invalid config. */
export function getEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Capability flags — services use these to pick mock vs live adapters. */
export function capabilities(env: Env = getEnv()) {
  return {
    hasSupabase: Boolean(
      env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
    ),
    hasOpenAI: Boolean(env.OPENAI_API_KEY),
    hasElevenLabs: Boolean(env.ELEVENLABS_API_KEY),
    hasTavily: Boolean(env.TAVILY_API_KEY),
    hasGooglePlaces: Boolean(env.GOOGLE_PLACES_API_KEY),
    demoMode: env.DEMO_MODE,
  };
}

/** Test-only: clear the memoized env (so tests can re-parse a fresh source). */
export function resetEnvCache(): void {
  cached = null;
}
