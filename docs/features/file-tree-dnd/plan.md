# План реализации: FileTree DnD

## Задачи

| # | Задача | Файлы | Зависит от | Режим | Проверка |
|---|--------|-------|------------|-------|----------|
| 1 | IPC plumbing: fsMove | preload, main, file-manager | — | sequential | build |
| 2 | Multi-select logic | file-tree.js | — | sequential | ручной тест |
| 3 | HTML5 DnD handlers | file-tree.js | 2 | sequential | ручной тест |
| 4 | Ghost image + badge | file-tree.js | 3 | sequential | ручной тест |
| 5 | Auto-expand + CSS | file-tree.js, styles.css | 3 | sequential | ручной тест |
| 6 | Undo (Ctrl+Z) | file-tree.js | 1 | sequential | ручной тест |
| 7 | Edge cases + polish | file-tree.js, file-manager.js | 5,6 | sequential | ручной тест |

## Стратегия

Последовательно: IPC → multi-select → DnD → visual polish → undo → edge cases.
