# DingTag — Navigation Map

Use this file instead of scanning full sources. Line numbers are approximate; grep to refine.

## Files

| File | Role | Size hint |
|------|------|-----------|
| `DingTalk_Extension/content.js` | Chrome extension: UI, DOM automation, local API | ~5700 lines |
| `aibot_dingver.py` | FastAPI :54321, transcribe/QC/formalize, GUI | ~2500 lines |
| `prompts.py` | LLM prompts | small |

## Local API (`aibot_dingver.py`)

| Route | ~line | Purpose |
|-------|-------|---------|
| `POST /api/transcribe` | 729 | Audio → transcript + QC |
| `GET /api/transcribe/job/{id}` | 304 | Async job |
| `GET /api/stats` | 773 | Session stats |
| `POST /api/formalize` | 779 | Formal text |
| `POST /api/physical_click` | 792 | Physical click |

Port `54321`. CORS: `scale.dingtalk.com`.

## Extension (`content.js`) — key symbols

| Function | ~line | Role |
|----------|-------|------|
| `postTranscribe` | 509 | `/api/transcribe` |
| `postFormalize` | 613 | `/api/formalize` |
| `postPhysicalClick` | 687 | `/api/physical_click` |
| `runTranscriptionPipeline` | ~5400 | Main auto pipeline |
| `runInvalidToVerifiedFlow` | ~3900 | Invalid / no-recheck |
| `runNoClassificationRecoveryFlow` | ~2880 | ไม่มี Classification: ซูม→ลาก→Valid→pipeline |
| `processedTaskIds` | 34 | Duplicate guard |

### Waveform / region (no Classification recovery)

| Function | ~line | Role |
|----------|-------|------|
| `findLsfAudioTag` | 2142 | Root `.lsf-audio-tag` |
| `getWaveformZoomMetrics` | 2203 | `scrollRatio`, `trackRatio`, `overflowRatio` |
| `isWaveformZoomedToFit` | 2258 | `scrollRatio ≤ 1.05` (ไม่ใช้ px คงที่) |
| `getWaveformTotalDurationSec` | 2279 | `[data-testid="timebox-end-time"]` |
| `zoomWaveformOutToFit` | 2335 | Ctrl+Wheel ลง = ซูมออก |
| `verifyWaveformRegionCoverage` | 2552 | DOM bar / canvas scan / timeline proxy |
| `createFullWaveformRegionWithVerify` | 2620 | ซูม→ลาก→verify, retry 3 |
| `dragWaveformFull` | ~2795 | ลากบน scroll div; X จาก scrollRect edgePx=0, Y กลาง canvas |

DOM: `.lsf-audio-tag > div > div[overflow scroll]` · track `div[position:absolute][top:100%]` · ซูมเข้า `scrollRatio≈2`, ออก `≈1`.

`localStorage` (recovery): `dingtag_auto_skip_no_classification`, `dingtag_no_classification_timeout_ms` · prefix `dingtag_` (grep)

## Grep cheatsheet

```bash
rg "symbol|dingtag_" DingTalk_Extension/content.js
rg "api_|def api_" aibot_dingver.py
rg "keyword" .cursor/TEAM_WORK_LOG.md
rg "keyword" .cursor/skills/dingtag-project/learnings.md
```

## Manual test

1. Run `aibot_dingver.py` — API on `127.0.0.1:54321`
2. Reload extension on `scale.dingtalk.com`
3. One task — check DevTools for API calls
