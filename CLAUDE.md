# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Otter** is a VSCode extension for unified AI prompt management. It provides features for:
- Creating prompts from selected text with smart name/emoji detection
- Local storage (JSON format) with optional Git synchronization
- Markdown mirroring (prompts can be edited as individual .md files)
- AI-assisted meta generation (title, emoji) and content optimization
- TreeView sidebar for browsing and managing prompts with sorting and searching

The extension is written in TypeScript and targets VSCode 1.85+.

## Essential Development Commands

### Build and Compilation
```bash
npm install                    # Install dependencies
npm run compile               # Compile TypeScript to JavaScript
npm run watch                 # Watch mode - auto-compile on file changes
npm run lint                  # Run ESLint on src/
```

### Testing and Validation
```bash
npm test                      # Run all tests via Mocha
npm run pretest               # Compile + lint + test (runs before test)
```

### Packaging and Debugging
```bash
npm run package               # Package extension as .vsix file
```

### Debug/Run
- Press **F5** in VSCode to launch Extension Development Host (uses tasks.json default build task)
- Press **F5** in "Extension Tests" debug config to run tests in debug mode

### Diagnostic Tools
```bash
npm run ai:doctor             # Diagnose AI provider configuration
npm run ai:doctor --probe     # Probe/detect available AI providers
```

## Architecture Overview

### Core Services Layer (`src/services/`)

The extension uses a layered architecture with clear separation of concerns:

- **PromptStorageService**: Core data persistence layer
  - Manages prompts.json file read/write
  - CRUD operations for prompts
  - Imports markdown files on init, prunes missing files
  - Emits `onDidChangePrompts` event for reactive updates

- **ConfigurationService**: VSCode settings integration
  - Reads/writes extension config, workspace vars, env vars (supports `~`, `${var}` syntax)
  - Secret storage for API keys (via VSCode SecretStorage)
  - Provides `onDidChange` event for config changes

- **AIService**: Multi-provider AI integration
  - Supports: OpenAI, Azure, Gemini, DeepSeek, Qwen, custom, local Claude Code, local Codex
  - Generates metadata (title, emoji) and optimizes content
  - Delegates to LocalClaudeProvider or LocalCodexProvider for local execution
  - Manages API key retrieval from config/secrets with fallback to user prompt

- **GitSyncService**: Git version control for prompts
  - Minimal implementation: add, commit, pull, push operations
  - Auto-sync on Markdown save (with configurable delay)
  - Auto-pull on startup support

- **MarkdownMirrorService**: Bidirectional Markdown sync
  - Listens to Markdown file saves → updates prompts.json
  - Prevents circular triggers (auto-export disabled to avoid overwriting user edits)
  - Parses frontmatter and content from Markdown files

- **PromptFileService**: Markdown prompt file management
  - Creates new prompt Markdown files with templates
  - Handles filename generation (supports {name}, {timestamp}, {date}, {emoji} placeholders)

- **OnboardingWizard**: First-run configuration
  - Guides users through storage path, Git, and AI provider setup
  - Sets state in globalState

- **StatusBarService**: VSCode status bar integration

- **UsageLogService**: AI usage tracking (token counts, costs, performance)

- **LocalClaudeProvider & LocalCodexProvider**: Local AI CLI adapters
  - Execute local claude/codex commands with timeout handling
  - Auto-detect binary paths from env, PATH, VSCode extensions, common directories

### UI and Command Layer

**[src/commands/CommandRegistrar.ts](src/commands/CommandRegistrar.ts)**
- Central registration point for all ~15 commands
- Implements logic for: create from selection, edit, delete, search, Git sync, AI operations
- Uses Fuse.js for fuzzy search over prompts
- `execWithEnv` helper: wraps child_process.exec with timeout/env handling

**[src/providers/](src/providers/)**
- **PromptTreeProvider**: TreeView data provider
  - Groups prompts by tags or lists them flat
  - Sorting: recent, name, created, usage count
  - Updates when storage changes via onDidChangePrompts event
- **PromptSearchCodeActionProvider**: Lightbulb code action for quick search

### Utilities

**[src/utils/](src/utils/)**
- **helpers.ts**: ID generation (UUID), date formatting, path resolution, environment variable expansion
- **SelectionParser.ts**: Parses selected text; detects `# prompt:` markers, Markdown H1 headers, extracts emoji and name
- **MarkdownPromptParser.ts**: Parses prompt Markdown files with frontmatter (YAML) and content extraction

### Data Models

**[src/types/Prompt.ts](src/types/Prompt.ts)**

Key interfaces:
- `Prompt`: id, name, emoji, content, createdAt, updatedAt, sourceFile, tags, aiGeneratedMeta, fromMarkdownFile
- `PromptStorage`: version, prompts[], usageLogs[]
- `ParsedPromptInfo`: Extracted name, emoji, content from selection
- `AIUsageLog`: Token tracking, costs, operation type (meta|optimize), duration
- `OnboardingState`: Wizard progress state

### Entry Point

**[src/extension.ts](src/extension.ts)**
- Activates all services on `onStartupFinished`
- Initializes storage, TreeView, commands, Git sync, Markdown mirror, onboarding in sequence
- Listens for storagePath config changes and reloads storage dynamically
- Shows onboarding wizard on first use

## Key Design Patterns

### Event-Driven Updates
- `PromptStorageService.onDidChangePrompts` → fires when prompts change
- `ConfigurationService.onDidChange` → fires on config changes
- TreeView auto-refreshes via these events (reactive pattern)

### Path Resolution
- `ConfigurationService.expandPath()`: Resolves `~`, env vars, `${workspaceFolder}`, `${workspaceFolderBasename}`
- Used for storagePath, Claude binary paths, etc.

