# Contributing to hyprvox

Welcome to the `hyprvox` project. We're glad you're here to help build a production-ready, low-latency STT daemon for Linux. This project follows high engineering standards to ensure reliability, performance, and a seamless developer experience.

## Tech Stack & Standards

We use a modern, high-performance stack centered around the Bun ecosystem.

- **Runtime**: [Bun](https://bun.sh) (Package manager, runner, and test runner).
- **Language**: **TypeScript** (Strict mode). We rely on strong typing and Zod schemas for runtime validation.
- **Linting & Formatting**: **Biome**. We maintain a zero-tolerance policy for lint errors and inconsistent formatting.
- **Testing**: **Vitest**. We aim for **80%+ code coverage**. All new features must include corresponding unit or integration tests.
- **Logging**: **Pino**. Structured logging is mandatory for observability.

## Git Workflow

We maintain a clean, linear history. Automation is encouraged, but human oversight is final.

### Branch Naming
Always work in a feature or fix branch. Never commit directly to `main`.
- `feat/feature-name` for new features.
- `fix/bug-name` for bug fixes.
- `chore/task-name` for maintenance, dependencies, or documentation.

### Conventional Commits
We use strict Conventional Commits. Commits should be one-line, lowercase, and in the imperative mood.
- `feat: add history search functionality`
- `fix: resolve race condition in audio buffer`
- `chore: update deepgram sdk to v4`

### PR Process
- AI agents (like Sisyphus) are permitted to push code and open Pull Requests.
- **Human Approval is Required**: Only humans are authorized to merge PRs into the `main` branch.
- Before opening a PR, ensure all tests pass and the code is formatted.

## Sisyphus Protocol

The "Sisyphus Protocol" defines our core engineering discipline.

### 1. Planning First
For any non-trivial task, you MUST create a detailed checklist (using the `TodoWrite` tool or manually in `ai-todo.md`) before writing a single line of code.
- Break down the task into atomic, verifiable steps.
- Tick items only when they are fully completed and verified.

### 2. Verification
Before pushing or opening a PR, you must run:
- `bun run test`: Ensure all tests pass.
- `bun run index.ts health`: Verify that the environment and API connectivity are stable.

### 3. Critical Rule: Clipboard APPEND Mode
The core value of `hyprvox` is productivity. **NEVER overwrite the user's clipboard history.** 
- All transcription results must be **appended** to the clipboard.
- Use the `clipboardy` integration carefully to preserve existing content.

## Getting Started

1. **Clone & Install**:
   ```bash
   git clone https://github.com/Snehit70/hyprvox.git
   cd hyprvox
   bun install
   ```

2. **Configure Environment**:
   Ensure you have your Groq and Deepgram API keys ready.
   ```bash
   bun run index.ts config init
   ```

3. **Run in Development**:
   ```bash
   bun run index.ts start
   ```

## Key Commands

| Command | Description |
|---------|-------------|
| `bun install` | Install all dependencies |
| `bun run test` | Run the test suite via Vitest |
| `bun run index.ts start` | Start the daemon in the foreground |
| `bun run index.ts health` | Run system and API health checks |
| `bun run index.ts status` | Check daemon status and statistics |

## Project Architecture

The codebase is organized by feature to minimize coupling and maximize discoverability.

- `src/audio/`: Hardware interaction, recording, and format conversion.
- `src/daemon/`: Core service logic, lifecycle management, and hotkey listeners.
- `src/cli/`: Command-line interface definitions and subcommands.
- `src/transcribe/`: API clients for Groq and Deepgram, and result merging logic.
- `src/config/`: Zod-based configuration schema and loaders.
- `src/output/`: Side-effects like clipboard management and system notifications.
- `src/utils/`: Shared utilities, logging, and error templates.

## Coding Guidelines

- **Validation First**: Use Zod to validate all external input (configs, API responses).
- **Error Handling**: Use the templates in `src/utils/error-templates.ts` for consistent user-facing error messages.
- **Async/Await**: Prefer `async/await` over raw Promises. Handle potential rejections explicitly.
- **Documentation**: Document complex logic or internal APIs using JSDoc comments.

---
*Stay focused, build for reliability, and never break the clipboard.*
