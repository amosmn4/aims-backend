module.exports = {
  testEnvironment: "node",
  moduleFileExtensions: ["ts", "js", "json"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }],
  },
  testMatch: ["**/*.spec.ts"],
};
