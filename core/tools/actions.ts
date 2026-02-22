import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { requireApproval } from "../governance/approvals";
import { recordArtifact, ArtifactEntry } from "../artifacts/index";

interface ReadFileParams {
  projectDir: string;
  path: string;
}

export async function readFile({
  projectDir,
  path,
}: ReadFileParams): Promise<string> {
  await requireApproval({
    projectDir,
    permission: "tool.read",
    pattern: path,
    reason: "read file",
  });
  return readFileSync(path, "utf8");
}

interface WriteFileParams {
  projectDir: string;
  path: string;
  content: string;
}

export async function writeFile({
  projectDir,
  path,
  content,
}: WriteFileParams): Promise<{ ok: true }> {
  await requireApproval({
    projectDir,
    permission: "tool.write",
    pattern: path,
    reason: "write file",
  });
  const before = existsSync(path) ? readFileSync(path, "utf8") : "";
  writeFileSync(path, content);

  const artifact: ArtifactEntry = {
    type: "write",
    path,
    before,
    after: content,
  };
  recordArtifact(projectDir, artifact);

  return { ok: true };
}

interface ExecCommandParams {
  projectDir: string;
  command: string;
}

export async function execCommand({
  projectDir,
  command,
}: ExecCommandParams): Promise<string> {
  await requireApproval({
    projectDir,
    permission: "tool.exec",
    pattern: command,
    reason: "exec command",
  });
  try {
    const output = execSync(command, { stdio: "pipe" }).toString("utf8");
    const artifact: ArtifactEntry = {
      type: "exec",
      command,
      output,
      exitCode: 0,
    };
    recordArtifact(projectDir, artifact);
    return output;
  } catch (error: any) {
    const errorOutput = error.stdout?.toString() || error.message;
    const artifact: ArtifactEntry = {
      type: "exec",
      command,
      output: errorOutput,
      exitCode: error.status || 1,
    };
    recordArtifact(projectDir, artifact);
    throw new Error(`Command failed: ${command}\n${errorOutput}`);
  }
}
