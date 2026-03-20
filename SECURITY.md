# Security Policy

## Responsible AI Usage

DAX is a governed execution control plane designed to provide deterministic oversight of AI operations. However, users must be aware of the following:

1.  **Human-in-the-Loop (HITL):** DAX is designed to *assist* and *govern*, not to operate completely autonomously without supervision. Critical actions should always be reviewed via the **Audit** and **Approval** surfaces.
2.  **Model Hallucinations:** While DAX enforces deterministic workflows, the underlying LLMs can still hallucinate information. Always verify technical claims against the source code or official documentation.
3.  **Credential Safety:** DAX stores API keys and credentials locally. Ensure your environment is secure and follow best practices for secret management.

## Reporting a Vulnerability

We take the security of our tools and your data seriously. If you discover a security vulnerability within DAX, please follow these steps:

1.  **Do not open a public issue.** 
2.  Send a detailed report to the maintainers at [security@dax.ai](mailto:security@dax.ai).
3.  Include a description of the vulnerability, steps to reproduce, and any potential impact.

We will acknowledge your report within 48 hours and provide a timeline for resolution.

## Governance & Compliance

DAX provides the **RAO (Run-Audit-Override)** loop specifically to help teams meet security and compliance requirements when using AI in the SDLC. We encourage using the `dax audit` and `dax verify` commands to maintain a healthy trust posture.
