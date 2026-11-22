
## Fix: 主动引导不锁住输入框
- chat.tsx: added `nudgeSending` state; `sendNudge` no longer toggles user `sending`. Exposed in context.
- useProactiveTrigger: skips when `sending || nudgeSending` (plus existing inFlight ref).
- ChatPanel already keys only off `sending` (unchanged).
- Idle hint enabled only when `!sending && stageIncomplete` (stage empty / pillar unassigned>=1 / purpose empty for purpose|piece).
- stage.py build_history_text: empty question renders `- 主动建议（阶段）：`.
- Tests: `cd backend && uv run pytest tests/test_nudge.py tests/test_stage.py -v` → 31 passed
- Build: `cd frontend && npm run build` → built OK