### AI Provider Abstraction
- AIService delegates to provider-specific implementations
- LocalClaudeProvider: spawns `claude` CLI command with timeout
- LocalCodexProvider: spawns `codex` CLI command with timeout
- HTTP providers (OpenAI, etc.) implemented directly in AIService

### Markdown Mirroring
- Files in storage directory are automatically imported on init
- User can edit prompts as individual .md files in the storage folder
- Markdown changes sync back to prompts.json on save
- JSON changes → Markdown export disabled to avoid conflicts

## Configuration

All settings are in `package.json` `contributes.configuration.properties`:

**Storage**
- `otter.storagePath`: Root directory for prompts (default: `~/.otter`)
- `otter.storage.autoCreate`: Auto-create if missing (default: true)

**Selection & Creation**
- `otter.selection.autoDetectPromptName`: Parse `# prompt:` markers (default: true)
- `otter.selection.removePromptMarker`: Strip marker after extraction (default: true)
- `otter.ui.showEmojiPicker`: Show emoji picker during creation (default: true)

**Markdown Files**
- `otter.markdown.filenameTemplate`: Template for created .md files (default: `prompt-{timestamp}.md`)
- `otter.markdown.askForFilename`: Prompt user for filename (default: false)

**Git Sync**
- `otter.git.enableSync`: Enable Git sync (default: false)
- `otter.git.autoPullOnStartup`: Auto-pull on startup (default: false)
- `otter.git.autoSyncOnSave`: Auto-sync after Markdown save (default: true)
- `otter.git.autoSyncDelaySeconds`: Delay before sync (default: 60)
- `otter.git.commitMessageTemplate`: Commit message template (default: `chore: sync prompts`)

**AI Providers**
- `otter.ai.provider`: Selected AI provider (default: empty) [openai|azure|gemini|deepseek|qwen|custom|local-claude|local-codex]
- `otter.ai.model`: Model name (e.g., gpt-4o, qwen-turbo)
- `otter.ai.baseUrl`: API base URL for custom providers
- `otter.ai.batchDelayMs`: Delay between batch API calls (default: 500)
- `otter.local.claudePath`: Path to claude CLI (auto-detect if empty)
- `otter.local.claudeTimeoutMs`: Claude CLI timeout (default: 120000)
- `otter.local.codexPath`: Path to codex executable (auto-detect if empty)
- `otter.local.codexModel`: Model name for Codex

**UI**
- `otter.ui.sortBy`: Sort order [recent|name|created|usage] (default: recent)
- `otter.statusBar.enable`: Show status bar icon (default: true)

API keys are stored in VSCode SecretStorage (not in settings.json).

## Testing

Tests use Mocha and are in [src/test/suite/](src/test/suite/):
- ConfigurationService.test.ts
- SelectionParser.test.ts
- MarkdownPromptParser.test.ts
- CommandRegistrar.test.ts
- PromptStorageService.test.ts
- AIService.test.ts
- LocalClaudeProvider.test.ts
- LocalCodexProvider.test.ts
- helpers.test.ts

Run with: `npm test` or use F5 with "Extension Tests" debug config.

## Common Workflows

### Adding a New Command
1. Define command in `package.json` contributes.commands
2. Register menu entry in contributes.menus if needed
3. Register handler in [CommandRegistrar.ts](src/commands/CommandRegistrar.ts) `registerAll()` method
4. Command receives parameters from VSCode (e.g., selected TreeItem)
5. Use services (storage, config, AIService) to implement logic
6. Call `treeProvider.refresh()` if data changed

### Adding a New Configuration Option
1. Add to `package.json` contributes.configuration.properties
2. Access via `configService.get<T>(key, defaultValue)` or `configService.getSecret(key)` for API keys
3. Listen for changes with `configService.onDidChange()`

### Integrating a New AI Provider
1. If HTTP-based: Add logic to AIService's `generateMeta()` or `optimizeContent()` method
2. If CLI-based: Create a new provider class in [src/services/](src/services/) (e.g., LocalClaudeProvider)
3. Update AIService to delegate to the new provider
4. Add config options for the provider in package.json and onboarding wizard

### Debugging Git Operations
- GitSyncService runs commands in the storagePath directory
- Check git config: `cd ~/.otter && git status`
- Logs are printed to console (watch output in Extension Development Host)

## Important Codebase Notes

1. **Circular Trigger Prevention**: MarkdownMirrorService has auto-export disabled to prevent loops. Markdown saves sync to JSON, but JSON changes don't export back to Markdown.

2. **Storage Format**: prompts.json contains version (1.0.0) and prompts array. Markdown files are optional mirrors in the same directory.

3. **TreeView Multi-Select**: Enabled (see extension.ts createTreeView call), but most commands operate on single items.

4. **Local AI Providers**: LocalClaudeProvider and LocalCodexProvider auto-detect binary paths; manual path can be set in config.

5. **Error Messages**: Extension shows user-facing messages via `vscode.window.showErrorMessage()` and logs detailed errors to console.

6. **TypeScript Strict Mode**: Enabled in tsconfig.json; all code uses strict null checks.

7. **Chinese Localization**: Extension UI and most comments are in Chinese (Simplified).

## Linting and Code Style

- ESLint config: [.eslintrc.json](.eslintrc.json)
- Rules: naming conventions (warn), semicolons (warn), curly braces (warn), eqeqeq (warn)
- Run: `npm run lint`

## Build Output

- Compiled JavaScript: `out/` directory
- Source maps included for debugging
- package.json main: `out/extension.js`
- Ignore patterns: node_modules, .vscode-test
