/**
 * E2E smoke test: verifies the full pipeline runs end-to-end
 * with mocked agents, producing a session directory on disk.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Session } from "../src/session.js";
import { Overseer } from "../src/overseer.js";
import { Phase } from "../src/stateMachine.js";

jest.mock("../src/agents/ideation.js");
jest.mock("../src/agents/architecture.js");
jest.mock("../src/agents/taskGraph.js");
jest.mock("../src/agents/coding.js");
jest.mock("../src/agents/review.js");
jest.mock("../src/agents/integration.js");
jest.mock("../src/agents/testAgent.js");
jest.mock("../src/agents/verification.js");
jest.mock("../src/agents/deploy.js");

import { IdeationAgent } from "../src/agents/ideation.js";
import { ArchitectureAgent } from "../src/agents/architecture.js";
import { TaskGraphAgent } from "../src/agents/taskGraph.js";
import { CodingAgent } from "../src/agents/coding.js";
import { ReviewAgent } from "../src/agents/review.js";
import { IntegrationAgent } from "../src/agents/integration.js";
import { TestAgent } from "../src/agents/testAgent.js";
import { VerificationAgent } from "../src/agents/verification.js";

const SPEC = JSON.stringify({ name: "smoke-app", description: "e2e", tech_stack: [], features: [], out_of_scope: [], assumptions: [] });
const ARCH = JSON.stringify({ stack: { language: "TS" }, structure: [], deploy_platforms: [], test_framework: "jest", verification_method: "cli" });
const TASKS = JSON.stringify([{ title: "Write index.ts", type: "coding", deps: [] }]);
const VERIFY_OK = JSON.stringify({ passed: ["Build OK", "Tests passed"], failed: [], errors: [] });
const REVIEW_OK = JSON.stringify({ approved: true, issues: [], suggestions: [] });

let sessionsDir: string;

beforeAll(() => {
  sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-e2e-"));
  (IdeationAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: SPEC }) }));
  (ArchitectureAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: ARCH }) }));
  (TaskGraphAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: TASKS }) }));
  (CodingAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: "Wrote index.ts" }) }));
  (ReviewAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: REVIEW_OK }) }));
  (IntegrationAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: "Wired" }) }));
  (TestAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: "1 passed" }) }));
  (VerificationAgent as jest.Mock).mockImplementation(() => ({ run: jest.fn().mockResolvedValue({ success: true, output: VERIFY_OK }) }));
});

afterAll(() => fs.rmSync(sessionsDir, { recursive: true }));

test("full pipeline: create session → run overseer → reaches DONE", async () => {
  const session = Session.create("build a smoke test app", undefined, sessionsDir);
  expect(session.id).toHaveLength(8);
  expect(session.phase).toBe(Phase.IDEATION);

  const events: string[] = [];
  const overseer = new Overseer(session, msg => events.push(msg));
  await overseer.run();

  expect(session.phase).toBe(Phase.DONE);
  expect(events.length).toBeGreaterThan(0);
  expect(session.db.getTasks(session.id, "completed")).toHaveLength(1);

  // Session directory exists on disk
  expect(fs.existsSync(session.workspace)).toBe(true);
  const sessionRow = session.db.getSession(session.id);
  expect(sessionRow?.["phase"]).toBe("DONE");

  session.db.close();
});

test("session can be reloaded from disk after run", async () => {
  const s1 = Session.create("reloadable app", undefined, sessionsDir);
  const overseer = new Overseer(s1);
  await overseer.run();
  s1.db.close();

  const s2 = Session.load(s1.id, sessionsDir);
  expect(s2.idea).toBe("reloadable app");
  expect(s2.phase).toBe(Phase.DONE);
  s2.db.close();
});
