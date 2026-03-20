# Contributing to DAX

Thank you for your interest in contributing to **DAX (Deterministic AI eXecution)**. We are building the execution control plane for AI-assisted SDLC, and we value your help.

---

## 🏗️ Product Structure

The DAX repository is a monorepo managed with Bun. The canonical shipped product lives under `packages/dax`.

Please perform new development work only within these directories:
-   `packages/dax`: Core workstation, CLI, and server.
-   `packages/plugin`: Internal and external plugin substrate.
-   `packages/util`: Shared utility libraries.
-   `packages/script`: Build and distribution scripts.
-   `packages/sdk/js`: The DAX JavaScript/TypeScript SDK.

**Important:** Root-level directories (other than `packages/` and `docs/`) are reserved for repository configuration and metadata.

---

## 🚀 Getting Started

1.  Read the [Product Overview](./docs/product/start-here.md) to understand the DAX vision.
2.  Review the [Architecture Deep Dive](./docs/architecture/ARCHITECTURE.md).
3.  Consult the [Contributor Start Here](./docs/product/contributor-start-here.md) guide for environment setup and internal conventions.

---

## 🌿 Branching and PR Standards

*   **Branching**: Use descriptive branch names:
    *   `feature/<workstream>`
    *   `fix/<workstream>`
    *   `docs/<workstream>`
*   **PR Shape**: Group changes logically (e.g., docs first, then core logic, then tests). Avoid mixing unrelated refactors with behavior changes.
*   **Commit Messages**: Follow [Conventional Commits](https://www.conventionalcommits.org/) standards.

---

## 🛠️ Local Development

```bash
# Setup dependencies
bun install

# Start the interactive development environment
bun run dev
```

### Mandatory Checks
Before submitting a PR, ensure all checks pass:
```bash
bun run typecheck:dax   # Static type safety
bun run test            # Comprehensive test suite
bun run release:check   # Release readiness and integrity
```

---

## ✅ Testing Expectations

We maintain a high standard for stability and trust. Every PR must include:
*   **Unit Tests**: For new logic and utilities.
*   **Integration Tests**: For new commands, governance rules, or API endpoints.
*   **Regression Tests**: For all bug fixes.

If you modify the **RAO loop**, **Approvals**, or **Release Validation**, you MUST update the corresponding integration tests.

---

## 🔐 Security

Please report any security vulnerabilities according to our [Security Policy](./SECURITY.md). Do not open public issues for potential security flaws.

---

## 📄 License

By contributing to DAX, you agree that your contributions will be licensed under the project's [MIT License](./LICENSE).
