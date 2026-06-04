import type { Config } from "jest";

const config: Config = {
  testEnvironment: "node",
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "CommonJS",
          moduleResolution: "node",
          jsx: "react",
          esModuleInterop: true,
        },
      },
    ],
  },
  testMatch: ["**/tests/**/*.test.ts"],
};

export default config;
