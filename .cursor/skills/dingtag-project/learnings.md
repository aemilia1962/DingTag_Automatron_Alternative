# DingTag — Learnings Log



บันทึกสะสมใน repo — แชร์กับทีมได้ ยิ่งแก้ปัญหาแล้วจด ยิ่งมีแนวทางย้อนดูในอนาคต



**ไม่สับกับ** [.cursor/TEAM_WORK_LOG.md](../../TEAM_WORK_LOG.md) — ไฟล์นั้นจดว่า *ทำอะไรไปแล้ว* ไฟล์นี้จดว่า *แก้อย่างไรถึงได้ผล*



**กฎ:** เพิ่มรายการใหม่ที่ **ด้านบนสุด** (ใต้ `---` แรก) ห้ามลบประวัติเก่า · **จดทันทีหลังจบรอบ** — ไม่รอ push; ยังไม่ทดได้เขียนใน **Verify** ก่อน



---



<!-- รายการใหม่อยู่ด้านล่างบรรทัดนี้ -->

## 2026-05-21 — Cancel skip แล้วลาก region ทับ (Invalid มี region แล้ว)

- **Symptom:** Was skipped → Cancel skip งาน Invalid ที่ลาก region ไว้แล้ว — bot ลากทับ + recovery กด Valid
- **Root cause:** หลัง Cancel skip เช็ค DOM เร็วเกิน (650ms) ยังไม่เห็น Invalid ใน sidebar → เข้า recovery ลากใหม่
- **Fix:** `hasAdequateExistingWaveformRegion` + `waitForPostCancelSkipReady` (~3.5s) — มี Invalid/region แล้วข้ามลาก; Invalid ไม่กด Valid ทับ (ext 1.8.3)
- **Verify:** ยังไม่ทด — Cancel skip บน task Invalid+region → log `ข้ามลาก — มี Classification invalid`
- **Reuse:** `verifyWaveformRegionCoverage({ requireZoomFit: false })` สำหรับ region เดิม
- **Tags:** cancel_skip, invalid, region, overwrite

## 2026-05-21 — "No region" = UI ว่าง ไม่ใช่ combo

- **Symptom:** หลัง Cancel skip ไม่มี Valid/Invalid / No annotation items (ไม่ใช่ข้อความ combo) — ค้างรอ target
- **Root cause:** ทีมเรียก "No region" แต่โค้ดเดิมหาแค่ข้อความ `no region` ใน value; สถานะจริงคือ `missing` + panel ว่าง
- **Fix:** `isAnnotationPanelEmpty()` · `shouldRunWaveformRecoveryImmediately` สำหรับ missing/ว่าง · Cancel skip → `cancel_skip_empty_annotation` → recovery ทันที (ext 1.8.2)
- **Verify:** ยังไม่ทด — เปรียบรูปว่าง vs รูปมี Valid+region เขียว
- **Reuse:** ข้อความ `No annotation items`; ไม่มี `.lsf-annotation-items__result-item` Classification
- **Tags:** no_region, cancel_skip, empty-ui

## 2026-05-21 — Was skipped ไม่มีปุ่ม Update → Cancel skip ก่อน

- **Symptom:** งาน skip มาแล้ว รัน pipeline จบแต่ไม่มี Update — bot กด Shift+↓ งานไม่ถูกส่งจริง
- **Root cause:** Label Studio แสดง `Was skipped` + `Cancel skip` แทน `Update` จนกว่าจะยกเลิก skip
- **Fix:** `isTaskWasSkipped` + `ensureCancelSkipIfWasSkipped` — เรียกต้น `runTranscriptionPipeline`, `runNoClassificationRecoveryFlow`, และก่อนลูป `clickUpdateWithEnabledCheck`
- **Verify:** ยังไม่ทด — reload ext 1.8.0, เปิด task ที่ขึ้น Was skipped, ดู log `Cancel skip` แล้ว pipeline กด Update ได้
- **Reuse:** DOM `.lsf-controls__skipped-info`, `button[aria-label="cancel-skip"]`
- **Tags:** skip, update, lsf-controls

## 2026-05-21 — Region ช่องว่างซ้าย–ขวา (pad 3px)

- **Symptom:** region เขียวเหลือช่องเล็กๆ ที่ 0.000 และปลายขวา — ตรงกับ `left+3` / `right-3`
- **Root cause:** `edgePx=3` เว้นขอบ scroll viewport ทั้งสองด้าน
- **Fix:** `dragWaveformFull` default `edgePx=0` — ลากชิด `scrollRect.left` → `scrollRect.right`
- **Verify:** reload 1.7.9 — region ชิดขอบซ้าย; ปลายขวายังต้องดูซูม (`endGap`) แยกจาก pad
- **Reuse:** อย่าใช้ pad 3px ถ้าต้องการเต็มช่วง; ปัญหาขวาใหญ่ = ซูม/timeline ไม่ใช่ pad อย่างเดียว
- **Tags:** edgePx, dragWaveformFull, 1.7.9

