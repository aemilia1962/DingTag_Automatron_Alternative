# Examples

## Example 1: Vague bug report

**User:** extension ส่ง transcribe ซ้ำ task วนไม่จบ

**Optimized request:**
- Goal: Stop duplicate `/api/transcribe` per task ID
- Surface: content.js; Python only if double server calls
- Symbols: `processedTaskIds`, `runTranscriptionPipeline`, `postTranscribe`
- Acceptance: One transcribe per task unless forced retry

**Flow:** grep TEAM_WORK_LOG + learnings → grep symbols → minimal fix → log both files after confirm.

---

## Example 2: Team already did it

**User:** เพิ่ม transcribe ตอน Invalid อีกที

**Agent:** grep `invalid` in TEAM_WORK_LOG → finds `no-recheck` done → asks user: disable feature or new bug? No blind revert.

---

## Example 3: Good vs bad prompts

| Bad | Good |
|-----|------|
| อ่าน content.js ทั้งไฟล์ | อธิบาย `runTranscriptionPipeline` เป็น bullet |
| แก้บั๊ก extension | `postFormalize` timeout 30s → 60s manual only |

---

## Example 4: Checklist-style enhancement

**User:** Add timeout safeguard to automation script.

1. Requirements + optimized request
2. grep TEAM_WORK_LOG
3. Inspect entrypoint only
4. Minimal timeout change
5. Syntax / smoke check
6. Log + report + ได้จากรอบนี้

---

## Example 5: Learning entry (after fix)

```markdown
## 2026-05-21 — Transcribe ซ้ำ task เดิม

- **Symptom:** `/api/transcribe` ซ้ำหลัง bounce
- **Root cause:** `processedTaskIds` ช้ากว่า pipeline รอบใหม่
- **Fix:** `content.js` — `runTranscriptionPipeline` …
- **Verify:** Network tab หนึ่ง transcribe ต่อ task
- **Reuse:** grep `processedTaskIds` ก่อนแตะ Python
- **Tags:** content.js,processedTaskIds,duplicate-loop
```

---

## Example 6: TEAM_WORK_LOG entry (after push)

```markdown
## 2026-05-21 — No-recheck Invalid flow

- **Status:** done
- **Author:** team
- **Git:** `a1b2c3d` Add no-recheck invalid guard
- **Summary:** `dingtag_no_recheck_invalid` → `runInvalidToVerifiedFlow`
- **Files:** `content.js` — `noRecheckInvalidEnabled`, `runTranscriptionPipeline`
- **Do not redo:** อย่าใส่ transcribe กลับ invalid path โดยไม่ขอ user
- **Tags:** content.js,invalid,no-recheck
```
