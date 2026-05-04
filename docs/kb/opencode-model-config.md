# Настройка моделей в OpenCode

Конфигурация моделей в OpenCode задаётся через `~/.config/opencode/opencode.json`.

## Глобальные модели

| Поле | Назначение |
|------|-----------|
| `model` | Основная модель для всех задач (формат: `provider/model_key`) |
| `small_model` | Облегчённая модель для простых задач (генерация заголовков и т.п.) |
| `default_agent` | Дефолтный агент (`build`, `plan`, `review`...) |

Пример:
```json
{
  "model": "omni/fireworks/accounts/fireworks/models/kimi-k2p6",
  "small_model": "omni/fireworks/accounts/fireworks/models/gemma-4-26b-a4b-it",
  "default_agent": "build"
}
```

## Модели для агентов и субагентов

Можно задать модель для каждого агента отдельно через `command` или `mode`:

```json
{
  "command": {
    "deep-think": {
      "template": "Проведи глубокий анализ...",
      "model": "omni/fireworks/accounts/fireworks/models/kimi-k2p6"
    },
    "fast-fix": {
      "template": "Быстро исправь...",
      "model": "omni/fireworks/accounts/fireworks/models/gemma-4-26b-a4b-it",
      "subtask": true
    },
    "review-code": {
      "template": "Проведи code review...",
      "model": "omni/fireworks/accounts/fireworks/models/kimi-k2p5",
      "subtask": true
    }
  }
}
```

| Поле команды | Описание |
|-------------|---------|
| `template` | Промпт/инструкция для агента |
| `model` | Модель для этого конкретного агента |
| `subtask` | `true` — запускается как субагент |
| `description` | Описание для подсказок |

Или через `mode` (устаревший формат):
```json
{
  "mode": {
    "build": {
      "model": "omni/fireworks/accounts/fireworks/models/kimi-k2p6",
      "mode": "primary",
      "description": "Основной агент для разработки"
    },
    "review": {
      "model": "omni/fireworks/accounts/fireworks/models/kimi-k2p5",
      "mode": "subagent",
      "description": "Code review субагент"
    }
  }
}
```

## Доступные модели

Из провайдера **omni**:

| Model ID (key в config) | Описание |
|------------------------|---------|
| `fireworks/accounts/fireworks/models/kimi-k2p6` | Kimi K2.5 — самая мощная, для сложных задач |
| `fireworks/accounts/fireworks/models/minimax-m2p7` | Minimax 2.7 — аналогично мощная |
| `fireworks/accounts/fireworks/models/glm-5p1` | GLM 5.1 |
| `fireworks/accounts/fireworks/models/gemma-4-26b-a4b-it` | Gemma 4 26B — легкая, для простых задач |
| `fireworks/accounts/fireworks/models/gemma-4-31b-it` | Gemma 4 31B — средняя |
| `fireworks/accounts/fireworks/models/qwen3p6-plus` | Qwen 3.6 |
| `fireworks/accounts/fireworks/models/kimi-k2p5` | Kimi K2.5 — хороший баланс цена/качество |

**Формат model ID:** `provider/model_key`

## Пример полной конфигурации

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "omni/fireworks/accounts/fireworks/models/kimi-k2p6",
  "small_model": "omni/fireworks/accounts/fireworks/models/gemma-4-26b-a4b-it",
  "default_agent": "build",

  "command": {
    "deep-analysis": {
      "template": "Проведи глубокий архитектурный анализ",
      "model": "omni/fireworks/accounts/fireworks/models/kimi-k2p6",
      "subtask": true,
      "description": "Глубокий анализ сложных задач"
    },
    "quick-fix": {
      "template": "Быстро исправь проблему",
      "model": "omni/fireworks/accounts/fireworks/models/gemma-4-26b-a4b-it",
      "subtask": true,
      "description": "Быстрые правки"
    },
    "code-review": {
      "template": "Проведи code review",
      "model": "omni/fireworks/accounts/fireworks/models/kimi-k2p5",
      "subtask": true,
      "description": "Review кода"
    }
  }
}
```

## Полезные параметры агентов

| Параметр | Описание |
|---------|---------|
| `temperature` | Температура сэмплирования (0–1) |
| `top_p` | Top-p сэмплирование |
| `steps` / `maxSteps` | Максимум итераций агента |
| `prompt` | Системный промпт агента |
| `permission` | Разрешения на операции (`read`, `edit`, `bash`, `task`...) |
| `variant` | Вариант модели (для моделей с несколькими вариантами) |

## Ссылки

- Схема конфига: `https://opencode.ai/config.json`
- Документация: `https://opencode.ai/docs`
