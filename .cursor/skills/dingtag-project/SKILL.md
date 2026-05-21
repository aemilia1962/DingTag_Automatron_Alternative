---
name: dingtag-project
description: DingTag / DingTalk automation project workflow — token-efficient edits, team work log, and cumulative learnings. Use when implementing, fixing, updating, or reviewing code in this repo (especially DingTalk_Extension/content.js, aibot_dingver.py, prompts.py, config, extension, local API port 54321, transcribe, formalize, or automation checklist tasks).
---

# DingTag Project

Skill เดียวสำหรับโปรเจกต์นี้ — Cursor **โหลดอัตโนมัติ** เมื่องานเกี่ยวกับ DingTag (ไม่ต้องพิมพ์ชื่อ skill ทุกครั้ง)

## When to use

- แก้ / เพิ่ม / ดีบักโค้ดใน repo นี้
- งาน `content.js`, `aibot_dingver.py`, `prompts.py`, extension, build scripts
- ต้องการ workflow สั้น ประหยัด token จด team log + learnings

**Default scope (core):** `DingTalk_Extension/content.js`, `aibot_dingver.py`, `prompts.py` — ขยายไฟล์อื่นเมื่อ user ระบุ

## Verbatim flow (from team)

gather requirements → check TEAM_WORK_LOG → optimize request → grep learnings → inspect files → minimal edits → run checks → report → log work + learning → ได้อะไรจากรอบนี้เพื่อรอบหน้า

## Every request: optimize first (mandatory)

ก่อนอ่านโค้ด — ย่อคำสั่ง user เป็น **Optimized request** (≤12 บรรทัด) แล้วทำตามนั้นเท่านั้น

```markdown
### Optimized request
- Goal: [one sentence]
- Surface: [files or area]
- Symbols: [names or TBD via grep]
- Acceptance: [observable pass/fail]
- Out of scope: [exclusions]
```

- ตัดคำพูดซ้ำ / log ยาว — เหลือแค่ error line + บริบท 1 บรรทัด
- ถามคำถามเดียวเมื่อ acceptance ไม่ชัด

## Team work log: [.cursor/TEAM_WORK_LOG.md](../../TEAM_WORK_LOG.md)

*ทำอะไรไปแล้ว* — กันทีมแก้ซ้ำหลัง push/pull

**กฎจด (ตามที่ทีมต้องการ):** ทำอะไรจบรอบหนึ่ง → **จดทันที** ไม่รอ push ไม่รอทดบนเว็บ · push แค่เติม hash ใน **Git:**

**ก่อนแก้:** `grep` จาก Optimized request → ถ้า `Status: done` overlap → แจ้ง user อ้าง entry → ถาม ต่อยอด / regression / ยกเลิก — **อย่าทำซ้ำเอง**

**หลังจบรอบ** (แก้โค้ด / สำรวจ flow / ตอบคำถาม architecture ที่มีผลกับโค้ด — ไม่ใช่แชทสั้นๆ ไม่แตะ repo): prepend ด้านบนสุด:

```markdown
## YYYY-MM-DD — หัวข้องาน

- **Status:** done | in-progress
- **Author:** team
- **Git:** `hash` subject | not pushed
- **Summary:** bullets
- **Files:** `path` — symbols
- **Do not redo:** …
- **Tags:** …
```

**หลัง push (ถ้ามี):** `git log -1 --format="%h %s"` อัปเดต **Git** ใน entry ที่เกี่ยว · แนะนำ commit รวม log + learnings

## Learnings: [learnings.md](learnings.md)

*แก้อย่างไร / ควรทำอย่างไร* — แนวทางรอบหน้า

**ก่อนแก้:** `grep` 2–4 คำจาก symptom/symbol  
**หลังจบรอบ (จดเลย):** prepend entry (Symptom, Root cause, Fix, Verify, Reuse, Tags) — ~15 บรรทัด  
- **Verify:** `ยังไม่ทด` | ขั้นตอนทดสั้นๆ | `ยืนยันแล้ว` — อัปเดตบรรทัดนี้ทีหลังได้ ไม่ต้องรอถึงจะสร้าง entry

