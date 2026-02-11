/**
 * Integrations Module Exports
 */

// Claude hooks installation and management
export {
  installClaudeHooks,
  uninstallClaudeHooks,
  getClaudeHookStatus,
  persistClaudeHookEvent,
  handleClaudeHookStdin,
  type ClaudeSettingsScope,
  type ClaudeHookEventName,
  type InstallClaudeHooksOptions,
  type InstallClaudeHooksResult,
  type UninstallClaudeHooksOptions,
  type UninstallClaudeHooksResult,
  type ClaudeHookStatusOptions,
  type ClaudeHookStatusResult,
  type PersistClaudeHookEventOptions,
  type PersistClaudeHookEventResult,
  type HandleClaudeHookStdinResult,
} from './claude-hooks';

// Hook handlers with context injection
export {
  handleHookEvent,
  handleSessionStart,
  handleUserPromptSubmit,
  handlePreToolUse,
  handlePostToolUse,
  handleStop,
  handleHookStdinWithResponse,
  type HookResponse,
  type HookPayload,
  type ActiveIncident,
  type SessionState,
  type HookHandlerConfig,
} from './hook-handlers';
