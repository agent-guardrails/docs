# 06 — Engine Configuration (v1.1: tool-first stages)

Version 1.1 · 2026-10-31 · Supersedes the rules-grammar draft (never shipped)
Schema: `schemas/shell-warden.config.v1.schema.json`

## 6.0 Core principle (ADR-0008)

The engine core is a **pure orchestrator**: it walks stages, invokes their tools,
aggregates verdicts. It contains **zero decision logic** — no rule grammar, no
matchers, no command parsing.

Every stage is an **external tool**: a program that receives the invocation
context on stdin and returns a verdict on stdout. Declarative pattern matching,
readability gating, MCP routing — all live in tools. Reference tools
(`warden-match`, `warden-legible`) ship for the common cases, so simple setups
need no custom binaries.

## 6.1 Config file & trust

| | |
|---|---|
| Path | `$XDG_CONFIG_HOME/shell-warden/config.jsonc` — single file, user-global only |
| Trust | Tools and stages are executable policy; a repository can never supply them (ADR-0003) |

Reload: on file change the engine re-validates; valid → atomic swap (stage pools
restart as needed); invalid → last-good stays active, violation counted.

## 6.2 Top-level schema

```jsonc
{
  "version": 1,                       // REQUIRED, must be 1
  "defaults": {
    "action": "ask"                   // aggregate verdict when no stage decided
  },
  "limits": {
    "stages": 64,                     // hard cap (fail-closed против кривых конфигов)
    "configBytes": 262144,
    "factsBytes": 16384,
    "factsDepth": 8,
    "maxConcurrentTools": 16          // cap on persistent tool processes
  },
  "stages": [ /* §6.3 — REQUIRED, ordered; порядок массива = порядок исполнения */ ]
}
```

Strict validation: unknown keys, wrong types, cap violations ⇒ config invalid
(last-good / fatal start — never fail-open).

## 6.3 Stage schema

```jsonc
{
  "id": "route-api",                   // REQUIRED, ^[a-z][a-z0-9-]{0,31}$, уникален

  "tool": { /* §6.4 — REQUIRED: контракт вызова инструмента */ },

  "messageMode": "append",             // "append" | "replace" (default "append")
                                       //   policy-стадии:  "append"  (причина дополняет)
                                       //   format-стадии:  "append"  (обычно standalone)
                                       //   redirect-стадии: "replace" (инструкция-замена)
                                       //   Первый deny останавливает walk (ADR-0012)

  "voteOn": "always",               // "always" | "ask" (default "always")
                                       //   "ask": стадия исполняется только когда агрегат
                                       //   = ask (команда идёт на человеческое ревью). Стадия не
                                       //   пересматривает policy-доверие: allow = автоматическое
                                       //   доверие, формат-гейт не мешает (ADR-0007).
                                       //   Рекомендация: format-стадии → "ask",
                                       //   redirect/policy → "always".

  "exclusive": false,                  // ненулевой вердикт стадии → поздние стадии НЕ вызываются
                                       //   (redirect-поглощение: сам инструмент решает свою
                                       //    релевантность; noop-ответ изъятия не делает)
  "passive": false,                    // audit-only: инструмент вызывается, его вердикт
                                       //   не влияет на агрегат

  "budget": {                          // опц. (§6.6): обычно для deny-с-рекомендацией стадий
    "maxRejections": 3,
    "windowMs": 1800000
  },
  "enabled": true                      // профили: выключить стадию без удаления
}
```

**Порядок исполнения = позиция в массиве.** Числовых приоритетов нет;
`family`/`kind`/`scope` как поля схемы не существуют — см. ADR-0008.

## 6.4 Tool invocation contract

### 6.4.1 The `tool` object

```jsonc
"tool": {
  // ── что запускать ──
  "command": ["/usr/local/bin/warden-route", "--family=routing"],
      // REQUIRED. Абсолютный argv[0], без shell. Отдельные argv-члены поддерживают
      // {env:NAME} (резолв из окружения движка при загрузке конфига); после
      // раскрытия argv[0] обязан остаться абсолютным. Настройки инструмента —
      // через argv или его собственный конфиг-файл.
  "cwd": "/var/lib/warden",            // default: engine state dir

  // ── окружение процесса (наследование + override + подстановки) ──
  "env": {
    "WARDEN_MODE": "strict",               // литерал: установить / переопределить
    "WARDEN_TOKEN": "{env:GITHUB_TOKEN}",  // {env:NAME}: резолв из окружения движка
    "GITHUB_TOKEN": null                   // null = убрать из наследуемого
  },
  // Итог = наследуемое окружение цепочки (сервер → движок → стадия) + этот патч.
  // {env:NAME} резолвится при загрузке конфига из окружения процесса движка
  // (= унаследованный хост-env); unset → config invalid (fail-closed).
  // С учётом наследования это алиасинг/явная фиксация, а не канал доступа:
  // переменная и так доходит до инструмента по цепочке.

  // ── lifecycle ──
  "lifecycle": "persistent",           // "persistent" (default) | "spawn"
  "idleTimeoutMs": 300000,             // persistent: убить процесс при простое

  // ── границы вызова ──
  "timeoutMs": 1000,                   // 1..30000 — дедлайн одного вызова
  "killGraceMs": 250,                  // SIGTERM → SIGKILL
  "maxOutputBytes": 65536,             // превышение = protocol violation

  // ── что передавать в stdin ──
  "input": {
    "session": { "id": true, "agent": true },
    "mcp": true                        // список подключённых MCP-серверов (для routing)
  },                                   // command/cwd входят всегда (§6.4.2)

  // ── вердикт ──
  "onError": "ask",                    // "skip" | "ask" | "deny" — НИКОГДА "allow" (I3):
                                       //   крах, таймаут, мусор, нечитаемый вывод
  "sha256": "…"                        // опц. пин бинарника; mismatch = fatal (I8)
}
```

