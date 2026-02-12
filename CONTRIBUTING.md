# Contributing to RunbookAI

Thank you for your interest in contributing to RunbookAI! This guide will help you get started.

## Good First Issues

New to the project? We maintain a list of beginner-friendly issues to help you get started:

| Issue | Description |
|-------|-------------|
| [#32](https://github.com/Runbook-Agent/RunbookAI/issues/32) | Add example runbook for database connection pool exhaustion |
| [#33](https://github.com/Runbook-Agent/RunbookAI/issues/33) | Add --json output flag to 'runbook status' command |
| [#34](https://github.com/Runbook-Agent/RunbookAI/issues/34) | Add unit tests for confidence scoring module |
| [#35](https://github.com/Runbook-Agent/RunbookAI/issues/35) | Add colored output indicators for investigation confidence levels |
| [#37](https://github.com/Runbook-Agent/RunbookAI/issues/37) | Add Datadog integration for metrics retrieval |

Browse all good first issues: [**good first issue** label](https://github.com/Runbook-Agent/RunbookAI/labels/good%20first%20issue)

To claim an issue, comment on it to let others know you're working on it.

## Getting Started

### Prerequisites

- Node.js 20+
- [Bun](https://bun.sh/) runtime
- Git

### Setup

```bash
# Clone the repository
git clone https://github.com/Runbook-Agent/RunbookAI.git
cd RunbookAI

# Install dependencies
bun install

# Run in development mode
bun run dev --help
```

## Development Workflow

### Running Commands

During development, use `bun run dev` instead of the `runbook` binary:

```bash
bun run dev ask "What's the status of my services?"
bun run dev investigate PD-12345
bun run dev status
```

### Code Quality

Before submitting a PR, ensure your code passes all checks:

```bash
# Type checking
bun run typecheck

# Linting
bun run lint

# Formatting
bun run format

# Run tests
bun test
```

### Pre-commit Hooks

This project uses Husky for pre-commit hooks. They run automatically on `git commit` to check linting and formatting.

## Making Changes

### Branch Naming

Use descriptive branch names:

- `feature/add-datadog-integration`
- `fix/confidence-scoring-edge-case`
- `docs/update-readme`

### Commit Messages

Write clear, concise commit messages:

- Use present tense ("Add feature" not "Added feature")
- Keep the first line under 72 characters
- Reference issues when relevant ("Fix #123")

### Pull Requests

1. Create a branch from `main`
2. Make your changes
3. Ensure all checks pass
4. Open a PR with a clear description
5. Link any related issues

## Project Structure

```
src/
├── agent/          # Core investigation agent logic
├── cli/            # CLI command implementations
├── config/         # Configuration handling
├── integrations/   # External tool integrations (Claude, etc.)
├── knowledge/      # Knowledge base and retrieval
├── mcp/            # MCP server implementation
├── providers/      # Cloud provider clients (AWS, K8s)
├── skills/         # Built-in agent skills
├── tools/          # Agent tools (AWS, diagrams, etc.)
└── utils/          # Shared utilities
```

## Finding Issues

- Look for issues labeled [`good first issue`](https://github.com/Runbook-Agent/RunbookAI/labels/good%20first%20issue) for beginner-friendly tasks
- Issues labeled [`help wanted`](https://github.com/Runbook-Agent/RunbookAI/labels/help%20wanted) are ready for contribution
- Comment on an issue to let others know you're working on it

## Adding Runbooks

To contribute example runbooks, add markdown files to `examples/runbooks/`:

```markdown
---
type: runbook
services: [service-name]
symptoms:
  - "Error message pattern"
severity: sev2
---

# Runbook Title

## Symptoms
...

## Diagnosis
...

## Mitigation
...
```

## Testing

```bash
# Run all tests
bun test

# Run specific test file
bun test src/agent/__tests__/confidence.test.ts

# Run tests in watch mode
bun run test:watch
```

## Questions?

- Open a [GitHub Discussion](https://github.com/Runbook-Agent/RunbookAI/discussions) for questions
- Check existing issues before creating new ones

Thank you for contributing!
