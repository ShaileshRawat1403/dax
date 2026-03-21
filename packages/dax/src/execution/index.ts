import {
  WorkflowClassSchema,
  WorkflowClassInfo,
  ExecutionModeSchema,
  EXECUTION_MODE_DEFAULTS,
  RISK_TO_APPROVAL_MODE,
} from "./workflow-class"
import type { WorkflowClass, ExecutionMode, RiskLevel } from "./workflow-class"

export { WorkflowClassSchema, WorkflowClassInfo, ExecutionModeSchema, EXECUTION_MODE_DEFAULTS, RISK_TO_APPROVAL_MODE }
export type { WorkflowClass, ExecutionMode, RiskLevel }

import {
  ExecutionContract,
  ExecutionContractMeta,
  ApprovalPolicy,
  OutputContract,
  RetryPolicy,
  FallbackPolicy,
  isValidContract,
  getContractSummary,
  deriveExecutionMode,
} from "./execution-contract"
import type {
  ExecutionContract as ExecutionContractType,
  ExecutionContractMeta as ExecutionContractMetaType,
  ApprovalPolicy as ApprovalPolicyType,
  OutputContract as OutputContractType,
  RetryPolicy as RetryPolicyType,
  FallbackPolicy as FallbackPolicyType,
} from "./execution-contract"

export {
  ExecutionContract,
  ExecutionContractMeta,
  ApprovalPolicy,
  OutputContract,
  RetryPolicy,
  FallbackPolicy,
  isValidContract,
  getContractSummary,
  deriveExecutionMode,
}
export type {
  ExecutionContractType,
  ExecutionContractMetaType,
  ApprovalPolicyType,
  OutputContractType,
  RetryPolicyType,
  FallbackPolicyType,
}

import { compile, compileWithRunId } from "./compiler"
import type { CompileInput, CompileResult } from "./compiler"

export { compile, compileWithRunId }
export type { CompileInput, CompileResult }

import { RunFactory, createRunFromContract, getContractForRun, hasContract } from "./run-factory"
import type { RunFactoryInput, RunFactoryResult } from "./run-factory"

export { RunFactory, createRunFromContract, getContractForRun, hasContract }
export type { RunFactoryInput, RunFactoryResult }