| TEAM_WORK_LOG | learnings.md |
|---------------|--------------|
| ทำอะไรแล้ว | แก้อย่างไรได้ผล |
| ทุกไฟล์ในโปรเจกต์ | เน้นงานแก้จริง |

## Token budget

| Do | Don't |
|----|--------|
| grep ก่อน | อ่าน `content.js` ทั้งไฟล์ |
| อ่าน ≤120 บรรทัดรอบจุดแก้ | วางโค้ดยาวใน reply |
| diff เล็ก ตรงงาน | refactor นอก scope |
| [reference.md](reference.md) เป็นแผนที่ | สำรวจ architecture ซ้ำทุกครั้ง |

## Architecture (minimal)

```
scale.dingtalk.com → content.js → 127.0.0.1:54321 → aibot_dingver.py
```

API: `/api/transcribe` · `/api/formalize` · `/api/physical_click`  
Pipeline หลัก: `runTranscriptionPipeline`

### Waveform region (no Classification)

- Flow: `runNoClassificationRecoveryFlow` → `createFullWaveformRegionWithVerify` (ซูม → scrollLeft=0 → ลาก → verify)
- ซูมพอ: `scrollRatio ≤ 1.05` + `endGap` — **อย่า** hardcode px (867/1729)
- ลาก: `dragWaveformFull` — X จาก **scrollRect** ±3px บน `findWaveformHorizontalScroller()`, Y กลาง canvas
- Region: `verifyWaveformRegionCoverage` — รายละเอียดใน [learnings.md](learnings.md)

## Workflow (ทำตามลำดับ)

1. **Gather requirements** — เข้าใจเป้าหมาย + acceptance
2. **Optimized request** — ย่อคำสั่ง (ด้านบน)
3. **TEAM_WORK_LOG** — grep กันซ้ำ
4. **learnings.md** — grep แนวทางเคยแก้
5. **Locate** — grep + [reference.md](reference.md)
6. **Inspect** — อ่านเฉพาะช่วงที่จำเป็น
7. **Minimal edits** — style เดิม, `runToken` guards ใน extension
8. **Run checks** — syntax / smoke ที่เกี่ยว; ถ้ารันไม่ได้ → บอกวิธีทด manual
9. **Record** — TEAM_WORK_LOG + learnings **ทันที** (ไม่รอ push/verify)
10. **Report** — รูปแบบด้านล่าง + สิ่งที่ได้จากรอบนี้ (1 bullet สำหรับรอบหน้า)

## Execution rules

- แก้เฉพาะงานที่ขอ · ไม่ refactor ที่ไม่เกี่ยว
- ไฟล์ API/model เปลี่ยน → เช็คทั้ง extension + Python (ดู Cross-file)
- จบด้วย recap สั้น + next actions

## Cross-file change rules

| Change in | Also check |
|-----------|------------|
| API shape | `postTranscribe`/`postFormalize` + FastAPI models/routes |
| Formal model list | `MANUAL_FORMAL_MODEL_OPTIONS` + `MANUAL_FORMAL_OVERRIDE_MODELS` |
| localStorage flag | Settings UI + pipeline read site |
| LLM prompts | `prompts.py` + caller ใน `aibot_dingver.py` |

## Response format

```markdown
### Optimized request
...

### Requirement understanding
(one line)

### Changes
- path: symbol — what/why

### Checks
(results or manual steps)

### Test
1. ...

### Team work log
(done / conflict / none)

### Past learnings used
(none or one bullet)

### Logged
- Work log: title (ทันทีหลังจบรอบ)
- Learning: title (ทันที — Verify ระบุยังไม่ทดได้)

### ได้จากรอบนี้
(one concrete takeaway for next time)

### Notes
(optional, ≤3 bullets)
```

## Additional resources

- [reference.md](reference.md) — symbol map
- [examples.md](examples.md) — ตัวอย่าง prompt + log entries
- [TEAM_WORK_LOG.md](../../TEAM_WORK_LOG.md)
- [learnings.md](learnings.md)
