/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: "command",
  commandRunner: {
    command:
      "bun test packages/dax/src/governance/policy-engine.test.ts packages/dax/src/state/transitions.test.ts packages/dax/src/cli/cmd/approvals.test.ts",
  },
  mutate: ["packages/dax/src/governance/policy-engine.ts", "packages/dax/src/approval/approval-transitions.ts"],
  reporters: ["clear-text", "json", "html"],
  htmlReporter: {
    fileName: "reports/mutation/html/index.html",
  },
  jsonReporter: {
    fileName: "reports/mutation/mutation-report.json",
  },
  thresholds: {
    high: 80,
    low: 60,
    break: 0,
  },
  timeoutMS: 10000,
  concurrency: 2,
  allowEmpty: false,
}
