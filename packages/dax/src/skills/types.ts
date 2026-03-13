export interface SkillManifest {
  id: string
  version: string
  description: string
  supportedOperators: string[]
  requiredTools: string[]
  optionalTools?: string[]
  checks?: string[]
  workflowTemplate: any // This could be a more specific type later
  outputSchema: any // This could be a JSON schema object
  approvalHints?: {
    [key: string]: string
  }
  evidenceRequirements?: {
    [key: string]: string
  }
}