## 2026-05-21 — verifyWaveformRegionCoverage TDZ crash

- **Symptom:** `ReferenceError: Cannot access 'timelineEndGap' before initialization` หลังลาก — recovery ข้าม task
- **Root cause:** ใส่ `timelineEndGap`/`spanOk` ใน object `metrics` ก่อนประกาศ `const`
- **Fix:** ประกาศ `timelineEndGap` + `spanOk` ก่อนสร้าง `metrics`
- **Verify:** reload 1.7.8 — ไม่มี error หลังบรรทัด `ลาก waveform เต็มช่วง`; มี `region verify OK/FAIL`
- **Reuse:** อย่าอ้างตัวแปรใน return object ก่อน `const` ใน JS
- **Tags:** verifyWaveformRegionCoverage, ReferenceError, TDZ, 1.7.8

## 2026-05-21 — ลาก region: ใช้ scrollRect ไม่ใช่ canvas X

- **Symptom:** ลากจาก canvas แล้ว region ไม่ครอบ timeline เต็มแม้ซูมออกแล้ว
- **Root cause:** LSF ผูก selection กับ `div[overflow:scroll]` + spacer width มากกว่าขอบ `#waveform-layer-main` (sticky)
- **Fix:** `xStart/xEnd` จาก `scroller.getBoundingClientRect()` ±3px; `y` กลาง canvas; `dispatchDragOnElement(scroller)` เท่านั้น
- **Verify:** ext 1.7.7 — log `ลาก waveform เต็มช่วง (scroll div)` + `verifyWaveformRegionCoverage` OK
- **Reuse:** ซูมยัง wheel ที่ scroller; `scrollLeft=0` ก่อนลาก; เก็บ `endGap` + verify
- **Tags:** waveform, scroller, scrollRect, dragWaveformFull, 1.7.7

## 2026-05-21 — Region ลากไม่ถึงปลายไฟล์

- **Symptom:** region เขียวไม่ถึง 19.4s; timeline สุดท้าย 18.75s; ลากแบบ 2%–98% ขาดปลาย
- **Root cause:** margin แบบ % บน canvas; ซูมหยุดแค่ scrollRatio โดยไม่ดู gap ปลาย timeline; ป้าย timeline ไม่แสดงเวลาเต็มทุกครั้ง
- **Fix:** `dragWaveformFull` ใช้ inset 2px ชิดขอบ + ลาก 3 แนว Y บน canvas+scroller; `isWaveformReadyForFullRegionDrag` ใช้ `total - timelineEnd ≤ 0.85s`; verify ใช้ green scan บน canvas
- **Verify:** ext 1.7.6 reload → Console `getWaveformTimelineEndGapSec()` หลังซูม; region เขียวชิดขอบขวา; log ไม่มี `timeline_end_gap`
- **Reuse:** อย่าใช้ 0.02–0.98; ใช้ gap วินาทีไม่ใช่ coverage 0.99 อย่างเดียว
- **Tags:** waveform, region, dragWaveformFull, timeline gap, 1.7.6

## 2026-05-21 — Waveform region: ซูมออก + ลาก + verify (ratio ไม่ใช่ px คงที่)

- **Symptom:** ไม่มี Classification ต้องลากสร้าง region; ซูมเข้าแล้วลากได้แค่ส่วนที่มองเห็น; 867px vs 1729px จาก DOM ไม่ใช้ได้ข้ามจอ/ขนาดหน้าต่าง
- **Root cause:** Label Studio วาด region บน `#waveform-layer-main`; ซูม = `scrollWidth/clientWidth`; ค่า px ใน `style.width` ของ track เปลี่ยนตาม viewport
- **Fix:** `runNoClassificationRecoveryFlow` → `createFullWaveformRegionWithVerify`: `zoomWaveformOutToFit` (Ctrl+Wheel ลง) → `dragWaveformFull` (2%–98% canvas) → `verifyWaveformRegionCoverage`. ซูมพอเมื่อ `scrollRatio ≤ 1.05`; region พอเมื่อ `widthRatio ≥ 0.9` หรือ timeline proxy ≥ 0.88
- **Verify:** ยังไม่ทดบน production — แผน: Console `getWaveformZoomMetrics()` (ซูมออก `scrollRatio≈1`, เข้า `≈2`); Bot log `region verify OK`; resize หน้าต่าง
- **Reuse:** อย่า hardcode 867/1729; ใช้ `.lsf-audio-tag` scroller + `scrollRatio`; duration จาก `[data-testid="timebox-end-time"]`
- **Tags:** waveform, region, zoom, scrollRatio, lsf-audio-tag, dragWaveformFull, verifyWaveformRegionCoverage, no-classification


