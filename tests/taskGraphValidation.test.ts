import { normalizeTaskGraph } from "../src/taskGraphValidation.js";

test("normalizeTaskGraph accepts a tasks wrapper and fills defaults", () => {
  const tasks = normalizeTaskGraph({ tasks: [{ name: "Setup", dependencies: "Init" }] });
  expect(tasks).toEqual([{ title: "Setup", type: "coding", deps: ["Init"] }]);
});

test("normalizeTaskGraph removes duplicate and self-referencing deps", () => {
  const tasks = normalizeTaskGraph([{ title: "API", deps: ["DB", " DB ", "API"] }]);
  expect(tasks[0].deps).toEqual(["DB"]);
});

test("normalizeTaskGraph rejects items without a title", () => {
  expect(() => normalizeTaskGraph([{ type: "coding" }])).toThrow("missing a title");
});
