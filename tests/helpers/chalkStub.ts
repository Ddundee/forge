// Identity stub for chalk in jest. chalk v5 is ESM-only ("#ansi-styles" subpath
// import) and cannot load under the CJS ts-jest test runner. Tests don't assert
// on ANSI color, so map every chalk.<color>(s) and chalk(s) to the string itself.
const identity = (...args: unknown[]): string => args.map(String).join(" ");
export default new Proxy(identity, { get: () => identity }) as unknown as typeof import("chalk").default;
