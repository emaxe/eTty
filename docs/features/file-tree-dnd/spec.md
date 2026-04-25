# Спецификация: Drag & Drop + Multi-select для FileTree

## Контекст

Пользователи eTty хотят перетаскивать файлы и папки в файловом дереве (sidebar) для быстрого перемещения, а также выделять несколько элементов для batch-операций.

## Требования

### Multi-select
- REQ-1: Single click — выделение одного элемента
- REQ-2: Ctrl/Cmd + Click — toggle выделения (добавить/убрать)
- REQ-3: Shift + Click — range select (диапазон)
- REQ-4: Ctrl/Cmd + A — select all видимых элементов

### Drag & Drop
- REQ-5: HTML5 DnD для перетаскивания выделенных элементов
- REQ-6: Ghost image с badge (+N) при multi-select
- REQ-7: Подсветка целевой папки при drag-over (accent color)
- REQ-8: Auto-expand свёрнутых папок при hover (700ms)
- REQ-9: Защита от self-drop (нельзя бросить в саму себя/дочерние)

### Move
- REQ-10: Batch move через IPC `fs:move`
- REQ-11: Collision resolution: `filename (1).ext`
- REQ-12: Cross-volume fallback (cp + rm)
- REQ-13: Path traversal защита

### Undo
- REQ-14: Ctrl/Cmd + Z для отката последнего move
- REQ-15: Stack max 20 entries, non-persistent

### UI feedback
- REQ-16: Loading state (`cursor: wait`) во время move
- REQ-17: Selection восстанавливается после автообновления DOM

## Ограничения
- Только в рамках CWD (path traversal защита)
- Undo не persistent между сессиями
- Нет drag-and-drop между вкладками

## Кодстайл
- ES modules, class-based (как остальные компоненты проекта)
- CSS variables для тем

## Затронутые файлы
- `src/renderer/file-tree.js`
- `src/main/file-manager.js`
- `src/main/index.js`
- `src/preload/index.js`
- `src/renderer/styles.css`
