# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Prompt Hub** is a VSCode extension for managing and organizing AI prompts with local storage, Git synchronization, and AI-assisted content generation. The extension is written in TypeScript and targets VSCode 1.85+.

## Development Commands

### Build and Test
```bash
# Install dependencies
npm install

# Compile TypeScript to JavaScript
npm run compile

# Watch mode (auto-recompile on changes)
npm run watch

# Run linter
npm run lint

# Run tests
npm test

# Package extension as VSIX
npm run package
```

### Debugging
- Press `F5` in VSCode to launch Extension Development Host
- Extension activates with event `onStartupFinished`
- Output appears in "Prompt Hub" output channel

## Architecture Overview

The extension follows a service-oriented architecture with clear separation of concerns:

### Core Services Layer
- **PromptStorageService**: JSON-based storage with CRUD operations, handles Markdown mirror synchronization
- **ConfigurationService**: VSCode configuration reader with change listeners, manages SecretStorage for API keys
- **MarkdownMirrorService**: Bidirectional sync between JSON storage and Markdown files
- **AIService**: Unified interface for AI providers (OpenAI, Azure, Qwen, custom) using strategy pattern
- **GitSyncService**: Git operations (pull/commit/push) with status tracking
- **UsageLogService**: AI usage tracking (tokens, cost, duration) with CSV export
- **PromptFileService**: Creates Markdown templates with front-matter and smart naming
- **OnboardingWizard**: 5-step first-run configuration wizard

### Presentation Layer
- **PromptTreeProvider**: Activity bar tree view with tag-based grouping
- **CommandRegistrar**: Centralized command registration with dependency injection

### Utilities
- **SelectionParser**: Smart detection of `# prompt:` markers, extracts name/emoji from selected text
- **helpers**: ID generation and common utility functions

### Data Flow
```
User Action → Command → Service(s) → Storage/API → Refresh UI
                          ↓
                    Event Emitter triggers TreeView refresh
```

### Key Design Patterns
- **Strategy Pattern**: AIService supports multiple providers via pluggable implementations
- **Observer Pattern**: Services emit events to decouple UI refresh from business logic
- **Dependency Injection**: CommandRegistrar receives all services via constructor
- **Service Layer**: Core business logic isolated from VSCode API for testability

## Data Model

### Storage Format
- **Primary**: JSON file at `promptHub.storagePath` (default: `~/.prompt-hub`)
- **Structure**: `{ version: string, prompts: Prompt[], usageLogs: AIUsageLog[] }`
- **Atomic writes**: Temp file + rename for safety

### Prompt Interface
```typescript
interface Prompt {
  id: string;                    // UUID
  name: string;                  // Display name
  emoji?: string;                // Visual identifier
  content: string;               // Markdown content
  createdAt: string;             // ISO 8601
  updatedAt: string;             // ISO 8601
  sourceFile?: string;           // Original file path
  tags?: string[];               // User-defined tags
  aiGeneratedMeta?: boolean;     // AI-generated flag
  fromMarkdownFile?: Uri;        // Linked Markdown file
}
```

## Key Features Implementation

### Smart Selection Parser
- Detects `# prompt: 🔥 Name` marker in first line of selection
- Extracts emoji and name automatically
- Removes marker from content if `promptHub.selection.removePromptMarker` enabled
- Located in [SelectionParser.ts](upstream/src/utils/SelectionParser.ts)

### Markdown Mirror Sync
- Optional bidirectional sync between JSON and Markdown files
- Watches `workspace.onDidSaveTextDocument` for Markdown changes
- Filename template supports: `{name}`, `{timestamp}`, `{date}`, `{emoji}`
- Conflict resolution: timestamp-based with user prompt

### AI Integration
- Supports multiple providers via `promptHub.ai.provider`
- Two operations: `generateMeta` (title/emoji) and `optimize` (content improvement)
- Token usage tracked in UsageLogService
- API keys stored in VSCode SecretStorage

### Git Synchronization
- Detects if storage path is a Git repo
- Provides pull/commit/push operations
- Auto-pull on startup if `promptHub.git.autoPullOnStartup` enabled
- Commit message template: `promptHub.git.commitMessageTemplate`

## Configuration System

All settings use `promptHub.*` namespace. Key categories:

- **Storage**: `storagePath`, `storage.autoCreate`
- **Markdown**: `markdown.enableMirror`, `markdown.filenameTemplate`, `markdown.askForFilename`
- **Selection**: `selection.autoDetectPromptName`, `selection.removePromptMarker`
- **Git**: `git.enableSync`, `git.autoPullOnStartup`, `git.commitMessageTemplate`
- **AI**: `ai.provider`, `ai.model`, `ai.baseUrl`, `ai.temperature`
- **UI**: `ui.showEmojiPicker`, `ui.sortBy`

See [package.json](upstream/package.json) configuration section for full list.

## Testing Strategy

### Unit Tests
- Use memfs for filesystem mocking in PromptStorageService tests
- Sinon stubs for VSCode API in PromptFileService tests
- HTTP mocks for AIService (success/failure/timeout scenarios)
- Git command mocks using simple-git stubs

### Integration Tests
- Launch via `@vscode/test-electron` in sandbox workspace
- Test command chains: create → edit → delete → sync

### Test Structure
Tests live in `src/test/` (not currently in repo, but expected location per tsconfig)

## Important Notes

### File Paths
- Storage path supports: absolute, `~`, `${workspaceFolder}`, environment variables
- Path resolution happens in ConfigurationService
- Markdown mirror creates subdirectories based on tags

### Security
- API keys stored in `context.secrets` (SecretStorage), never in settings
- Git credentials not logged
- No telemetry without explicit user consent

### Extension Activation
- Entry point: [extension.ts](upstream/src/extension.ts)
- Activates on startup (`onStartupFinished`)
- Services initialized in order: Config → Storage → TreeView → Commands → Mirror → Onboarding

### Chinese Localization
- Extension UI is in Chinese (Simplified)
- Comments and documentation are in Chinese
- User-facing messages use Chinese strings

## Common Development Tasks

### Adding a New Command
1. Add command to `package.json` → `contributes.commands`
2. Add menu entry if needed (editor/context, view/title, view/item/context)
3. Implement handler in CommandRegistrar
4. Register in `CommandRegistrar.registerAll()`

### Adding a New AI Provider
1. Create provider class implementing AIService interface
2. Add provider to `promptHub.ai.provider` enum in package.json
3. Update AIService constructor to instantiate new provider based on config

### Modifying Storage Format
1. Update `Prompt` or `PromptStorage` interface in [types/Prompt.ts](upstream/src/types/Prompt.ts)
2. Implement migration logic in PromptStorageService
3. Increment `version` field in storage structure
4. Add backward compatibility for existing data

## Troubleshooting

### Extension Not Activating
- Check Output → Prompt Hub for activation errors
- Verify `engines.vscode` compatibility
- Ensure `out/extension.js` exists (run `npm run compile`)

### Storage Issues
- Check `promptHub.storagePath` resolves correctly
- Verify directory permissions
- Check for JSON syntax errors in storage file

### Git Sync Failures
- Ensure storage path is a Git repository
- Check Git executable in PATH
- Verify remote URL is configured correctly
- Check Prompt Hub Git Sync output channel for detailed errors

## Extension Points

The architecture is designed for extensibility:

- **Storage**: PromptStorageService interface allows cloud storage implementations
- **AI Providers**: Strategy pattern enables custom AI backends
- **Git Sync**: Can extend to Gist or team repositories
- **Commands**: CommandRegistrar centralizes registration for consistency
