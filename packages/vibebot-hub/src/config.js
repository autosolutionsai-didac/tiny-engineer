import { DEFAULT_PORT } from "./server.js";

export const DEFAULT_ROBOT_URL = "http://tiny-engineer.local";

function envValue(env, ...keys) {
  for (const k of keys) {
    const v = env[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function parsePort(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 65535 ? n : undefined;
}

/** Hub port from VIBEBOT_HUB_PORT, else 17826. */
export function hubPortFromEnv(env = process.env) {
  return parsePort(envValue(env, "VIBEBOT_HUB_PORT")) ?? DEFAULT_PORT;
}

/** Bearer token: VIBEBOT_TOKEN, else TINY_ENGINEER_TOKEN, else null. */
export function tokenFromEnv(env = process.env) {
  return envValue(env, "VIBEBOT_TOKEN", "TINY_ENGINEER_TOKEN") ?? null;
}

/**
 * Parse `vibebot-hub` arguments.
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} [env]
 */
export function parseHubArgs(argv, env = process.env) {
  const out = {
    help: false,
    port: hubPortFromEnv(env),
    robot: envValue(env, "VIBEBOT_URL", "TINY_ENGINEER_URL") ?? DEFAULT_ROBOT_URL,
    token: tokenFromEnv(env),
    clearOnStart: true,
    quiet: false,
    error: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    let value;
    const eq = arg.indexOf("=");
    if (arg.startsWith("--") && eq > 0) {
      value = arg.slice(eq + 1);
      arg = arg.slice(0, eq);
    }
    const next = () => value ?? argv[++i];
    switch (arg) {
      case "-h":
      case "--help":
        out.help = true;
        break;
      case "--port": {
        const p = parsePort(next());
        if (p === undefined) return { ...out, error: "--port needs a number 0-65535" };
        out.port = p;
        break;
      }
      case "--robot": {
        const r = next();
        if (!r || !/^https?:\/\//.test(r)) return { ...out, error: "--robot needs an http(s):// URL" };
        out.robot = r;
        break;
      }
      case "--no-clear":
        out.clearOnStart = false;
        break;
      case "-q":
      case "--quiet":
        out.quiet = true;
        break;
      default:
        return { ...out, error: `Unknown argument: ${argv[i]}` };
    }
  }
  out.robot = out.robot.replace(/\/+$/, "");
  return out;
}
