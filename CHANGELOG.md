# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- **Configurable quick replies for AI agents** — replace hardcoded agent command buttons with fully customizable quick replies
  - Define command text, enable/disable per item, assign to specific agents (Claude, Codex, Copilot, Cursor Agent, OpenCode)
  - Compact Settings UI: list view with inline agent tags, click pencil icon to open edit dialog
  - Drag-and-drop reordering via grip handle with visual drop indicator (accent line)
  - Default quick replies migrated from previous hardcoded values: `Ok`, `Продолжай`, `/clear`, `/model`, `/exit`, `/new`
  - New items automatically inherit in config (`quickReplies.items` array in `settings.json`)

### Changed

- Settings page "Быстрые ответы" (Quick Replies) category redesigned for compactness:
  - Single text field drives both label and command (displayed together)
  - Edit dialog replaced inline editing clutter
  - Pencil SVG icon replaces text "Редактировать" button
- Agent command buttons in status bar now generated dynamically from config instead of hardcoded HTML

## Notes

- No breaking changes: existing `settings.json` without `quickReplies` section auto-populated with defaults on next load
- No migration required: previous hardcoded values become the new defaults
