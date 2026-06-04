import { TOOL_DEFINITIONS } from "../../src-ts/tools/definitions.js";

test("TOOL_DEFINITIONS contains all four tools", () => {
  expect(Object.keys(TOOL_DEFINITIONS)).toEqual(
    expect.arrayContaining(["bash_exec", "read_file", "write_file", "list_dir"])
  );
});

test("each tool has description and parameters", () => {
  for (const [, def] of Object.entries(TOOL_DEFINITIONS)) {
    expect((def as any).description).toBeTruthy();
    expect((def as any).parameters).toBeTruthy();
  }
});
