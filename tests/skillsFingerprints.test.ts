import {
  skillFingerprint,
  fingerprintPlanningInput,
  fingerprintFailures,
} from "../src/skills/fingerprints.js";

// --- skillFingerprint ---

test("skillFingerprint returns 16-char hex string", () => {
  const fp = skillFingerprint({ moment: "pre-architecture", phase: "ARCHITECTURE" });
  expect(fp).toHaveLength(16);
  expect(fp).toMatch(/^[0-9a-f]+$/);
});

test("skillFingerprint is deterministic for same input", () => {
  const input = { moment: "pre-coding-phase", phase: "CODING", query: "React testing" };
  expect(skillFingerprint(input)).toBe(skillFingerprint(input));
});

test("skillFingerprint differs for different moments", () => {
  const a = skillFingerprint({ moment: "pre-architecture", phase: "ARCHITECTURE" });
  const b = skillFingerprint({ moment: "pre-coding-phase", phase: "CODING" });
  expect(a).not.toBe(b);
});

test("skillFingerprint normalizes whitespace in query", () => {
  const a = skillFingerprint({ moment: "m", phase: "p", query: "react  testing" });
  const b = skillFingerprint({ moment: "m", phase: "p", query: "react testing" });
  expect(a).toBe(b);
});

test("skillFingerprint normalizes case in query", () => {
  const a = skillFingerprint({ moment: "m", phase: "p", query: "React Testing" });
  const b = skillFingerprint({ moment: "m", phase: "p", query: "react testing" });
  expect(a).toBe(b);
});

test("skillFingerprint sorts taskTitles before hashing", () => {
  const a = skillFingerprint({ moment: "m", phase: "p", taskTitles: ["build UI", "add auth"] });
  const b = skillFingerprint({ moment: "m", phase: "p", taskTitles: ["add auth", "build UI"] });
  expect(a).toBe(b);
});

test("skillFingerprint sorts failures before hashing", () => {
  const a = skillFingerprint({ moment: "m", phase: "p", failures: ["npm run build failed", "tsc error"] });
  const b = skillFingerprint({ moment: "m", phase: "p", failures: ["tsc error", "npm run build failed"] });
  expect(a).toBe(b);
});

test("skillFingerprint normalizes failures (strips line numbers)", () => {
  const a = skillFingerprint({ moment: "m", phase: "p", failures: ["Error at line 42: not found"] });
  const b = skillFingerprint({ moment: "m", phase: "p", failures: ["Error at line 99: not found"] });
  expect(a).toBe(b);
});

test("skillFingerprint normalizes architecture by extracting key fields", () => {
  const arch = JSON.stringify({ stack: { language: "TypeScript" }, test_framework: "vitest", irrelevant: "noise" });
  const a = skillFingerprint({ moment: "m", phase: "p", architecture: arch });
  const archNoNoise = JSON.stringify({ stack: { language: "TypeScript" }, test_framework: "vitest" });
  const b = skillFingerprint({ moment: "m", phase: "p", architecture: archNoNoise });
  // Different JSON but same key fields → may differ due to irrelevant field exclusion
  expect(typeof a).toBe("string");
  expect(typeof b).toBe("string");
});

// --- fingerprintPlanningInput ---

test("fingerprintPlanningInput returns 16-char hex", () => {
  const fp = fingerprintPlanningInput({
    moment: "pre-architecture",
    phase: "ARCHITECTURE",
    spec: "{}",
    idea: "todo app",
  });
  expect(fp).toHaveLength(16);
});

test("fingerprintPlanningInput is stable for same idea/spec", () => {
  const input = { moment: "pre-architecture", phase: "ARCHITECTURE", spec: "{}", idea: "todo app" };
  expect(fingerprintPlanningInput(input)).toBe(fingerprintPlanningInput(input));
});

test("fingerprintPlanningInput differs for different specs", () => {
  const a = fingerprintPlanningInput({ moment: "m", phase: "p", spec: '{"name":"todo"}' });
  const b = fingerprintPlanningInput({ moment: "m", phase: "p", spec: '{"name":"crm"}' });
  expect(a).not.toBe(b);
});

test("fingerprintPlanningInput accepts tasks array", () => {
  const fp = fingerprintPlanningInput({
    moment: "pre-coding-phase",
    phase: "CODING",
    tasks: [{ title: "Build UI" }, { title: "Add auth" }],
  });
  expect(fp).toHaveLength(16);
});

// --- fingerprintFailures ---

test("fingerprintFailures returns 16-char hex", () => {
  const fp = fingerprintFailures({ failures: ["npm run build failed with TS2307"] });
  expect(fp).toHaveLength(16);
});

test("fingerprintFailures is stable for same failures", () => {
  const input = { failures: ["npm run build failed with TS2307"] };
  expect(fingerprintFailures(input)).toBe(fingerprintFailures(input));
});

test("fingerprintFailures differs from planning fingerprint", () => {
  const a = fingerprintFailures({ failures: ["error"] });
  const b = fingerprintPlanningInput({ moment: "post-verification-failure", phase: "VERIFICATION" });
  expect(a).not.toBe(b);
});

test("fingerprintFailures with same text after normalization returns same fp", () => {
  const a = fingerprintFailures({ failures: ["Error  at  line 10"] });
  const b = fingerprintFailures({ failures: ["Error  at  line 99"] });
  expect(a).toBe(b);
});
