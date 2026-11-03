/**
 * Debugger results name the app their call reached: `deviceName`, `appName` and
 * `logicalDeviceId` on the JSON results, and a `[device: … | app: … | logicalDeviceId: …]`
 * first line on `debugger-component-tree`. The tool-server sends them on every call, about
 * 90 tokens each time, and they almost always repeat what the agent already knows.
 *
 * They carry news in one case: a call that reached a different app than before. A
 * `device_id` that matches no Metro target falls back to the only app on that Metro, so
 * once the agent's own app is gone (quit, crashed, never attached), a call with its UDID
 * runs in, or reloads, another device's app. The identity is the agent's only sign.
 *
 * So, per MCP session, the agent sees the identity on the first call for a port and
 * `device_id`, and again whenever it differs from the one it saw last for them.
 * `debugger-connect` and `debugger-status` always show it, as asking which app is attached
 * is what they are for. The tool-server result is unchanged: SDK and HTTP callers still get
 * the fields on every call.
 */

const IDENTITY_KEYS = ["deviceName", "appName", "logicalDeviceId"] as const;

/** Tools that always show the identity, and record it as seen. */
const SHOWS_IDENTITY = new Set(["debugger-connect", "debugger-status"]);

/** Tools whose identity is left out when the agent already saw it for the same target. */
const REPEATS_IDENTITY = new Set([
  "debugger-evaluate",
  "debugger-log-registry",
  "debugger-reload-metro",
  "debugger-inspect-element",
  "debugger-component-tree",
]);

/** debugger-component-tree's first line (see its execute in the tool-server). */
const TREE_IDENTITY_LINE = /^\[device: (.*?) \| app: (.*?)(?: \| logicalDeviceId: (\S+))?\]\n/;

export interface DebuggerIdentityMemo {
  /**
   * The result to render for this call: the tool-server's own, or a copy without an
   * identity the agent has already seen for this port and `device_id`. Records the
   * identity either way. `toolId` must be canonical.
   */
  forAgent(toolId: string, args: unknown, result: unknown): unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The target a call names. Undefined without a `device_id`, which leaves the result as it is. */
function targetKey(args: unknown): string | undefined {
  if (!isRecord(args) || typeof args.device_id !== "string" || args.device_id === "") {
    return undefined;
  }
  // `port` is coerced to a number by the tool-server, so "8081" and 8081 are one target.
  const port =
    typeof args.port === "number" || typeof args.port === "string" ? String(args.port) : "";
  return `${port}|${args.device_id}`;
}

export function createDebuggerIdentityMemo(): DebuggerIdentityMemo {
  const lastSeen = new Map<string, string>();

  /** Whether `identity` is the one last seen for `key`. Records it as the last one. */
  function seenBefore(key: string, identity: string): boolean {
    const before = lastSeen.get(key);
    lastSeen.set(key, identity);
    return before === identity;
  }

  return {
    forAgent(toolId, args, result) {
      const shows = SHOWS_IDENTITY.has(toolId);
      if (!shows && !REPEATS_IDENTITY.has(toolId)) return result;
      const key = targetKey(args);
      if (key === undefined) return result;

      if (typeof result === "string") {
        const line = toolId === "debugger-component-tree" && TREE_IDENTITY_LINE.exec(result);
        if (!line) return result;
        const identity = JSON.stringify([line[1], line[2], line[3] ?? null]);
        return seenBefore(key, identity) ? result.slice(line[0].length) : result;
      }

      // A not-connected result, or an older tool-server's, names no app: nothing to record.
      if (!isRecord(result) || typeof result.deviceName !== "string") return result;
      const identity = JSON.stringify(IDENTITY_KEYS.map((k) => result[k] ?? null));
      if (!seenBefore(key, identity) || shows) return result;

      const rest: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(result)) {
        if (!(IDENTITY_KEYS as readonly string[]).includes(k)) rest[k] = v;
      }
      return rest;
    },
  };
}