### 6.4.2 Request (stdin, одна строка JSON)

```json
{ "protocolVersion": 1,
  "command": { "raw": "curl -s api.example.com", "cwd": "/work/repo" },
  "session": { "id": "ses_…", "agent": "build" },
  "mcp": [ { "name": "http", "status": "connected" } ] }
```

Состав фиксируется протоколом и не настраивается per-stage: `command` и `cwd`
нужны любому решателю; `session` — для per-session состояния (budget);
`mcp` — для routing-инструментов. Никаких секретов в запросе нет по
построению (I6).

### 6.4.3 Response (stdout, одна строка JSON)

```json
{ "verdict": "deny",
  "message": "use mcp__http.post instead of curl to api.example.com",
  "cacheTtlMs": 0 }
```

- `verdict` ∈ `allow | ask | deny` — REQUIRED. Единственный формат: pass/fail
  режимов нет (инструмент сам владеет своим маппингом через собственный конфиг).
- `message` ≤ 512 символов; попадает в итоговое сообщение отказа/промпта
  согласно `messageMode` стадии.
- `cacheTtlMs` — только для pass-вердиктов (I9: deny не кэшируется).
- Пустая строка = «стадия не голосует».

### 6.4.4 Outcome classification

| Исход вызова | Классификация |
|---|---|
| Валидный JSON с `verdict` | verdict стадии |
| Exit ≠ 0 — даже с валидным JSON | **onError** (инструмент сам заявил об ошибке) |
| Timeout / kill / crash (persistent) | **onError** + violation-счётчик (рестарты) |
| Oversize / нечитаемый вывод / чужой `protocolVersion` / нет ответа | **onError** + violation |
| Spawn failure (ENOENT) | **onError** + violation |

`onError ∈ { skip, ask, deny }` — никогда `allow` (I3). Нарастание violations
ведёт к рестарту пула инструмента; лестница — как в 02-protocol §2.7.

## 6.5 Stage walk & aggregation

```
verdict = defaults.action; message = ∅; owned = true
for stage of stages (порядок массива):
    if !stage.enabled:                                          continue
    if stage.voteOn == "ask" and verdict != "ask":      continue
    if !owned:                                                  continue   # exclusive-изъятие
    outcome = invoke(stage.tool, command, deadline)             # §6.4
    if outcome == onError:      outcome = stage.onError-политика
    if outcome.message:
        if stage.messageMode == "replace":  message = outcome.message
        else:                               message = compose(message, outcome.message)
    verdict = mostRestrictive(verdict, outcome.action)
    if verdict == "deny":                       break   # первый deny останавливает walk (ADR-0012)
    if stage.exclusive and outcome != noop:     owned = false   # поздние стадии не вызываются
```

- **Вердикт** — most-restrictive (`deny > ask > allow`); инвариантен к порядку.
- **Сообщение** — `replace` побеждает независимо от позиции; `append` дополняет
  (`existing — reason`); `skip` молчит при чужом deny. Порядконезависимо.
- **Управление вызовом**: `exclusive` изымает команду из поздних стадий после
  ненулевого ответа; `passive` — audit-only; `voteOn: "ask"` — стадия
  не пересматривает policy-allow. `terminal` как отдельный флаг не нужен:
  в tool-модели инструмент всегда отвечает вердиктом, различие
  «сматчил/не сматчил» отсутствует — `exclusive` покрывает оба случая.
- **Рекомендуемый порядок**: redirect-стадии (exclusive) → format-стадии
  (voteOn: ask, messageMode: append) → policy-стадии (append).

## 6.6 Rejection budget (ADR-0010)

Стадия с `budget` (обычно deny-с-рекомендацией: format, redirect) не может
отказывать агенту бесконечно:

- Движок считает deny-вердикты стадии на `(stage, sessionID)` в окне `windowMs`.
- Исчерпание `maxRejections` ⇒ стадия временно выводится из walk'а для этой
  сессии (skip); в первый пропуск добавляется notice:
  `[<id>] suspended for this session after N rejections — commands will be reviewed manually`.
- Сброс: стадия выдала не-deny вердикт для этой сессии, либо окно истекло.
- Suspension переводит команды **человеку** (ask-путь), никогда auto-allow.

## 6.7 Reference tools

| Tool | Семейство | Спецификация |
|---|---|---|
| `warden-match` | declarative matching (rule-file → вердикт) | `07-command-parsing.md` (guidance,.normative для reference) |
| `warden-legible` | readability gate (L1/L2/L3 + rejection budget) | `design/shell-legible-gate.md` |

Оба — обычные stage tools; в ядре нет ни строчки их логики.

## 6.8 Profiles

Включение/выключение семей — флагами `enabled` стадий:

```jsonc
// readability-only профиль: policy-стадии выключены
{ "id": "s1", "enabled": false }, { "id": "legible", "enabled": true }
```

Профиль = состояние конфига; переключение = правка файла (reload on save).
