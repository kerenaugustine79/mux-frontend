import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  checkNodeEngine,
  parseVersion,
  parseMinimum,
  compareVersions,
  MIN_SUPPORTED_NODE_MAJOR,
} from "./check-node-engine.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(resolve(here, "..", "package.json"), "utf8"),
);
const declaredRange = pkg?.engines?.node;

function parseDeclaredFloor(range) {
  const minimum = parseMinimum(range);
  if (!minimum) {
    throw new Error(`package.json#engines.node is not a >= range: ${range}`);
  }
  return minimum;
}

describe("parseVersion", () => {
  it("returns null for malformed input", () => {
    expect(parseVersion("")).toBeNull();
    expect(parseVersion("abc")).toBeNull();
    expect(parseVersion("22.x")).toBeNull();
  });

  it("parses major, major.minor and v-prefixed versions", () => {
    expect(parseVersion("22")).toEqual([22, 0, 0]);
    expect(parseVersion("22.1")).toEqual([22, 1, 0]);
    expect(parseVersion("v22.1.3")).toEqual([22, 1, 3]);
  });
});

describe("parseMinimum", () => {
  it("returns null for non >= ranges", () => {
    expect(parseMinimum("^22")).toBeNull();
    expect(parseMinimum(">22")).toBeNull();
    expect(parseMinimum("22")).toBeNull();
  });

  it("parses a >= range", () => {
    expect(parseMinimum(">=22")).toEqual([22, 0, 0]);
  });
});

describe("compareVersions", () => {
  it("orders version tuples", () => {
    expect(compareVersions([22, 1, 0], [22, 0, 0])).toBeGreaterThan(0);
    expect(compareVersions([22, 0, 0], [22, 0, 0])).toBe(0);
    expect(compareVersions([20, 11, 0], [22, 0, 0])).toBeLessThan(0);
  });
});

describe("checkNodeEngine", () => {
  it("accepts a supported running Node", () => {
    expect(checkNodeEngine(">=22.0.0", "v22.1.0")).toBeNull();
  });

  it("rejects an unsupported running Node", () => {
    const result = checkNodeEngine(">=22.0.0", "v20.11.0");
    expect(typeof result).toBe("string");
    expect(result.startsWith("ENGINE_UNSUPPORTED_NODE")).toBe(true);
  });

  it("rejects an invalid range", () => {
    expect(checkNodeEngine("^22", "v22.1.0")).toBe("ENGINE_RANGE_INVALID");
  });

  it("rejects a range below the hard floor", () => {
    expect(checkNodeEngine(">=17.0.0", "v22.1.0")).toBe("ENGINE_RANGE_TOO_LOW");
  });

  it("rejects a range whose minor/patch floor is below the hard floor", () => {
    const belowFloor = `>=${MIN_SUPPORTED_NODE_MAJOR}.0.0`;
    const minimum = parseMinimum(belowFloor);
    expect(minimum).not.toBeNull();
    expect(
      compareVersions(minimum, [MIN_SUPPORTED_NODE_MAJOR, 0, 0]),
    ).toBeLessThan(0);
    expect(checkNodeEngine(belowFloor, "v22.1.0")).toBe("ENGINE_RANGE_TOO_LOW");
  });

  it("rejects a range strictly below the repo's declared engines.node", () => {
    const declaredFloor = parseDeclaredFloor(declaredRange);
    const belowDeclared = `>=${MIN_SUPPORTED_NODE_MAJOR}.0.0`;
    const minimum = parseMinimum(belowDeclared);
    expect(minimum).not.toBeNull();
    expect(compareVersions(minimum, declaredFloor)).toBeLessThan(0);
    expect(checkNodeEngine(belowDeclared, "v22.1.0")).toBe(
      "ENGINE_RANGE_TOO_LOW",
    );
  });

  it("accepts the repo's declared engines.node on a supported Node", () => {
    const declaredFloor = parseDeclaredFloor(declaredRange);
    const running = `v${declaredFloor.join(".")}`;
    expect(checkNodeEngine(declaredRange, running)).toBeNull();
  });
});
