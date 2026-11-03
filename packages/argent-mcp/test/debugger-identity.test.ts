import { describe, it, expect } from "vitest";
import { createDebuggerIdentityMemo } from "../src/debugger-identity.js";

const UDID = "A6E8155E-68DB-44A9-AE17-6E7B2ECA1825";
const IOS = {
  deviceName: "ab-debloat-iphone",
  appName: "xyz.blueskyweb.app (ab-debloat-iphone)",
  logicalDeviceId: "d6a55bcb4bb19064d8f0d6899df3305dde03b943",
};
const ANDROID = {
  deviceName: "sdk_gphone64_arm64 - 17 - API 37",
  appName: "xyz.blueskyweb.app (Google sdk_gphone64_arm64)",
  logicalDeviceId: "624ba0589f2dd6b3dd9bb7e9e0bd8c4f1315c95d",
};
const args = { device_id: UDID };

function treeOf(id: typeof IOS, body = "Screen: 402x874\n\nProvider (tap: 1.00,0.12)"): string {
  return `[device: ${id.deviceName} | app: ${id.appName} | logicalDeviceId: ${id.logicalDeviceId}]\n${body}`;
}

describe("createDebuggerIdentityMemo", () => {
  it("shows the identity on the first call for a target, and leaves it out after", () => {
    const memo = createDebuggerIdentityMemo();

    expect(memo.forAgent("debugger-evaluate", args, { result: 2, ...IOS })).toEqual({
      result: 2,
      ...IOS,
    });
    expect(memo.forAgent("debugger-evaluate", args, { result: 3, ...IOS })).toEqual({
      result: 3,
    });
    expect(
      memo.forAgent("debugger-reload-metro", args, {
        reloaded: true,
        port: 8081,
        method: "cdp",
        ...IOS,
      })
    ).toEqual({ reloaded: true, port: 8081, method: "cdp" });
  });

  it("shows the identity again when the same target reaches a different app", () => {
    const memo = createDebuggerIdentityMemo();
    memo.forAgent("debugger-evaluate", args, { result: "iOS", ...IOS });

    // The iOS app quit; the only app left on Metro is the Android one.
    expect(memo.forAgent("debugger-evaluate", args, { result: "Android", ...ANDROID })).toEqual({
      result: "Android",
      ...ANDROID,
    });
    expect(memo.forAgent("debugger-evaluate", args, { result: 2, ...ANDROID })).toEqual({
      result: 2,
    });
  });

  it("always shows the identity on debugger-connect and debugger-status, and counts it as seen", () => {
    const memo = createDebuggerIdentityMemo();
    const connected = { port: 8081, connected: true, ...IOS };

    expect(memo.forAgent("debugger-connect", args, connected)).toEqual(connected);
    expect(memo.forAgent("debugger-connect", args, connected)).toEqual(connected);
    expect(memo.forAgent("debugger-evaluate", args, { result: 2, ...IOS })).toEqual({ result: 2 });
    expect(memo.forAgent("debugger-status", args, { status: "connected", ...IOS })).toEqual({
      status: "connected",
      ...IOS,
    });
  });

  it("keeps targets apart by device_id and by port", () => {
    const memo = createDebuggerIdentityMemo();
    memo.forAgent("debugger-evaluate", args, { result: 2, ...IOS });

    expect(memo.forAgent("debugger-evaluate", { device_id: "emulator-5554" }, IOS)).toEqual(IOS);
    expect(memo.forAgent("debugger-evaluate", { device_id: UDID, port: 8082 }, IOS)).toEqual(IOS);
    // A port the tool-server coerces names the same target as the number.
    expect(memo.forAgent("debugger-evaluate", { device_id: UDID, port: "8082" }, IOS)).toEqual({});
  });

  it("leaves the component tree's identity line out once the target's app was seen", () => {
    const memo = createDebuggerIdentityMemo();
    const first = memo.forAgent("debugger-component-tree", args, treeOf(IOS));
    expect(first).toBe(treeOf(IOS));

    expect(memo.forAgent("debugger-component-tree", args, treeOf(IOS, "Screen: 402x874"))).toBe(
      "Screen: 402x874"
    );
    // The JSON tools and the tree share what was seen.
    expect(memo.forAgent("debugger-evaluate", args, { result: 2, ...IOS })).toEqual({ result: 2 });
    expect(memo.forAgent("debugger-component-tree", args, treeOf(ANDROID))).toBe(treeOf(ANDROID));
  });

  it("reads a tree line without a logicalDeviceId as the same app as a JSON result without one", () => {
    const memo = createDebuggerIdentityMemo();
    const vega = { deviceName: "kepler-device", appName: "com.example.app" };
    memo.forAgent("debugger-evaluate", args, { result: 1, ...vega });

    expect(
      memo.forAgent(
        "debugger-component-tree",
        args,
        "[device: kepler-device | app: com.example.app]\nScreen: 1920x1080"
      )
    ).toBe("Screen: 1920x1080");
  });

  it("leaves results without an identity, other tools, and calls without a device_id alone", () => {
    const memo = createDebuggerIdentityMemo();
    const notConnected = { status: "not_connected", connected: false, reason: "device_mismatch" };

    expect(memo.forAgent("debugger-log-registry", args, notConnected)).toBe(notConnected);
    expect(memo.forAgent("debugger-evaluate", args, "Error: no result")).toBe("Error: no result");
    expect(memo.forAgent("describe", { udid: UDID, device_id: UDID }, IOS)).toBe(IOS);
    memo.forAgent("debugger-evaluate", {}, { result: 1, ...IOS });
    expect(memo.forAgent("debugger-evaluate", {}, { result: 1, ...IOS })).toEqual({
      result: 1,
      ...IOS,
    });
  });

  it("keeps a separate record per memo, one per MCP session", () => {
    const a = createDebuggerIdentityMemo();
    const b = createDebuggerIdentityMemo();
    a.forAgent("debugger-evaluate", args, { result: 2, ...IOS });

    expect(b.forAgent("debugger-evaluate", args, { result: 2, ...IOS })).toEqual({
      result: 2,
      ...IOS,
    });
  });
});
