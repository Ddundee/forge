import { Phase, transition, InvalidTransitionError } from "../src-ts/stateMachine.js";

test("valid transition IDEATION → ARCHITECTURE", () => {
  expect(transition(Phase.IDEATION, Phase.ARCHITECTURE)).toBe(Phase.ARCHITECTURE);
});

test("valid transition VERIFICATION → CODING (loop back)", () => {
  expect(transition(Phase.VERIFICATION, Phase.CODING)).toBe(Phase.CODING);
});

test("valid transition VERIFICATION → DEPLOY", () => {
  expect(transition(Phase.VERIFICATION, Phase.DEPLOY)).toBe(Phase.DEPLOY);
});

test("invalid transition throws InvalidTransitionError", () => {
  expect(() => transition(Phase.IDEATION, Phase.CODING)).toThrow(InvalidTransitionError);
});

test("cannot leave DONE", () => {
  expect(() => transition(Phase.DONE, Phase.IDEATION)).toThrow(InvalidTransitionError);
});

test("Phase enum values are strings", () => {
  expect(Phase.IDEATION).toBe("IDEATION");
  expect(Phase.CODING).toBe("CODING");
});
