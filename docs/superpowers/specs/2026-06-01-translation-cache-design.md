# Translation Cache Design

## Purpose

Users reading the same article often look up the same word repeatedly. Each lookup triggers a full AI API call, causing unnecessary latency and token consumption. Add an in-memory cache to skip redundant API calls.

## Scope

- Session-scoped cache: lives in Service Worker memory, cleared on browser/extension restart
- Only caches successful API responses (not errors)
- Single file change: `background.js`

## Cache Key

Format: `"{text}::{isWord}"`

- `text`: the selected text (word or sentence)
- `isWord`: `true` for word mode, `false` for sentence mode

Two modes produce different system prompts and response structures, so they must be cached separately.

## Cache Storage

A plain `Map` in the Service Worker's module scope:

```js
const translationCache = new Map();
```

### Why Map (not chrome.storage)

| Concern | Map | chrome.storage |
|---------|-----|----------------|
| Read latency | Synchronous, microseconds | Async I/O |
| Session lifecycle | Automatic (SW teardown) | Manual TTL/cleanup needed |
| Serialization | None needed | JSON serialization overhead |
| Storage quota | N/A | Consumes extension quota |
| Code complexity | 2 lines | ~10+ lines |

## Data Flow

```
content.js sends { action: "translate", text, isWord }
  │
  ▼
background.js handleTranslation(text, isWord)
  │
  ├─ cache key = `${text}::${isWord}`
  ├─ cache.get(key) → hit → return cached result
  │
  └─ miss → getAiResponse(...) → cache.set(key, result) → return result
```

## Behavior

- **Hit**: instant response, zero API cost
- **Miss**: normal API call, result stored for subsequent hits
- **Error**: not cached — retried on next lookup (allows transient failures to recover)
- **Capacity**: unbounded. Per-session word lookups in a reading context are unlikely to exceed a few hundred entries

## Files Changed

| File | Change |
|------|--------|
| `background.js` | Add `Map` cache, wrap API call with cache check/put |

## Non-Goals

- Persistent cache across sessions
- Cache size limits or eviction policies
- Cache invalidation UI in the popup
- Caching error responses
