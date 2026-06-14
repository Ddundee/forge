/** @type {import('jest').Config} */
const config = {
  testEnvironment: "node",
  moduleNameMapper: {
    // chalk v5 is ESM-only and breaks the CJS test loader; stub it for tests
    // that import a chalk-using module directly (e.g. commands/*).
    "^chalk$": "<rootDir>/tests/helpers/chalkStub.ts",
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "CommonJS",
          moduleResolution: "bundler",
          jsx: "react",
          esModuleInterop: true,
          strict: true,
          skipLibCheck: true,
        },
      },
    ],
  },
  testMatch: ["**/tests/**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/", "<rootDir>/.claude/"],
  forceExit: true,
};

module.exports = config;
