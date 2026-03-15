import { query } from "./client";

/**
 * Gets a configuration value: checks env var first, then falls back to DB app_config table.
 * Returns null if not found in either location.
 */
export async function getConfig(key: string): Promise<string | null> {
  // Env var takes priority
  const envVal = process.env[key];
  if (envVal) return envVal;

  // Fallback to DB
  try {
    const rows = await query<{ value: string }>(
      "SELECT value FROM app_config WHERE key = $1",
      [key]
    );
    return rows[0]?.value ?? null;
  } catch {
    // Table might not exist yet (pre-migration)
    return null;
  }
}
