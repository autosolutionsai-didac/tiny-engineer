import { readFileSync } from "node:fs";
import { join } from "node:path";

// Preferred names first; TINY_ENGINEER_* are deprecated aliases kept so
// existing setups from the upstream project keep working.
export const TOKEN_KEYS = ["VIBEBOT_TOKEN", "TINY_ENGINEER_TOKEN"];
export const URL_KEYS = ["VIBEBOT_URL", "TINY_ENGINEER_URL"];
export const DEFAULT_URL = "http://vibebot.local";

/**
 * Parse one dotenv line into [key, value] or null.
 * @param {string} line
 * @returns {[string, string] | null}
 */
function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const eq = trimmed.indexOf("=");
  if (eq <= 0) return null;

  const key = trimmed.slice(0, eq).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;

  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return [key, value];
}

/**
 * True when `key` (or, for token/URL keys, any of its aliases) is already set.
 * @param {string} key
 */
function alreadySet(key) {
  const group = TOKEN_KEYS.includes(key)
    ? TOKEN_KEYS
    : URL_KEYS.includes(key)
      ? URL_KEYS
      : [key];
  return group.some((k) => process.env[k] !== undefined);
}

/**
 * Load `<dir>/.env` into process.env for keys not already set.
 * Claude Code runs hooks from the session's working directory, which can be a
 * subdirectory, so prefer the project root it exports.
 * Missing file / read errors are ignored.
 * @param {string} [dir]
 */
export function loadDotEnv(dir = process.env.CLAUDE_PROJECT_DIR || process.cwd()) {
  let raw;
  try {
    raw = readFileSync(join(dir, ".env"), "utf8");
  } catch {
    return;
  }

  // A token inherited from the process env must not be sent to a URL that the
  // project's .env picked, so the .env only sets the URL when it isn't.
  const tokenInherited = TOKEN_KEYS.some((k) => Boolean(process.env[k]?.trim()));

  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    if (URL_KEYS.includes(key) && tokenInherited) continue;
    if (!alreadySet(key)) {
      process.env[key] = value;
    }
  }
}

/**
 * @returns {string | null} trimmed VIBEBOT_TOKEN (or deprecated
 *   TINY_ENGINEER_TOKEN), or null if unset/empty
 */
export function getToken() {
  for (const key of TOKEN_KEYS) {
    const trimmed = process.env[key]?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/**
 * @returns {string} VIBEBOT_URL (or deprecated TINY_ENGINEER_URL) without
 *   trailing slashes, or the default
 */
export function getBaseUrl() {
  for (const key of URL_KEYS) {
    const trimmed = process.env[key]?.trim().replace(/\/+$/, "");
    if (trimmed) return trimmed;
  }
  return DEFAULT_URL;
}
