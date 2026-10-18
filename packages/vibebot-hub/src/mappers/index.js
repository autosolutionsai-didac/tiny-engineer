import { mapAntigravity } from "./antigravity.js";
import { mapClaudeCode } from "./claude-code.js";
import { mapCodex } from "./codex.js";
import { mapCursor } from "./cursor.js";
import { mapVibeDeck } from "./vibedeck.js";

/** Hook agents served under POST /hook/<agent>. */
export const HOOK_MAPPERS = {
  "claude-code": mapClaudeCode,
  cursor: mapCursor,
  codex: mapCodex,
  antigravity: mapAntigravity,
};

export { mapAntigravity, mapClaudeCode, mapCodex, mapCursor, mapVibeDeck };
