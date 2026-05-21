# DingTag — Team Work Log

บันทึกว่า **ทีมทำอะไรไปแล้ว** (แยกจาก `learnings.md` ที่เน้น *แก้อย่างไรถึงได้ผล*)

| ไฟล์ | ใช้เมื่อ |
|------|---------|
| **TEAM_WORK_LOG.md** (ไฟล์นี้) | กันซ้ำ — รู้ว่า feature/fix ไหนทำไปแล้ว อย่าแก้ทับโดยไม่ตั้งใจ |
| `skills/dingtag-project/learnings.md` | แนวทางแก้ปัญหา — symptom, root cause, reuse |

**Sync:** commit + push เมื่อสะดวก → เครื่อง/Agent อื่น `git pull` · **จด entry ทันทีหลังทำ** ไม่ต้องรอ push

**กฎ:** รายการใหม่อยู่ **ด้านบนสุด** (ใต้ `---` แรก) · ห้ามลบประวัติ · `Git: not pushed` จนกว่าจะ commit · ถ้างานถูกยกเลิก/ทำใหม่ → entry ใหม่ + `supersedes`

---

<!-- รายการงาน — ใหม่สุดอยู่ด้านล่างบรรทัดนี้ -->

## 2026-05-21 — No region = UI ว่าง (ไม่มี Valid/Invalid)

- **Status:** done
- **Author:** team
- **Git:** not pushed
- **Summary:** แก้ความเข้าใจ No region ตาม screenshot; `isAnnotationPanelEmpty` + recovery ทันทีเมื่อว่าง; ext 1.8.2
- **Files:** `content.js`, `manifest.json`, `flows.md`, `learnings.md`
- **Tags:** no_region, empty-ui, cancel_skip

## 2026-05-21 — แก้ค้าง Classification No region หลัง Cancel skip

- **Status:** done
- **Author:** team
- **Git:** not pushed
- **Summary:** ตรวจ `no_region` ใน sidebar; recovery ทันทีแม้ Waveform recovery ปิด; ext 1.8.1
- **Files:** `content.js`, `manifest.json`, `flows.md`, `reference.md`, `learnings.md`
- **Tags:** no_region, cancel_skip, stuck

## 2026-05-21 — Was skipped → กด Cancel skip ก่อน pipeline/Update

- **Status:** done
- **Author:** team
- **Git:** not pushed
- **Summary:** `ensureCancelSkipIfWasSkipped` เมื่อเจอ Was skipped; ext 1.8.0
- **Files:** `DingTalk_Extension/content.js`, `manifest.json`, `flows.md`, `reference.md`, `learnings.md`
- **Tags:** skip, update, extension

## 2026-05-21 — แยก Flow ไป flows.md (ไม่ใส่ยาวใน SKILL)

- **Status:** done
- **Author:** team
- **Git:** not pushed
- **Summary:** สร้าง `flows.md` เก็บ flowchart waveform+Valid; SKILL ลิงก์สั้นๆ เท่านั้น
- **Files:** `.cursor/skills/dingtag-project/flows.md`, `SKILL.md`
- **Tags:** docs, waveform, skill

## 2026-05-21 — แก้ ReferenceError verifyWaveformRegionCoverage

- **Status:** done
- **Verify:** ยังไม่ทด — reload ext 1.7.8
- **Author:** team
- **Git:** not pushed
- **Summary:** ย้าย `timelineEndGap`/`spanOk` ก่อนสร้าง `metrics` (แก้ TDZ)
- **Files:** `content.js` — `verifyWaveformRegionCoverage`
- **Tags:** waveform, bugfix

## 2026-05-21 — ลาก region บน scroll div + scrollRect (ไม่ใช้ canvas X)

- **Status:** done
- **Verify:** ยังไม่ทด — reload ext 1.7.7
- **Author:** team
- **Git:** not pushed
- **Summary:** `dragWaveformFull` วัด X จาก `scroller.getBoundingClientRect()` pad 3px, Y กลาง canvas, `dispatchDragOnElement(scroller)`; ซูม/verify/endGap คงเดิม
- **Files:** `content.js` — `dragWaveformFull`; `manifest.json` 1.7.7
- **Do not redo:** อย่ากลับไปวัด xStart/xEnd จาก canvas rect เป็นหลัก
- **Tags:** waveform, region, scroller, drag

## 2026-05-21 — แก้ลาก region ไม่เต็ม (inset px + timeline gap)

- **Status:** done
- **Verify:** ยังไม่ทด — reload ext 1.7.6 แล้วดู region ถึงปลาย ~19.4s
- **Author:** team
- **Git:** not pushed
- **Summary:** ลากชิดขอบ 2px แทน 2%–98%; ซูมจน endGap≤0.85s; ลาก 3 แนว Y + scroller; verify เข้มขึ้น
- **Files:** `content.js` — `dragWaveformFull`, `isWaveformReadyForFullRegionDrag`, `verifyWaveformRegionCoverage`; `manifest.json` 1.7.6
- **Do not redo:** อย่ากลับไปใช้ startRatio/endRatio 0.02/0.98 เป็นหลัก
- **Tags:** waveform, region, drag, fix

## 2026-05-21 — Waveform recovery: ซูมออก + ลาก region + verify

- **Status:** done
- **Verify:** ยังไม่ทดบน scale.dingtalk.com (reload extension แล้วลอง recovery)
- **Author:** team
- **Git:** not pushed
- **Summary:** ขยาย no-classification recovery — Ctrl+Scroll ซูมออก, ลากเต็ม canvas, verify region แบบ ratio; ไม่ผ่าน → Shift+↓
- **Files:** `DingTalk_Extension/content.js` — `zoomWaveformOutToFit`, `getWaveformZoomMetrics`, `verifyWaveformRegionCoverage`, `createFullWaveformRegionWithVerify`, `runNoClassificationRecoveryFlow`
- **Do not redo:** อย่าใช้ threshold px คงที่ (867/1729/overflow≤6px) สำหรับซูม — ใช้ `scrollRatio` แทน
- **Tags:** waveform, region, recovery, extension
