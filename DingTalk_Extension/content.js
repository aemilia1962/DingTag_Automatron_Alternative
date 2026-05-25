console.log("🚀 DingTalk Auto-Pilot V21 (Local API) Loaded!");

const LOCAL_TRANSCRIBE_URL = "http://127.0.0.1:54321/api/transcribe";
const LOCAL_FORMALIZE_URL = "http://127.0.0.1:54321/api/formalize";
const LOCAL_PHYSICAL_CLICK_URL = "http://127.0.0.1:54321/api/physical_click";

let isAutoPilotOn = false;
let isProcessing = false;
/** รอก่อนคลิกแรก (ms) — คงที่; ไม่มีสไลเดอร์ใน Settings */
const READ_DELAY_MS = 1500;
/** หลังกรอก textarea → ก่อน refocus + Update (ms) — คงที่; ไม่มีสไลเดอร์ใน Settings */
const MOVE_DELAY_MS = 8000;
/** หน่วงอย่างน้อย (มิลลิวิ) จากจุดเริ่มงานจนถึงก่อนกด Accept — ถ้างานจบเร็วเกินจะรอให้ครบ; ถ้าเกินเวลานี้อยู่แล้วไม่รอเพิ่ม */
let minElapsedBeforeAcceptMs = Math.max(
    0,
    parseInt(localStorage.getItem("dingtag_min_elapsed_before_accept_ms") || "0", 10) || 0
);
// บังคับใช้เสมอ: กรอง Sensitive + Non-target auto invalid (ไม่มี toggle ใน Settings)
let autoSkipNoClassificationEnabled =
    localStorage.getItem("dingtag_auto_skip_no_classification") !== "0";
/** เปิด = เจอ Classification Invalid ไม่สลับเป็น Valid / ไม่ถอดเสียง — กด Optimized → Has Errors → เช็ค Task ID ก่อน Update */
let noRecheckInvalidEnabled = localStorage.getItem("dingtag_no_recheck_invalid") === "1";
let noClassificationTimeoutMs = Math.max(
    1000,
    parseInt(localStorage.getItem("dingtag_no_classification_timeout_ms") || "8000", 10) || 8000
);
let activeTimeouts = [];
let lastNoTargetLogAt = 0;
let runTokenCounter = 0;
let activeRunToken = 0;
/** Task ที่กำลังรัน pipeline (claim) — ตั้งตอนเริ่มงาน; ยังไม่ถือว่า "ส่ง Update แล้ว" จนกว่าจะ add เข้า processedTaskIds */
let lastProcessedTaskId = "";
/** Task ID ที่กด Update สำเร็จแล้ว — ใช้จำกัดการวนกลับไปทำซ้ำ / duplicate-loop */
const processedTaskIds = new Set();
let lastSeenUrl = location.href;
// ติดตาม task ใหม่ที่ยังไม่เจอ Classification — ใช้คำนวณว่าควร auto-skip เมื่อใด
let noClassificationTaskId = "";
let noClassificationStartedAt = 0;
/** หลัง user/bot กด Cancel skip — เปิดช่วงเวลาให้ autopilot จัดการ annotation ที่โหลดช้า */
let wasSkippedControlsVisible = false;
let postCancelSkipUntil = 0;
let postCancelSkipKickTaskId = "";
let postCancelSkipKickInFlight = false;
let lastRecoveryEndedAt = 0;
let lastRecoveryEndedTaskId = "";
const RECOVERY_REPEAT_COOLDOWN_MS = 10000;
/** กัน schedule recovery ถี่เกินเมื่อยังไม่มี Classification */
let prepRecoveryLastScheduleAt = 0;
const PREP_RECOVERY_DEBOUNCE_MS = 1200;
/** กัน recovery ซ้อน (สาเหตุเสียงเล่นซ้ำ / ลากไม่ทัน DOM) */
let activeRecoveryTaskId = "";
// ตรวจจับเมื่อ task เด้งกลับบนสุด (bounce detection)
let lastNavigatedTaskId = "";
let bounceSkipInProgress = false;
// Stuck task timeout: ถ้า task เดิมค้างนานเกินกำหนด → บังคับ Shift+↓
let stuckTaskTimeoutMs = Math.max(
    3000,
    parseInt(localStorage.getItem("dingtag_stuck_task_timeout_ms") || "10000", 10) || 10000
);
let stuckTaskDetectedAt = 0;
let stuckTaskId = "";
/** หน่วงก่อน Shift+↑/↓ เมื่อเจอ task ซ้ำ (เด้งกลับ) — คงที่; ไม่มีสไลเดอร์ใน Settings */
const DUPLICATE_SKIP_DELAY_MS = 500;
// Duplicate-loop breaker: ถ้า task เดิมถูกตรวจเจอ (แบบเด้งกลับ) เกิน threshold ครั้ง
// ภายในหน้าต่างเลื่อนนี้ → บังคับใช้ Shift+↓ แทน Shift+↑ เพื่อตัด loop ที่ Shift+↑ วนกลับมาตัวเดิม
// (default: 2 ครั้งใน 600,000 ms = 10 นาที → force clear task history)
let duplicateLoopWindowMs = Math.max(
    10000,
    parseInt(localStorage.getItem("dingtag_duplicate_loop_window_ms") || "600000", 10) || 600000
);
let duplicateLoopThreshold = Math.max(
    2,
    parseInt(localStorage.getItem("dingtag_duplicate_loop_threshold") || "2", 10) || 2
);
// เปิด/ปิด auto-reset task history เมื่อเจอ duplicate-loop
// (เมื่อปิด → จะกด Shift+↑ ขึ้นต่อไปเรื่อยๆ แทนการ clear history + Shift+↓ ทะลุ loop)
let autoResetHistoryEnabled = localStorage.getItem("dingtag_auto_reset_history_enabled") !== "0";
// Map<taskId, number[]> — เก็บ timestamp ของแต่ละครั้งที่ "เจอเด้งกลับ" สำหรับ taskId นั้น
const duplicateTaskEncounters = new Map();
// ชื่อ user ที่จะเอามาใส่ในช่อง "Annotators / Does not contain / <user>" เมื่อกด Shift+↑
// (เก็บไว้ใน localStorage เพื่อให้แต่ละเครื่องตั้งค่าของตัวเอง)
let filterAnnotatorUsername =
    (localStorage.getItem("dingtag_filter_annotator_username") || "Thai-1-Nuntawut").trim() ||
    "Thai-1-Nuntawut";
// เปิด/ปิดฟีเจอร์ Auto-Filter ทั้งหมด (hotkey Shift+↑ + ปุ่ม Apply + auto-trigger)
let autoFilterEnabled = localStorage.getItem("dingtag_auto_filter_enabled") !== "0";
let filterApplyInFlight = false;
let qcAllTasksInFlight = false;
let lastQcAllTasksAt = 0;
const QC_ALL_TASKS_COOLDOWN_MS = 30000;
// Auto-trigger: เมื่อ BOT ทำงานอยู่ + ไม่เจอ target task นาน → apply filter อัตโนมัติ
// (ผูกกับ isAutoPilotOn — bot OFF จะไม่ trigger เพราะ polling loop ไม่เข้าเงื่อนไข)
let noTargetIdleSince = 0;     // timestamp เริ่มเห็น "ไม่เจอ target" ครั้งล่าสุด
let lastAutoFilterAt = 0;       // timestamp ครั้งล่าสุดที่ auto-filter ถูก trigger (cooldown)
const NO_TARGET_AUTO_FILTER_AFTER_MS = 4000;  // ต้องไม่เจอ target ติดต่อกัน 4 วิ ก่อน trigger
const AUTO_FILTER_COOLDOWN_MS = 30000;        // 30 วิ ระหว่าง trigger แต่ละครั้ง (กัน loop)

// หลัง Order by (lumenTaskId): กดปุ่มเรียงทิศกี่ครั้ง — 1 = ท้ายก่อน, 2 = หัวก่อน (ปุ่มเดียวสลับ descending/ascending)
let orderBySortDescendingClicks = Math.min(
    2,
    Math.max(1, parseInt(localStorage.getItem("dingtag_order_by_sort_desc_clicks") || "1", 10) || 1)
);

/** โหมด extension: auto = pipeline เดิม | qc = Auto + ส่ง Update/Accept/Fix+Accept รอ queue | manual = ถอดเสียงมือ */
function normalizeExtensionMode(raw) {
    const v = String(raw || "").trim().toLowerCase();
    if (v === "manual" || v === "qc") return v;
    return "auto";
}
let extensionMode = normalizeExtensionMode(localStorage.getItem("dingtag_extension_mode"));

function isQcMode() {
    return extensionMode === "qc";
}
function isAutoLikeMode() {
    return extensionMode === "auto" || extensionMode === "qc";
}
function shouldUseShiftNavigation() {
    return extensionMode === "auto";
}

/** Manual เท่านั้น: โมเดลจัดคำ — id ต้องตรง whitelist ใน aibot_dingver (MANUAL_FORMAL_OVERRIDE_MODELS) */
const MANUAL_FORMAL_MODEL_OPTIONS = [
    { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "google/gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite (preview)" },
    { id: "openai/gpt-4o-mini", label: "GPT-4o mini" },
];
const MANUAL_FORMAL_MODEL_STORAGE_KEY = "dingtag_manual_formal_model";
const DEFAULT_MANUAL_FORMAL_MODEL_ID = "openai/gpt-4o-mini";

function getManualFormalModelId() {
    const raw = (localStorage.getItem(MANUAL_FORMAL_MODEL_STORAGE_KEY) || "").trim();
    if (raw && MANUAL_FORMAL_MODEL_OPTIONS.some((o) => o.id === raw)) {
        return raw;
    }
    return DEFAULT_MANUAL_FORMAL_MODEL_ID;
}

function manualFormalModelShortLabel(modelId) {
    const id = String(modelId || "").trim();
    const hit = MANUAL_FORMAL_MODEL_OPTIONS.find((o) => o.id === id);
    return hit ? hit.label : id || "?";
}

const MOUSE_BUTTON_LABELS = {
    0: "Mouse1 (ซ้าย)",
    1: "Mouse2 (กลาง)",
    2: "Mouse3 (ขวา)",
    3: "Mouse4 (Back)",
    4: "Mouse5 (Forward)",
};

const DEFAULT_MANUAL_TRANSCRIBE_HOTKEY = {
    inputType: "keyboard",
    key: "F8",
    code: "F8",
    button: 0,
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
};
const DEFAULT_MANUAL_FORMALIZE_HOTKEY = {
    inputType: "keyboard",
    key: "F9",
    code: "F9",
    button: 0,
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
};

function normalizeManualHotkey(raw, defaults) {
    const hk = { ...defaults, ...(raw || {}) };
    if (!hk.inputType) {
        hk.inputType = typeof hk.button === "number" && hk.button > 0 ? "mouse" : "keyboard";
    }
    return hk;
}

function loadManualHotkey(storageKey, defaults) {
    try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return { ...defaults };
        return normalizeManualHotkey(JSON.parse(raw), defaults);
    } catch {
        return { ...defaults };
    }
}

let manualTranscribeHotkey = loadManualHotkey(
    "dingtag_manual_hotkey",
    DEFAULT_MANUAL_TRANSCRIBE_HOTKEY
);
let manualFormalizeHotkey = loadManualHotkey(
    "dingtag_manual_formalize_hotkey",
    DEFAULT_MANUAL_FORMALIZE_HOTKEY
);
let manualTranscribeInFlight = false;
let manualFormalizeInFlight = false;
/** null | "transcribe" | "formalize" — กำลังรอผู้ใช้กดคีย์/ปุ่มเมาส์เพื่อบันทึก */
let hotkeyCaptureTarget = null;

function manualModifiersMatch(e, hk) {
    return (
        !!e.ctrlKey === !!hk.ctrl &&
        !!e.shiftKey === !!hk.shift &&
        !!e.altKey === !!hk.alt &&
        !!e.metaKey === !!hk.meta
    );
}

function formatManualHotkeyLabel(hk = manualTranscribeHotkey) {
    const parts = [];
    if (hk.ctrl) parts.push("Ctrl");
    if (hk.shift) parts.push("Shift");
    if (hk.alt) parts.push("Alt");
    if (hk.meta) parts.push("Meta");
    if (hk.inputType === "mouse") {
        parts.push(MOUSE_BUTTON_LABELS[hk.button] || `Mouse${(hk.button ?? 0) + 1}`);
    } else {
        parts.push(hk.key || "?");
    }
    return parts.join("+");
}

function manualHotkeyMatchesKeyboard(e, hk) {
    if (hk.inputType === "mouse") return false;
    const want = (hk.key || "").toLowerCase();
    const got = (e.key || "").toLowerCase();
    if (got !== want && e.code !== (hk.code || "")) return false;
    return manualModifiersMatch(e, hk);
}

function manualHotkeyMatchesMouse(e, hk) {
    if (hk.inputType !== "mouse") return false;
    if (e.button !== hk.button) return false;
    return manualModifiersMatch(e, hk);
}

function persistManualHotkey(target, hk) {
    const normalized = normalizeManualHotkey(hk, target === "formalize" ? DEFAULT_MANUAL_FORMALIZE_HOTKEY : DEFAULT_MANUAL_TRANSCRIBE_HOTKEY);
    if (target === "formalize") {
        manualFormalizeHotkey = normalized;
        localStorage.setItem("dingtag_manual_formalize_hotkey", JSON.stringify(manualFormalizeHotkey));
    } else {
        manualTranscribeHotkey = normalized;
        localStorage.setItem("dingtag_manual_hotkey", JSON.stringify(manualTranscribeHotkey));
    }
}

function startHotkeyCapture(target) {
    hotkeyCaptureTarget = target === "formalize" ? "formalize" : "transcribe";
    updateManualHotkeyLabels();
    const label = target === "formalize" ? "จัดคำ" : "ถอดเสียง";
    setManualStatus(`ตั้งคีย์ลัด${label}: กดคีย์บอร์ดหรือปุ่มเมาส์ (Esc ยกเลิก)`);
}

function cancelHotkeyCapture() {
    if (!hotkeyCaptureTarget) return false;
    hotkeyCaptureTarget = null;
    updateManualHotkeyLabels();
    return true;
}

function finishHotkeyCaptureFromKeyboard(e) {
    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return false;
    persistManualHotkey(hotkeyCaptureTarget, {
        inputType: "keyboard",
        key: e.key,
        code: e.code,
        button: 0,
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
        meta: e.metaKey,
    });
    const saved = formatManualHotkeyLabel(
        hotkeyCaptureTarget === "formalize" ? manualFormalizeHotkey : manualTranscribeHotkey
    );
    hotkeyCaptureTarget = null;
    updateManualHotkeyLabels();
    setManualStatus(`บันทึกคีย์ลัดแล้ว: ${saved}`);
    return true;
}

function finishHotkeyCaptureFromMouse(e) {
    persistManualHotkey(hotkeyCaptureTarget, {
        inputType: "mouse",
        button: e.button,
        key: "",
        code: "",
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
        meta: e.metaKey,
    });
    const saved = formatManualHotkeyLabel(
        hotkeyCaptureTarget === "formalize" ? manualFormalizeHotkey : manualTranscribeHotkey
    );
    hotkeyCaptureTarget = null;
    updateManualHotkeyLabels();
    setManualStatus(`บันทึกคีย์ลัดแล้ว: ${saved}`);
    return true;
}

async function waitForSelectorManual(selector, { timeoutMs = 8000, intervalMs = 200 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const el = document.querySelector(selector);
        if (el) return el;
        await delay(intervalMs);
    }
    return null;
}

function isManualBusy() {
    return manualTranscribeInFlight || manualFormalizeInFlight;
}

async function runManualTranscribe() {
    if (extensionMode !== "manual" || isManualBusy()) return;
    manualTranscribeInFlight = true;
    try {
        setManualStatus("กำลังถอดเสียง...");
        let ta = findAnnotationResultTextarea();
        if (!ta) {
            ta = await waitForSelectorManual('textarea[name="Annotation Result"]', { timeoutMs: 6000 });
        }
        if (!ta) {
            setManualStatus("ไม่พบช่อง Annotation Result");
            return;
        }
        try {
            ta.focus();
        } catch {}
        const audioBase64 = await fetchAudioAsBase64();
        if (!audioBase64) {
            setManualStatus("ไม่มีไฟล์เสียงบนหน้านี้");
            return;
        }
        const apiResult = await postTranscribe(audioBase64);
        if (!apiResult.ok) {
            setManualStatus(
                (apiResult.errorLabel || "API error") +
                    " — " +
                    String(apiResult.detail || "").slice(0, 80)
            );
            return;
        }
        const data = apiResult.data || {};
        if (data.status === "paused") {
            setManualStatus("API: ระบบ AI หยุดชั่วคราว");
            return;
        }
        if (data.status === "error") {
            setManualStatus("ถอดเสียงล้มเหลว: " + String(data.message || "").slice(0, 80));
            return;
        }
        const text = data.text || "";
        setTextareaValueAndNotify(ta, text);
        setManualStatus(
            `วางข้อความแล้ว (${text.length} ตัวอักษร) — ตรวจสอบแล้วกด Update เอง`
        );
        console.log("[DingTag Manual] ถอดเสียงและวางข้อความแล้ว | len=", text.length);
    } catch (e) {
        console.error("[DingTag Manual]", e);
        setManualStatus("เกิดข้อผิดพลาด: " + (e?.message || "unknown"));
    } finally {
        manualTranscribeInFlight = false;
    }
}

async function runManualFormalize() {
    if (extensionMode !== "manual" || isManualBusy()) return;
    manualFormalizeInFlight = true;
    try {
        setManualStatus("กำลังจัดคำ...");
        let ta = findAnnotationResultTextarea();
        if (!ta) {
            ta = await waitForSelectorManual('textarea[name="Annotation Result"]', { timeoutMs: 6000 });
        }
        if (!ta) {
            setManualStatus("ไม่พบช่อง Annotation Result");
            return;
        }
        const source = (ta.value || "").trim();
        if (!source) {
            setManualStatus("ไม่มีข้อความในช่อง — ถอดเสียงก่อนจัดคำ");
            return;
        }
        try {
            ta.focus();
        } catch {}
        const formalResult = await postFormalize(source, getManualFormalModelId());
        if (!formalResult.ok) {
            setManualStatus(
                (formalResult.errorLabel || "Formal API error") +
                    " — " +
                    String(formalResult.detail || "").slice(0, 80)
            );
            return;
        }
        const data = formalResult.data || {};
        if (data.status === "paused") {
            setManualStatus("Formal: ระบบ AI หยุดชั่วคราว");
            return;
        }
        const formatted = (data.text || "").trim();
        if (!formatted) {
            setManualStatus("จัดคำแล้วแต่ผลลัพธ์ว่าง — ใช้ข้อความเดิม");
            return;
        }
        setTextareaValueAndNotify(ta, formatted);
        const fsp = ((data.qc || {}).formalSpacing || {});
        const usedId = String(data.formalModelUsed || getManualFormalModelId() || "").trim();
        const modelTag = manualFormalModelShortLabel(usedId);
        setManualStatus(
            fsp.spacingRefined
                ? `จัดคำแล้ว (${formatted.length} ตัวอักษร, ${modelTag}, แก้เว้นวรรค) — ตรวจแล้วกด Update เอง`
                : `จัดคำแล้ว (${formatted.length} ตัวอักษร, ${modelTag}) — ตรวจแล้วกด Update เอง`
        );
        console.log("[DingTag Manual] จัดคำแล้ว | model=", usedId, "| len=", formatted.length);
    } catch (e) {
        console.error("[DingTag Manual] formalize", e);
        setManualStatus("เกิดข้อผิดพลาด: " + (e?.message || "unknown"));
    } finally {
        manualFormalizeInFlight = false;
    }
}

function clearAllTasks() {
    activeTimeouts.forEach(t => clearTimeout(t));
    activeTimeouts = [];
    isProcessing = false;
    activeRunToken = 0;
    resetTaskGate("manual_stop");
    processedTaskIds.clear();
    duplicateTaskEncounters.clear();
    // รีเซ็ต auto-filter idle tracker (จะเริ่มนับใหม่เมื่อ bot ON อีกครั้ง)
    noTargetIdleSince = 0;
    lastAutoFilterAt = 0;
    lastQcAllTasksAt = 0;
    qcAllTasksInFlight = false;
    console.log("🛑 Kill Switch: ยกเลิกการกระทำทั้งหมด! (cleared committed task history)");
}

function resetTaskGate(reason = "unknown") {
    if (lastProcessedTaskId) {
        console.log(`[DingTag] reset task gate (${reason}) | cleared task: ${lastProcessedTaskId}`);
        lastProcessedTaskId = "";
    }
    if (noClassificationTaskId) {
        noClassificationTaskId = "";
        noClassificationStartedAt = 0;
    }
}

/**
 * บันทึก encounter ของ task ซ้ำ (เด้งกลับ) แล้วคืนจำนวนครั้งที่เกิดขึ้นภายในหน้าต่าง duplicateLoopWindowMs
 *
 * ใช้สำหรับตรวจจับ loop ที่ task เดิมถูกเด้งกลับมาหลายรอบใน 2 นาที (default)
 * — เมื่อค่ากลับ >= duplicateLoopThreshold หมายความว่า Shift+↑ ก็พา loop วนกลับมาที่เดิม
 *   ต้อง override เป็น Shift+↓ เพื่อทะลุออกจาก loop
 */
function recordDuplicateEncounter(taskId) {
    if (!taskId) return 0;
    const now = Date.now();
    let timestamps = duplicateTaskEncounters.get(taskId) || [];
    timestamps = timestamps.filter((ts) => now - ts <= duplicateLoopWindowMs);
    timestamps.push(now);
    duplicateTaskEncounters.set(taskId, timestamps);
    return timestamps.length;
}

function setTextareaValueAndNotify(ta, value) {
    const proto = window.HTMLTextAreaElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) {
        desc.set.call(ta, value);
    } else {
        ta.value = value;
    }
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.dispatchEvent(new Event("change", { bubbles: true }));
}

function isRunActive(runToken) {
    return isAutoPilotOn && isProcessing && runToken === activeRunToken;
}

function safeSetTextarea(runToken, ta, value, label = "textbox") {
    if (!isRunActive(runToken)) {
        console.warn("[DingTag] Skip write (stale run):", label);
        return false;
    }
    if (!ta || !document.contains(ta)) {
        console.warn("[DingTag] Skip write (textarea gone):", label);
        return false;
    }
    setTextareaValueAndNotify(ta, value);
    return true;
}

/** หยุดเสียงเล่นอัตโนมัติหลัง Cancel skip / ก่อนลาก region */
function pauseWaveformMedia() {
    const root = findLsfAudioTag();
    const scope = root || document;
    let paused = 0;
    for (const el of scope.querySelectorAll("audio, video")) {
        try {
            el.pause();
            if (el.currentTime > 0.05) el.currentTime = 0;
            paused++;
        } catch {}
    }
    if (paused) console.log(`[DingTag] pause waveform media (${paused})`);
    return paused;
}

/** รอ canvas พร้อมหลังโหลด task (ไม่เล่นเสียงซ้ำ) */
async function waitForWaveformAnnotatable(timeoutMs = 14000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        pauseWaveformMedia();
        const canvas = findWaveformCanvas();
        if (canvas) {
            const r = canvas.getBoundingClientRect();
            if (r.width >= 200 && r.height >= 40 && canvas.width >= 50) {
                await delay(400);
                return true;
            }
        }
        await delay(250);
    }
    return !!findWaveformCanvas();
}

async function fetchAudioAsBase64() {
    pauseWaveformMedia();
    const mediaEl = document.querySelector("audio, video");
    if (!mediaEl || !mediaEl.src) {
        console.warn("[DingTag] ดูดเสียง: ไม่พบ <audio> หรือ <video> ที่มี src");
        return null;
    }
    try {
        console.log("[DingTag] ดูดเสียงจาก:", mediaEl.src.slice(0, 120) + (mediaEl.src.length > 120 ? "…" : ""));
        const response = await fetch(mediaEl.src);
        if (!response.ok) {
            console.error("[DingTag] โหลดไฟล์เสียงจากหน้าเว็บไม่สำเร็จ:", response.status, response.statusText);
            return null;
        }
        const buf = await response.arrayBuffer();
        const bytes = new Uint8Array(buf);
        const chunk = 0x8000;
        let binary = "";
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        const b64 = btoa(binary);
        console.log(
            "[DingTag] แปลงเสียงเป็น Base64 แล้ว (~" +
                Math.round(binary.length / 1024) +
                " KB ไบนารี → ~" +
                Math.round(b64.length / 1024) +
                " KB Base64)"
        );
        return b64;
    } catch (e) {
        console.error("[DingTag] fetchAudioAsBase64:", e?.name, e?.message, e);
        return null;
    }
}

/** เรียก Local API พร้อม log ละเอียด — คืน { ok, data?, errorLabel, detail } */
async function postTranscribe(audioBase64) {
    const payload = JSON.stringify({ audioBase64 });
    const kb = Math.round(payload.length / 1024);
    console.log("[DingTag] กำลัง POST ไปยัง", LOCAL_TRANSCRIBE_URL, "| ขนาด body ~" + kb + " KB");

    let res;
    try {
        res = await fetch(LOCAL_TRANSCRIBE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
        });
    } catch (e) {
        const name = e?.name || "Error";
        const msg = e?.message || String(e);
        console.error("[DingTag] fetch ไป localhost ล้มเหลว:", name, "|", msg);
        if (name === "TypeError") {
            console.error(
                "[DingTag] สาเหตุที่พบบ่อย: (1) ยังไม่ได้เปิด aibot_dingver.py หรือเซิร์ฟเวอร์ล้ม (2) Firewall บล็อกพอร์ต 54321 (3) โหลด Extension ใหม่หลังแก้ manifest — ต้องมี host_permissions http://127.0.0.1:54321/*"
            );
        }
        return {
            ok: false,
            errorLabel: "เชื่อมต่อ API ไม่ได้",
            detail: name + ": " + msg,
        };
    }

    const rawText = await res.text();
    let data;
    try {
        data = rawText ? JSON.parse(rawText) : {};
    } catch (parseErr) {
        console.error(
            "[DingTag] ตอบกลับไม่ใช่ JSON (HTTP " + res.status + "). ต้นฉบับ:",
            rawText.slice(0, 400) + (rawText.length > 400 ? "…" : "")
        );
        return {
            ok: false,
            errorLabel: "API ตอบกลับผิดรูปแบบ",
            detail: "HTTP " + res.status + " — " + (rawText.slice(0, 120) || "(ว่าง)"),
        };
    }

    if (!res.ok) {
        console.error("[DingTag] HTTP ผิดพลาด:", res.status, data);
        return {
            ok: false,
            data,
            errorLabel: "API error " + res.status,
            detail: (data && (data.message || data.detail)) || rawText.slice(0, 200),
        };
    }

    const qc = data.qc || {};
    const logParts = [
        "[DingTag] API ตอบกลับ:",
        data.status,
        "| isSensitive:",
        data.isSensitive,
        "| nonTarget:",
        qc.isNonTarget,
        "englishRatio:",
        qc.englishRatio,
        "source:",
        qc.nonTargetSource,
    ];
    if (qc.longSilence) {
        logParts.push(
            "| longSilence:",
            qc.longSilence.trigger,
            "longestRunSec:",
            qc.longSilence.longestRunSec
        );
    }
    if (qc.audioQuality) {
        logParts.push(
            "| audioQuality:",
            qc.audioQuality.trigger,
            "category:",
            qc.audioQuality.category
        );
    }
    if (qc.foreignScript) {
        logParts.push(
            "| foreignScript:",
            qc.foreignScript,
            "count:",
            qc.foreignScriptCount,
            "share:",
            qc.foreignScriptShare
        );
    }
    if (qc.centralThaiRecheck) {
        logParts.push(
            "| centralThaiRecheck:",
            qc.centralThaiRecheck.overturned ? "overturned" : "confirmed"
        );
    }
    console.log(...logParts);
    return { ok: true, data };
}

/** สั่ง formal จัดคำจากข้อความที่มีอยู่แล้ว — formalModelOverride ส่งได้เฉพาะ id ใน MANUAL_FORMAL_MODEL_OPTIONS */
async function postFormalize(text, formalModelOverride) {
    const body = { text };
    if (formalModelOverride) {
        body.formalModel = formalModelOverride;
    }
    const payload = JSON.stringify(body);
    const kb = Math.round(payload.length / 1024);
    console.log("[DingTag] กำลัง POST formalize ไปยัง", LOCAL_FORMALIZE_URL, "| ขนาด body ~" + kb + " KB");

    let res;
    try {
        res = await fetch(LOCAL_FORMALIZE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
        });
    } catch (e) {
        return {
            ok: false,
            errorLabel: "เชื่อมต่อ Formal API ไม่ได้",
            detail: (e?.name || "Error") + ": " + (e?.message || String(e)),
        };
    }

    const rawText = await res.text();
    let data;
    try {
        data = rawText ? JSON.parse(rawText) : {};
    } catch {
        return {
            ok: false,
            errorLabel: "Formal API ตอบกลับผิดรูปแบบ",
            detail: "HTTP " + res.status + " — " + (rawText.slice(0, 120) || "(ว่าง)"),
        };
    }

    if (!res.ok) {
        return {
            ok: false,
            data,
            errorLabel: "Formal API error " + res.status,
            detail: (data && (data.message || data.detail)) || rawText.slice(0, 200),
        };
    }
    return { ok: true, data };
}

/**
 * เก็บข้อมูล geometry ของ element + browser window เพื่อให้ Python คำนวณพิกัดจริงบนจอ
 * Return null ถ้า element ไม่มี / มองไม่เห็น / ขนาด 0
 */
function getElementScreenGeometry(el) {
    if (!el || typeof el.getBoundingClientRect !== "function") return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return {
        x: cx,
        y: cy,
        screenX: window.screenX || window.screenLeft || 0,
        screenY: window.screenY || window.screenTop || 0,
        outerWidth: window.outerWidth || window.innerWidth,
        outerHeight: window.outerHeight || window.innerHeight,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
    };
}

/**
 * สั่ง Python กดเมาส์จริงๆ ที่ตำแหน่ง element (ใช้แทน el.click() ในเคสที่ JS click ไม่ผ่าน)
 * geom: ผลจาก getElementScreenGeometry()
 */
async function postPhysicalClick(geom, { description = "", button = "left", moveDurationMs = 120, restorePosition = true } = {}) {
    if (!geom) {
        return { ok: false, errorLabel: "ไม่มี geometry", detail: "element rect ใช้ไม่ได้" };
    }
    const payload = JSON.stringify({
        ...geom,
        button,
        moveDurationMs,
        description,
        restorePosition,
    });
    let res;
    try {
        res = await fetch(LOCAL_PHYSICAL_CLICK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
        });
    } catch (e) {
        return {
            ok: false,
            errorLabel: "เชื่อมต่อ Physical Click API ไม่ได้",
            detail: (e?.name || "Error") + ": " + (e?.message || String(e)),
        };
    }
    const rawText = await res.text();
    let data;
    try {
        data = rawText ? JSON.parse(rawText) : {};
    } catch {
        return {
            ok: false,
            errorLabel: "Physical Click API ตอบกลับผิดรูปแบบ",
            detail: "HTTP " + res.status + " — " + (rawText.slice(0, 120) || "(ว่าง)"),
        };
    }
    if (!res.ok || data.status === "error") {
        return {
            ok: false,
            data,
            errorLabel: "Physical Click API error " + res.status,
            detail: (data && (data.message || data.detail)) || rawText.slice(0, 200),
        };
    }
    return { ok: true, data };
}

// ----------------------------------------------------
// แผงควบคุม UI
// ----------------------------------------------------
const panel = document.createElement("div");
panel.style.position = "fixed";
panel.style.bottom = "20px";
panel.style.right = "20px";
panel.style.zIndex = "999999";
panel.style.padding = "15px";
panel.style.backgroundColor = "#212529";
panel.style.color = "white";
panel.style.borderRadius = "12px";
panel.style.width = "240px";
panel.style.fontFamily = "Arial, sans-serif";

const headerRow = document.createElement("div");
headerRow.style.display = "flex";
headerRow.style.alignItems = "center";
headerRow.style.justifyContent = "space-between";
headerRow.style.gap = "8px";
headerRow.style.marginBottom = "12px";
headerRow.style.cursor = "grab";
headerRow.style.userSelect = "none";
headerRow.title = "ลากแถบนี้เพื่อย้ายแผง (จำตำแหน่งอัตโนมัติ)";

const title = document.createElement("div");
title.innerText = "🤖 DingTalk V21 (Local API)";
title.style.fontWeight = "bold";
title.style.fontSize = "13px";
title.style.lineHeight = "1.2";
title.style.flex = "1";
title.style.userSelect = "none";

const settingsBtn = document.createElement("button");
settingsBtn.type = "button";
settingsBtn.innerText = "⚙️";
settingsBtn.title = "ตั้งค่า";
settingsBtn.style.width = "30px";
settingsBtn.style.height = "30px";
settingsBtn.style.padding = "0";
settingsBtn.style.border = "none";
settingsBtn.style.borderRadius = "8px";
settingsBtn.style.cursor = "pointer";
settingsBtn.style.backgroundColor = "#343a40";
settingsBtn.style.color = "white";
settingsBtn.style.fontSize = "16px";
settingsBtn.style.display = "flex";
settingsBtn.style.alignItems = "center";
settingsBtn.style.justifyContent = "center";

headerRow.appendChild(title);
headerRow.appendChild(settingsBtn);
panel.appendChild(headerRow);

const modeSwitchRow = document.createElement("div");
modeSwitchRow.style.display = "flex";
modeSwitchRow.style.gap = "6px";
modeSwitchRow.style.marginBottom = "10px";

const modeAutoBtn = document.createElement("button");
modeAutoBtn.type = "button";
modeAutoBtn.innerText = "Auto";
modeAutoBtn.style.flex = "1";
modeAutoBtn.style.padding = "6px";
modeAutoBtn.style.border = "none";
modeAutoBtn.style.borderRadius = "6px";
modeAutoBtn.style.cursor = "pointer";
modeAutoBtn.style.fontSize = "12px";
modeAutoBtn.style.fontWeight = "bold";

const modeManualBtn = document.createElement("button");
modeManualBtn.type = "button";
modeManualBtn.innerText = "Manual";
modeManualBtn.style.flex = "1";
modeManualBtn.style.padding = "6px";
modeManualBtn.style.border = "none";
modeManualBtn.style.borderRadius = "6px";
modeManualBtn.style.cursor = "pointer";
modeManualBtn.style.fontSize = "12px";
modeManualBtn.style.fontWeight = "bold";

const modeQcBtn = document.createElement("button");
modeQcBtn.type = "button";
modeQcBtn.innerText = "QC";
modeQcBtn.style.flex = "1";
modeQcBtn.style.padding = "6px";
modeQcBtn.style.border = "none";
modeQcBtn.style.borderRadius = "6px";
modeQcBtn.style.cursor = "pointer";
modeQcBtn.style.fontSize = "11px";
modeQcBtn.style.fontWeight = "bold";

modeSwitchRow.appendChild(modeAutoBtn);
modeSwitchRow.appendChild(modeQcBtn);
modeSwitchRow.appendChild(modeManualBtn);
panel.appendChild(modeSwitchRow);

const autoView = document.createElement("div");
const manualView = document.createElement("div");
manualView.style.display = "none";

const toggleBtn = document.createElement("button");
toggleBtn.innerText = "OFF - คลิกเพื่อเปิด";
toggleBtn.style.width = "100%";
toggleBtn.style.padding = "10px";
toggleBtn.style.backgroundColor = "#dc3545";
toggleBtn.style.color = "white";
toggleBtn.style.border = "none";
toggleBtn.style.borderRadius = "6px";
toggleBtn.style.cursor = "pointer";
autoView.appendChild(toggleBtn);

const statusLabel = document.createElement("div");
statusLabel.style.fontSize = "12px";
statusLabel.style.marginTop = "10px";
statusLabel.style.padding = "8px";
statusLabel.style.borderRadius = "8px";
statusLabel.style.backgroundColor = "#343a40";
statusLabel.innerText = "สถานะ: OFF";
autoView.appendChild(statusLabel);

const settingsContainer = document.createElement("div");
settingsContainer.style.marginTop = "10px";
settingsContainer.style.paddingTop = "10px";
settingsContainer.style.borderTop = "1px solid rgba(255,255,255,0.12)";
settingsContainer.style.display = "none";

const minAcceptLabel = document.createElement("div");
minAcceptLabel.style.fontSize = "12px";
minAcceptLabel.style.marginTop = "8px";
settingsContainer.appendChild(minAcceptLabel);
const minAcceptSlider = document.createElement("input");
minAcceptSlider.type = "range";
minAcceptSlider.min = "0";
minAcceptSlider.max = "180000";
minAcceptSlider.step = "1000";
minAcceptSlider.value = String(minElapsedBeforeAcceptMs);
minAcceptSlider.style.width = "100%";
minAcceptSlider.title =
    "จากเริ่มงานแต่ละรอบถึงก่อนกด Accept ใช้เวลาอย่างน้อยเท่านี้ (ถ้างานเร็วเกินจะรอให้ครบ)";
settingsContainer.appendChild(minAcceptSlider);

const autoSkipRow = document.createElement("div");
autoSkipRow.style.display = "flex";
autoSkipRow.style.alignItems = "center";
autoSkipRow.style.justifyContent = "space-between";
autoSkipRow.style.gap = "8px";
autoSkipRow.style.marginTop = "10px";
settingsContainer.appendChild(autoSkipRow);

const autoSkipLabel = document.createElement("label");
autoSkipLabel.innerText = "🎚️ Waveform recovery (ไม่มี Classification)";
autoSkipLabel.style.fontSize = "12px";
autoSkipLabel.style.cursor = "pointer";
autoSkipRow.appendChild(autoSkipLabel);

const autoSkipToggle = document.createElement("input");
autoSkipToggle.type = "checkbox";
autoSkipToggle.checked = autoSkipNoClassificationEnabled;
autoSkipToggle.style.cursor = "pointer";
autoSkipToggle.title =
    "ถ้า task ใหม่ไม่มี Classification ภายในเวลาที่ตั้ง → Ctrl+Scroll ซูมออก waveform → ลากเต็มช่วง → กด Valid → pipeline ปกติ (ล้มเหลวจึง Shift+↓)";
autoSkipRow.appendChild(autoSkipToggle);

autoSkipLabel.addEventListener("click", () => {
    autoSkipToggle.checked = !autoSkipToggle.checked;
    autoSkipToggle.dispatchEvent(new Event("change"));
});

autoSkipToggle.addEventListener("change", () => {
    autoSkipNoClassificationEnabled = autoSkipToggle.checked;
    localStorage.setItem(
        "dingtag_auto_skip_no_classification",
        autoSkipNoClassificationEnabled ? "1" : "0"
    );
    console.log("[DingTag] Waveform recovery (no Classification):", autoSkipNoClassificationEnabled ? "ON" : "OFF");
});

const autoSkipTimeoutLabel = document.createElement("div");
autoSkipTimeoutLabel.style.fontSize = "12px";
autoSkipTimeoutLabel.style.marginTop = "8px";
settingsContainer.appendChild(autoSkipTimeoutLabel);
const autoSkipTimeoutSlider = document.createElement("input");
autoSkipTimeoutSlider.type = "range";
autoSkipTimeoutSlider.min = "2000";
autoSkipTimeoutSlider.max = "30000";
autoSkipTimeoutSlider.step = "500";
autoSkipTimeoutSlider.value = String(noClassificationTimeoutMs);
autoSkipTimeoutSlider.style.width = "100%";
autoSkipTimeoutSlider.title = "รอ Classification นานสุดเท่านี้ ก่อนเริ่ม waveform recovery";
settingsContainer.appendChild(autoSkipTimeoutSlider);

autoSkipTimeoutSlider.addEventListener("input", (e) => {
    noClassificationTimeoutMs = Math.max(1000, parseInt(e.target.value, 10) || 8000);
    localStorage.setItem("dingtag_no_classification_timeout_ms", String(noClassificationTimeoutMs));
    updateLabels();
});

const stuckTaskLabel = document.createElement("div");
stuckTaskLabel.style.color = "#ccc";
stuckTaskLabel.style.fontSize = "12px";
stuckTaskLabel.style.marginTop = "8px";
settingsContainer.appendChild(stuckTaskLabel);
const stuckTaskSlider = document.createElement("input");
stuckTaskSlider.type = "range";
stuckTaskSlider.min = "3000";
stuckTaskSlider.max = "30000";
stuckTaskSlider.step = "1000";
stuckTaskSlider.value = String(stuckTaskTimeoutMs);
stuckTaskSlider.style.width = "100%";
stuckTaskSlider.title = "ถ้า task เดิมค้างนานเกินนี้ → บังคับ Shift+↓ ไปงานถัดไป";
settingsContainer.appendChild(stuckTaskSlider);

stuckTaskSlider.addEventListener("input", (e) => {
    stuckTaskTimeoutMs = Math.max(3000, parseInt(e.target.value, 10) || 10000);
    localStorage.setItem("dingtag_stuck_task_timeout_ms", String(stuckTaskTimeoutMs));
    updateLabels();
});

// Toggle: เปิด/ปิด Auto-Reset Task History เมื่อเจอ duplicate-loop
// (ปิดอยู่ → bot จะกด Shift+↑ ขึ้นต่อไปเรื่อยๆ ไม่ล้างประวัติ/ไม่กด Shift+↓ ทะลุ loop)
const autoResetRow = document.createElement("div");
autoResetRow.style.display = "flex";
autoResetRow.style.alignItems = "center";
autoResetRow.style.justifyContent = "space-between";
autoResetRow.style.gap = "8px";
autoResetRow.style.marginTop = "8px";
settingsContainer.appendChild(autoResetRow);

const autoResetLabel = document.createElement("label");
autoResetLabel.innerText = "🔁 Auto-Reset History on Loop";
autoResetLabel.style.fontSize = "12px";
autoResetLabel.style.cursor = "pointer";
autoResetRow.appendChild(autoResetLabel);

const autoResetInput = document.createElement("input");
autoResetInput.type = "checkbox";
autoResetInput.checked = autoResetHistoryEnabled;
autoResetInput.style.cursor = "pointer";
autoResetInput.title =
    `เมื่อเจอ task เดิมเด้งกลับซ้ำ ≥ ${duplicateLoopThreshold} ครั้งใน ${(duplicateLoopWindowMs / 1000).toFixed(0)} วิ ` +
    "→ ล้างประวัติ task ทั้งหมด แล้วกด Shift+↓ ทะลุออกจาก loop\n" +
    "(ปิดอยู่ = ไม่ล้างประวัติ จะกด Shift+↑ ขึ้นต่อไปเรื่อยๆ)";
autoResetRow.appendChild(autoResetInput);

autoResetLabel.addEventListener("click", () => {
    autoResetInput.checked = !autoResetInput.checked;
    autoResetInput.dispatchEvent(new Event("change"));
});

autoResetInput.addEventListener("change", () => {
    autoResetHistoryEnabled = autoResetInput.checked;
    localStorage.setItem("dingtag_auto_reset_history_enabled", autoResetHistoryEnabled ? "1" : "0");
    console.log("[DingTag] Auto-Reset History on Loop:", autoResetHistoryEnabled ? "ON" : "OFF");
});

// Invalid: ไม่สลับเป็น Valid — กด Review radios แล้ว Update (เช็ค Task ID ก่อน Update ใน flow)
const noRecheckInvalidRow = document.createElement("div");
noRecheckInvalidRow.style.display = "flex";
noRecheckInvalidRow.style.alignItems = "center";
noRecheckInvalidRow.style.justifyContent = "space-between";
noRecheckInvalidRow.style.gap = "8px";
noRecheckInvalidRow.style.marginTop = "10px";
settingsContainer.appendChild(noRecheckInvalidRow);

const noRecheckInvalidLabel = document.createElement("label");
noRecheckInvalidLabel.innerText = "🚫 No Recheck Invalid";
noRecheckInvalidLabel.style.fontSize = "12px";
noRecheckInvalidLabel.style.cursor = "pointer";
noRecheckInvalidRow.appendChild(noRecheckInvalidLabel);

const noRecheckInvalidInput = document.createElement("input");
noRecheckInvalidInput.type = "checkbox";
noRecheckInvalidInput.checked = noRecheckInvalidEnabled;
noRecheckInvalidInput.style.cursor = "pointer";
noRecheckInvalidInput.title =
    "เปิด: เมื่อ Classification = Invalid — ไม่สลับเป็น Valid / ไม่ถอดเสียง\n" +
    "→ กด Optimized แล้ว Has Errors แล้วเช็ค Task ID ก่อนกด Update\n" +
    "ปิด: เดิม (สลับเป็น Valid แล้วรัน pipeline ถอดเสียง)";
noRecheckInvalidRow.appendChild(noRecheckInvalidInput);

noRecheckInvalidLabel.addEventListener("click", () => {
    noRecheckInvalidInput.checked = !noRecheckInvalidInput.checked;
    noRecheckInvalidInput.dispatchEvent(new Event("change"));
});

noRecheckInvalidInput.addEventListener("change", () => {
    noRecheckInvalidEnabled = noRecheckInvalidInput.checked;
    localStorage.setItem("dingtag_no_recheck_invalid", noRecheckInvalidEnabled ? "1" : "0");
    console.log("[DingTag] No Recheck Invalid:", noRecheckInvalidEnabled ? "ON" : "OFF");
});

// หลัง Order by: สวิตช์เล็ก — ปิด = ท้ายก่อน (Sort 1×), เปิด = หัวก่อน (Sort 2×)
const orderBySortRow = document.createElement("div");
orderBySortRow.style.display = "flex";
orderBySortRow.style.alignItems = "center";
orderBySortRow.style.justifyContent = "space-between";
orderBySortRow.style.gap = "8px";
orderBySortRow.style.marginTop = "10px";
settingsContainer.appendChild(orderBySortRow);

const orderBySortLabelWrap = document.createElement("div");
orderBySortLabelWrap.style.display = "flex";
orderBySortLabelWrap.style.flexDirection = "column";
orderBySortLabelWrap.style.gap = "2px";
orderBySortLabelWrap.style.flex = "1";
orderBySortLabelWrap.style.minWidth = "0";
orderBySortLabelWrap.style.cursor = "pointer";
const orderBySortMainLbl = document.createElement("span");
orderBySortMainLbl.style.fontSize = "12px";
orderBySortMainLbl.style.color = "#ecf0f1";
orderBySortMainLbl.textContent = "Order by → Sort";
const orderBySortSubLbl = document.createElement("span");
orderBySortSubLbl.style.fontSize = "10px";
orderBySortSubLbl.style.opacity = "0.78";
orderBySortSubLbl.style.lineHeight = "1.25";
function syncOrderBySortSubLabel() {
    orderBySortSubLbl.textContent =
        orderBySortDescendingClicks === 2
            ? "หัวก่อน — กดปุ่มเรียง 2 ครั้ง (desc/asc สลับ)"
            : "ท้ายก่อน — กดปุ่มเรียง 1 ครั้ง";
}
syncOrderBySortSubLabel();
orderBySortLabelWrap.appendChild(orderBySortMainLbl);
orderBySortLabelWrap.appendChild(orderBySortSubLbl);

const orderBySortSwitch = document.createElement("input");
orderBySortSwitch.type = "checkbox";
orderBySortSwitch.checked = orderBySortDescendingClicks === 2;
orderBySortSwitch.style.cursor = "pointer";
orderBySortSwitch.style.flexShrink = "0";
orderBySortSwitch.style.transform = "scale(0.72)";
orderBySortSwitch.style.transformOrigin = "center right";
orderBySortSwitch.title = "ปิด: ท้ายก่อน (1×) — เปิด: หัวก่อน (2×) ปุ่มเดียวสลับ ascending/descending";
orderBySortSwitch.addEventListener("change", () => {
    orderBySortDescendingClicks = orderBySortSwitch.checked ? 2 : 1;
    localStorage.setItem("dingtag_order_by_sort_desc_clicks", String(orderBySortDescendingClicks));
    syncOrderBySortSubLabel();
    console.log("[DingTag] Order-by Sort descending clicks =", orderBySortDescendingClicks);
});
orderBySortLabelWrap.addEventListener("click", (e) => {
    if (e.target === orderBySortSwitch) return;
    orderBySortSwitch.checked = !orderBySortSwitch.checked;
    orderBySortSwitch.dispatchEvent(new Event("change"));
});

orderBySortRow.appendChild(orderBySortLabelWrap);
orderBySortRow.appendChild(orderBySortSwitch);

// ---- ตั้งค่า Auto-Filter (Annotators / Does not contain / <user>) — hotkey Shift+↑ ----
const filterSettingsBlock = document.createElement("div");
settingsContainer.appendChild(filterSettingsBlock);

// Toggle: เปิด/ปิด ฟีเจอร์ทั้งหมด
const filterToggleRow = document.createElement("div");
filterToggleRow.style.display = "flex";
filterToggleRow.style.alignItems = "center";
filterToggleRow.style.justifyContent = "space-between";
filterToggleRow.style.gap = "8px";
filterToggleRow.style.marginTop = "12px";
filterSettingsBlock.appendChild(filterToggleRow);

const filterToggleLabel = document.createElement("label");
filterToggleLabel.innerText = "🚫 Auto-Filter (Shift+↑)";
filterToggleLabel.style.fontSize = "12px";
filterToggleLabel.style.cursor = "pointer";
filterToggleRow.appendChild(filterToggleLabel);

const filterToggleInput = document.createElement("input");
filterToggleInput.type = "checkbox";
filterToggleInput.checked = autoFilterEnabled;
filterToggleInput.style.cursor = "pointer";
filterToggleInput.title = "เปิด/ปิด ฟีเจอร์ตั้ง Filter อัตโนมัติ (hotkey Shift+↑ + ปุ่ม Apply)";
filterToggleRow.appendChild(filterToggleInput);

filterToggleLabel.addEventListener("click", () => {
    filterToggleInput.checked = !filterToggleInput.checked;
    filterToggleInput.dispatchEvent(new Event("change"));
});

filterToggleInput.addEventListener("change", () => {
    autoFilterEnabled = filterToggleInput.checked;
    localStorage.setItem("dingtag_auto_filter_enabled", autoFilterEnabled ? "1" : "0");
    console.log("[DingTag] Auto-Filter:", autoFilterEnabled ? "ON" : "OFF");
    updateApplyFilterBtnState();
});

const filterUserLabel = document.createElement("div");
filterUserLabel.style.fontSize = "12px";
filterUserLabel.style.marginTop = "8px";
filterUserLabel.innerText = "🚫 Filter exclude annotator:";
filterSettingsBlock.appendChild(filterUserLabel);

const filterUserInput = document.createElement("input");
filterUserInput.type = "text";
filterUserInput.value = filterAnnotatorUsername;
filterUserInput.placeholder = "Thai-1-Nuntawut";
filterUserInput.style.width = "100%";
filterUserInput.style.boxSizing = "border-box";
filterUserInput.style.marginTop = "4px";
filterUserInput.style.padding = "5px 7px";
filterUserInput.style.border = "1px solid #555";
filterUserInput.style.borderRadius = "4px";
filterUserInput.style.background = "#1b1f22";
filterUserInput.style.color = "#ecf0f1";
filterUserInput.style.fontSize = "12px";
filterUserInput.title =
    "ชื่อ user ที่จะใส่ในช่อง 'Annotators / Does not contain / <user>' เมื่อกด Shift+↑ หรือกดปุ่ม Apply ด้านล่าง";
filterSettingsBlock.appendChild(filterUserInput);

filterUserInput.addEventListener("change", () => {
    const v = (filterUserInput.value || "").trim();
    filterAnnotatorUsername = v || "Thai-1-Nuntawut";
    filterUserInput.value = filterAnnotatorUsername;
    localStorage.setItem("dingtag_filter_annotator_username", filterAnnotatorUsername);
    console.log("[DingTag] Filter exclude annotator =", filterAnnotatorUsername);
});

const applyFilterBtn = document.createElement("button");
applyFilterBtn.type = "button";
applyFilterBtn.innerText = "🚫 Apply My Filter (Shift+↑)";
applyFilterBtn.style.marginTop = "6px";
applyFilterBtn.style.width = "100%";
applyFilterBtn.style.padding = "6px";
applyFilterBtn.style.border = "1px solid #555";
applyFilterBtn.style.borderRadius = "4px";
applyFilterBtn.style.backgroundColor = "#2c3e50";
applyFilterBtn.style.color = "#ecf0f1";
applyFilterBtn.style.cursor = "pointer";
applyFilterBtn.style.fontSize = "12px";
applyFilterBtn.title =
    "เปิด Filter panel แล้วตั้ง Annotators / Does not contain / <user ในช่องด้านบน>";
applyFilterBtn.addEventListener("click", () => {
    applyMyAnnotatorFilter().catch((e) => {
        console.warn("[DingTag] Apply filter error:", e?.name, e?.message);
    });
});
filterSettingsBlock.appendChild(applyFilterBtn);

// ตรวจว่าปุ่ม Filters มีอยู่บนหน้านี้หรือไม่ (หน้า Tasks list จะมี ส่วนหน้าอื่นไม่มี)
function isFilterButtonPresent() {
    return !!document.querySelector('button[aria-label="Filters"]');
}

// อัปเดตสภาพ apply button + input ให้ตรงกับ toggle + การมีอยู่ของ Filters button
function updateApplyFilterBtnState() {
    const hasFilter = isFilterButtonPresent();
    const enabled = autoFilterEnabled && hasFilter;
    applyFilterBtn.disabled = !enabled;
    applyFilterBtn.style.opacity = enabled ? "1" : "0.45";
    applyFilterBtn.style.cursor = enabled ? "pointer" : "not-allowed";
    filterUserInput.disabled = !autoFilterEnabled;
    filterUserInput.style.opacity = autoFilterEnabled ? "1" : "0.55";
    if (!autoFilterEnabled) {
        applyFilterBtn.title = "ปิดอยู่ — เปิด Auto-Filter toggle ด้านบนก่อน";
    } else if (!hasFilter) {
        applyFilterBtn.title = "ยังไม่เจอปุ่ม Filters บนหน้านี้ — เปิดหน้า Tasks list ก่อน";
    } else {
        applyFilterBtn.title =
            "เปิด Filter panel แล้วเพิ่มแถวใหม่ Annotators / Does not contain / <user>";
    }
}
// initial state + poll ทุก 1.5 วิ (Filters button อาจ render หลัง navigate)
updateApplyFilterBtnState();
setInterval(updateApplyFilterBtnState, 1500);

// ปุ่ม Clear History (ล้างประวัติ task ที่กด Update สำเร็จแล้ว)
const clearHistoryBtn = document.createElement("button");
clearHistoryBtn.innerText = "🧹 Clear Task History";
clearHistoryBtn.style.marginTop = "12px";
clearHistoryBtn.style.width = "100%";
clearHistoryBtn.style.padding = "6px";
clearHistoryBtn.style.border = "1px solid #555";
clearHistoryBtn.style.borderRadius = "4px";
clearHistoryBtn.style.backgroundColor = "#2c3e50";
clearHistoryBtn.style.color = "#ecf0f1";
clearHistoryBtn.style.cursor = "pointer";
clearHistoryBtn.style.fontSize = "12px";
clearHistoryBtn.addEventListener("click", () => {
    const count = processedTaskIds.size;
    processedTaskIds.clear();
    duplicateTaskEncounters.clear();
    lastProcessedTaskId = "";
    stuckTaskId = "";
    stuckTaskDetectedAt = 0;
    console.log(`🧹 ล้างประวัติ task ที่ Update สำเร็จแล้ว (${count} รายการ) — สามารถทำซ้ำได้อีก`);
    setStatus(`ล้างประวัติแล้ว (${count} tasks) — พร้อมทำงานใหม่`);
});
settingsContainer.appendChild(clearHistoryBtn);

autoView.appendChild(settingsContainer);

const manualStatusLabel = document.createElement("div");
manualStatusLabel.style.fontSize = "12px";
manualStatusLabel.style.padding = "8px";
manualStatusLabel.style.borderRadius = "8px";
manualStatusLabel.style.backgroundColor = "#343a40";
manualStatusLabel.style.lineHeight = "1.35";
manualView.appendChild(manualStatusLabel);

const manualTranscribeBtn = document.createElement("button");
manualTranscribeBtn.type = "button";
manualTranscribeBtn.innerText = "🎙️ ถอดเสียง (วางข้อความ)";
manualTranscribeBtn.style.width = "100%";
manualTranscribeBtn.style.marginTop = "10px";
manualTranscribeBtn.style.padding = "10px";
manualTranscribeBtn.style.border = "none";
manualTranscribeBtn.style.borderRadius = "6px";
manualTranscribeBtn.style.backgroundColor = "#0d6efd";
manualTranscribeBtn.style.color = "white";
manualTranscribeBtn.style.cursor = "pointer";
manualTranscribeBtn.style.fontSize = "12px";
manualTranscribeBtn.title = "ถอดเสียงจากไฟล์บนหน้า แล้ววางในช่อง Annotation";
manualView.appendChild(manualTranscribeBtn);

const manualTranscribeHotkeyLabel = document.createElement("div");
manualTranscribeHotkeyLabel.style.fontSize = "11px";
manualTranscribeHotkeyLabel.style.marginTop = "8px";
manualTranscribeHotkeyLabel.style.opacity = "0.9";
manualView.appendChild(manualTranscribeHotkeyLabel);

const manualTranscribeHotkeyRow = document.createElement("div");
manualTranscribeHotkeyRow.style.display = "flex";
manualTranscribeHotkeyRow.style.gap = "6px";
manualTranscribeHotkeyRow.style.marginTop = "4px";

const manualTranscribeHotkeySetBtn = document.createElement("button");
manualTranscribeHotkeySetBtn.type = "button";
manualTranscribeHotkeySetBtn.innerText = "⌨️ ตั้งคีย์ลัดถอด";
manualTranscribeHotkeySetBtn.style.flex = "1";
manualTranscribeHotkeySetBtn.style.padding = "5px";
manualTranscribeHotkeySetBtn.style.border = "1px solid #555";
manualTranscribeHotkeySetBtn.style.borderRadius = "4px";
manualTranscribeHotkeySetBtn.style.backgroundColor = "#2c3e50";
manualTranscribeHotkeySetBtn.style.color = "#ecf0f1";
manualTranscribeHotkeySetBtn.style.cursor = "pointer";
manualTranscribeHotkeySetBtn.style.fontSize = "10px";

const manualTranscribeHotkeyResetBtn = document.createElement("button");
manualTranscribeHotkeyResetBtn.type = "button";
manualTranscribeHotkeyResetBtn.innerText = "F8";
manualTranscribeHotkeyResetBtn.title = "รีเซ็ตคีย์ลัดถอดเสียงเป็น F8";
manualTranscribeHotkeyResetBtn.style.padding = "5px 8px";
manualTranscribeHotkeyResetBtn.style.border = "1px solid #555";
manualTranscribeHotkeyResetBtn.style.borderRadius = "4px";
manualTranscribeHotkeyResetBtn.style.backgroundColor = "#343a40";
manualTranscribeHotkeyResetBtn.style.color = "#ecf0f1";
manualTranscribeHotkeyResetBtn.style.cursor = "pointer";
manualTranscribeHotkeyResetBtn.style.fontSize = "10px";

manualTranscribeHotkeyRow.appendChild(manualTranscribeHotkeySetBtn);
manualTranscribeHotkeyRow.appendChild(manualTranscribeHotkeyResetBtn);
manualView.appendChild(manualTranscribeHotkeyRow);

const manualFormalizeBtn = document.createElement("button");
manualFormalizeBtn.type = "button";
manualFormalizeBtn.innerText = "✍️ จัดคำ (ข้อความในช่อง)";
manualFormalizeBtn.style.width = "100%";
manualFormalizeBtn.style.marginTop = "12px";
manualFormalizeBtn.style.padding = "10px";
manualFormalizeBtn.style.border = "none";
manualFormalizeBtn.style.borderRadius = "6px";
manualFormalizeBtn.style.backgroundColor = "#6f42c1";
manualFormalizeBtn.style.color = "white";
manualFormalizeBtn.style.cursor = "pointer";
manualFormalizeBtn.style.fontSize = "12px";
manualFormalizeBtn.title = "จัดคำข้อความในช่อง Annotation แล้ววางทับ";
manualView.appendChild(manualFormalizeBtn);

const manualFormalModelLabel = document.createElement("div");
manualFormalModelLabel.style.fontSize = "10px";
manualFormalModelLabel.style.marginTop = "8px";
manualFormalModelLabel.style.opacity = "0.88";
manualFormalModelLabel.innerText = "โมเดลจัดคำ (Manual)";
manualView.appendChild(manualFormalModelLabel);

const manualFormalModelSelect = document.createElement("select");
manualFormalModelSelect.id = "dingtag-manual-formal-model";
manualFormalModelSelect.style.width = "100%";
manualFormalModelSelect.style.marginTop = "4px";
manualFormalModelSelect.style.padding = "6px 8px";
manualFormalModelSelect.style.borderRadius = "6px";
manualFormalModelSelect.style.border = "1px solid #555";
manualFormalModelSelect.style.backgroundColor = "#2c3e50";
manualFormalModelSelect.style.color = "#ecf0f1";
manualFormalModelSelect.style.fontSize = "11px";
manualFormalModelSelect.style.cursor = "pointer";
for (const opt of MANUAL_FORMAL_MODEL_OPTIONS) {
    const o = document.createElement("option");
    o.value = opt.id;
    o.textContent = opt.label;
    manualFormalModelSelect.appendChild(o);
}
manualFormalModelSelect.value = getManualFormalModelId();
manualFormalModelSelect.addEventListener("change", () => {
    localStorage.setItem(MANUAL_FORMAL_MODEL_STORAGE_KEY, manualFormalModelSelect.value);
});
manualView.appendChild(manualFormalModelSelect);

const manualFormalizeHotkeyLabel = document.createElement("div");
manualFormalizeHotkeyLabel.style.fontSize = "11px";
manualFormalizeHotkeyLabel.style.marginTop = "8px";
manualFormalizeHotkeyLabel.style.opacity = "0.9";
manualView.appendChild(manualFormalizeHotkeyLabel);

const manualFormalizeHotkeyRow = document.createElement("div");
manualFormalizeHotkeyRow.style.display = "flex";
manualFormalizeHotkeyRow.style.gap = "6px";
manualFormalizeHotkeyRow.style.marginTop = "4px";

const manualFormalizeHotkeySetBtn = document.createElement("button");
manualFormalizeHotkeySetBtn.type = "button";
manualFormalizeHotkeySetBtn.innerText = "⌨️ ตั้งคีย์ลัดจัดคำ";
manualFormalizeHotkeySetBtn.style.flex = "1";
manualFormalizeHotkeySetBtn.style.padding = "5px";
manualFormalizeHotkeySetBtn.style.border = "1px solid #555";
manualFormalizeHotkeySetBtn.style.borderRadius = "4px";
manualFormalizeHotkeySetBtn.style.backgroundColor = "#2c3e50";
manualFormalizeHotkeySetBtn.style.color = "#ecf0f1";
manualFormalizeHotkeySetBtn.style.cursor = "pointer";
manualFormalizeHotkeySetBtn.style.fontSize = "10px";

const manualFormalizeHotkeyResetBtn = document.createElement("button");
manualFormalizeHotkeyResetBtn.type = "button";
manualFormalizeHotkeyResetBtn.innerText = "F9";
manualFormalizeHotkeyResetBtn.title = "รีเซ็ตคีย์ลัดจัดคำเป็น F9";
manualFormalizeHotkeyResetBtn.style.padding = "5px 8px";
manualFormalizeHotkeyResetBtn.style.border = "1px solid #555";
manualFormalizeHotkeyResetBtn.style.borderRadius = "4px";
manualFormalizeHotkeyResetBtn.style.backgroundColor = "#343a40";
manualFormalizeHotkeyResetBtn.style.color = "#ecf0f1";
manualFormalizeHotkeyResetBtn.style.cursor = "pointer";
manualFormalizeHotkeyResetBtn.style.fontSize = "10px";

manualFormalizeHotkeyRow.appendChild(manualFormalizeHotkeySetBtn);
manualFormalizeHotkeyRow.appendChild(manualFormalizeHotkeyResetBtn);
manualView.appendChild(manualFormalizeHotkeyRow);

const manualHint = document.createElement("div");
manualHint.style.fontSize = "10px";
manualHint.style.marginTop = "10px";
manualHint.style.opacity = "0.72";
manualHint.style.lineHeight = "1.35";
manualHint.innerText =
    "Manual: ถอดเสียง → จัดคำ → ตรวจเอง → กด Update | ตั้งคีย์ลัดได้ทั้งคีย์บอร์ดและปุ่มเมาส์ (เช่น Forward)";
manualView.appendChild(manualHint);

panel.appendChild(autoView);
panel.appendChild(manualView);
document.body.appendChild(panel);

function setManualStatus(text) {
    manualStatusLabel.innerText = `สถานะ: ${text}`;
}

function updateManualHotkeyLabels() {
    manualTranscribeHotkeyLabel.innerText = `คีย์ลัดถอดเสียง: ${formatManualHotkeyLabel(manualTranscribeHotkey)}`;
    manualFormalizeHotkeyLabel.innerText = `คีย์ลัดจัดคำ: ${formatManualHotkeyLabel(manualFormalizeHotkey)}`;
    const cap = hotkeyCaptureTarget;
    manualTranscribeHotkeySetBtn.innerText =
        cap === "transcribe" ? "กดคีย์/ปุ่มเมาส์…" : "⌨️ ตั้งคีย์ลัดถอด";
    manualFormalizeHotkeySetBtn.innerText =
        cap === "formalize" ? "กดคีย์/ปุ่มเมาส์…" : "⌨️ ตั้งคีย์ลัดจัดคำ";
}

function syncModeSwitchButtons() {
    const inactive = "#343a40";
    const isAuto = extensionMode === "auto";
    const isQc = extensionMode === "qc";
    const isManual = extensionMode === "manual";
    modeAutoBtn.style.backgroundColor = isAuto ? "#198754" : inactive;
    modeQcBtn.style.backgroundColor = isQc ? "#6f42c1" : inactive;
    modeManualBtn.style.backgroundColor = isManual ? "#0d6efd" : inactive;
    modeAutoBtn.style.color = "#fff";
    modeQcBtn.style.color = "#fff";
    modeManualBtn.style.color = "#fff";
}

function setExtensionMode(mode) {
    const next = normalizeExtensionMode(mode);
    if (extensionMode === next) return;
    extensionMode = next;
    localStorage.setItem("dingtag_extension_mode", extensionMode);
    hotkeyCaptureTarget = null;
    if (extensionMode === "manual" && isAutoPilotOn) {
        isAutoPilotOn = false;
        toggleBtn.innerText = "OFF - คลิกเพื่อเปิด";
        toggleBtn.style.backgroundColor = "#dc3545";
        clearAllTasks();
        setStatus("OFF");
    }
    applyExtensionModeUI();
    console.log("[DingTag] Extension mode:", extensionMode);
}

function applyExtensionModeUI() {
    const isManual = extensionMode === "manual";
    const isQc = extensionMode === "qc";
    autoView.style.display = isManual ? "none" : "block";
    manualView.style.display = isManual ? "block" : "none";
    settingsBtn.style.display = isManual ? "none" : "flex";
    if (isManual) {
        title.innerText = "✋ DingTalk Manual";
    } else if (isQc) {
        title.innerText = "🔍 DingTalk QC (Local API)";
    } else {
        title.innerText = "🤖 DingTalk V21 (Local API)";
    }
    panel.style.width = isManual ? "280px" : "240px";
    if (filterSettingsBlock) {
        filterSettingsBlock.style.display = isQc ? "none" : "block";
    }
    syncModeSwitchButtons();
    updateManualHotkeyLabels();
    if (isManual) {
        settingsContainer.style.display = "none";
        if (manualFormalModelSelect) {
            manualFormalModelSelect.value = getManualFormalModelId();
        }
        setManualStatus(
            `พร้อม — ถอด: ${formatManualHotkeyLabel(manualTranscribeHotkey)} | จัดคำ: ${formatManualHotkeyLabel(manualFormalizeHotkey)}`
        );
    }
}

modeAutoBtn.addEventListener("click", () => setExtensionMode("auto"));
modeQcBtn.addEventListener("click", () => setExtensionMode("qc"));
modeManualBtn.addEventListener("click", () => setExtensionMode("manual"));

manualTranscribeBtn.addEventListener("click", () => {
    runManualTranscribe().catch((e) => console.warn("[DingTag Manual]", e?.message));
});

manualTranscribeHotkeySetBtn.addEventListener("click", () => {
    if (hotkeyCaptureTarget === "transcribe") {
        cancelHotkeyCapture();
        setManualStatus("ยกเลิกการตั้งค่าคีย์ลัดถอดเสียง");
    } else {
        startHotkeyCapture("transcribe");
    }
});

manualTranscribeHotkeyResetBtn.addEventListener("click", () => {
    hotkeyCaptureTarget = null;
    persistManualHotkey("transcribe", { ...DEFAULT_MANUAL_TRANSCRIBE_HOTKEY });
    updateManualHotkeyLabels();
    setManualStatus(`รีเซ็ตคีย์ลัดถอด: ${formatManualHotkeyLabel(manualTranscribeHotkey)}`);
});

manualFormalizeBtn.addEventListener("click", () => {
    runManualFormalize().catch((e) => console.warn("[DingTag Manual] formalize:", e?.message));
});

manualFormalizeHotkeySetBtn.addEventListener("click", () => {
    if (hotkeyCaptureTarget === "formalize") {
        cancelHotkeyCapture();
        setManualStatus("ยกเลิกการตั้งค่าคีย์ลัดจัดคำ");
    } else {
        startHotkeyCapture("formalize");
    }
});

manualFormalizeHotkeyResetBtn.addEventListener("click", () => {
    hotkeyCaptureTarget = null;
    persistManualHotkey("formalize", { ...DEFAULT_MANUAL_FORMALIZE_HOTKEY });
    updateManualHotkeyLabels();
    setManualStatus(`รีเซ็ตคีย์ลัดจัดคำ: ${formatManualHotkeyLabel(manualFormalizeHotkey)}`);
});

applyExtensionModeUI();

const PANEL_POS_STORAGE_KEY = "dingtag_panel_position";

function clampPanelToViewport(left, top) {
    const w = panel.offsetWidth || 270;
    const h = panel.offsetHeight || 120;
    const maxL = Math.max(0, window.innerWidth - w);
    const maxT = Math.max(0, window.innerHeight - h);
    return {
        left: Math.min(Math.max(0, left), maxL),
        top: Math.min(Math.max(0, top), maxT),
    };
}

function applyStoredPanelPosition() {
    try {
        const raw = localStorage.getItem(PANEL_POS_STORAGE_KEY);
        if (!raw) return;
        const pos = JSON.parse(raw);
        const left = Number(pos?.left);
        const top = Number(pos?.top);
        if (!Number.isFinite(left) || !Number.isFinite(top)) return;
        panel.style.right = "";
        panel.style.bottom = "";
        const c = clampPanelToViewport(left, top);
        panel.style.left = `${c.left}px`;
        panel.style.top = `${c.top}px`;
    } catch {
        /* ignore */
    }
}

function persistPanelPosition() {
    try {
        const r = panel.getBoundingClientRect();
        localStorage.setItem(PANEL_POS_STORAGE_KEY, JSON.stringify({ left: r.left, top: r.top }));
    } catch {
        /* ignore */
    }
}

applyStoredPanelPosition();

let panelDragState = null;

function onPanelPointerMove(e) {
    if (!panelDragState) return;
    const dx = e.clientX - panelDragState.originClientX;
    const dy = e.clientY - panelDragState.originClientY;
    const c = clampPanelToViewport(panelDragState.originLeft + dx, panelDragState.originTop + dy);
    panel.style.left = `${c.left}px`;
    panel.style.top = `${c.top}px`;
}

function endPanelDrag() {
    if (!panelDragState) return;
    panelDragState = null;
    headerRow.style.cursor = "grab";
    document.removeEventListener("mousemove", onPanelPointerMove, true);
    document.removeEventListener("mouseup", endPanelDrag, true);
    persistPanelPosition();
}

headerRow.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest("button")) return;
    const r = panel.getBoundingClientRect();
    panel.style.right = "";
    panel.style.bottom = "";
    panel.style.left = `${r.left}px`;
    panel.style.top = `${r.top}px`;
    panelDragState = {
        originClientX: e.clientX,
        originClientY: e.clientY,
        originLeft: r.left,
        originTop: r.top,
    };
    headerRow.style.cursor = "grabbing";
    document.addEventListener("mousemove", onPanelPointerMove, true);
    document.addEventListener("mouseup", endPanelDrag, true);
    e.preventDefault();
});

window.addEventListener("resize", () => {
    if (!panel.style.left || panel.style.left === "" || !panel.style.top || panel.style.top === "") return;
    const r = panel.getBoundingClientRect();
    const c = clampPanelToViewport(r.left, r.top);
    if (Math.abs(c.left - r.left) > 0.5 || Math.abs(c.top - r.top) > 0.5) {
        panel.style.left = `${c.left}px`;
        panel.style.top = `${c.top}px`;
        persistPanelPosition();
    }
});

function updateLabels() {
    minAcceptLabel.innerText =
        minElapsedBeforeAcceptMs <= 0
            ? `🛡️ ก่อนกด Accept อย่างน้อย: ปิด (ไม่บังคับ)`
            : `🛡️ ก่อนกด Accept อย่างน้อย: ${(minElapsedBeforeAcceptMs / 1000).toFixed(0)} วิ (งานเร็วเกินจะรอให้ครบ)`;
    autoSkipTimeoutLabel.innerText = `🎚️ Waveform recovery timeout: ${(noClassificationTimeoutMs / 1000).toFixed(1)} วิ`;
    stuckTaskLabel.innerText = `🔄 Stuck Task timeout: ${(stuckTaskTimeoutMs / 1000).toFixed(0)} วิ`;
}
updateLabels();

function setStatus(text) {
    statusLabel.innerText = `สถานะ: ${text}`;
}

toggleBtn.addEventListener("click", () => {
    isAutoPilotOn = !isAutoPilotOn;
    if (isAutoPilotOn) {
        toggleBtn.innerText = "ON - ระบบกำลังทำงาน";
        toggleBtn.style.backgroundColor = "#198754";
        setStatus("กำลังค้นหา target...");
    } else {
        toggleBtn.innerText = "OFF - คลิกเพื่อเปิด";
        toggleBtn.style.backgroundColor = "#dc3545";
        clearAllTasks();
        setStatus("OFF");
    }
});

settingsBtn.addEventListener("click", () => {
    const isOpen = settingsContainer.style.display !== "none";
    settingsContainer.style.display = isOpen ? "none" : "block";
});
minAcceptSlider.addEventListener("input", (e) => {
    minElapsedBeforeAcceptMs = Math.max(0, parseInt(e.target.value, 10) || 0);
    localStorage.setItem("dingtag_min_elapsed_before_accept_ms", String(minElapsedBeforeAcceptMs));
    updateLabels();
});

function forceClickByText(keywords) {
    let allElements = document.querySelectorAll("*");
    for (let el of allElements) {
        if (el.children.length === 0 && el.textContent) {
            let text = el.textContent.trim();
            if (keywords.includes(text)) {
                el.click();
                let parentBtn = el.closest('button, [role="button"]');
                if (parentBtn) parentBtn.click();
                return true;
            }
        }
    }
    return false;
}

function findClickableByExactText(keywords) {
    const clickables = document.querySelectorAll('button, [role="button"], a, div');
    for (const el of clickables) {
        const t = (el.innerText || el.textContent || "").trim();
        if (!t) continue;
        if (keywords.includes(t)) return el;
    }
    return null;
}

function isKeywordPresentOnPage(keywords) {
    const els = document.querySelectorAll("*");
    for (const el of els) {
        const t = (el.textContent || "").trim();
        if (t && keywords.includes(t)) return true;
    }
    return false;
}

function findClickableByContainsText(needles) {
    const lowerNeedles = needles.map((s) => String(s).toLowerCase());
    const norm = (s) =>
        String(s || "")
            .replace(/\s+/g, " ")
            .replace(/\[\s*\d+\s*\]/g, "") // remove hint like [7]
            .trim()
            .toLowerCase();

    // Search broadly (menu items are often nested spans with <sup>[n]</sup>)
    const all = document.querySelectorAll("*");
    for (const el of all) {
        const raw = (el.innerText || el.textContent || "").trim();
        if (!raw) continue;
        const tl = norm(raw);
        if (!tl) continue;
        if (!lowerNeedles.some((n) => tl.includes(n))) continue;

        // Prefer clicking a meaningful ancestor
        const clickable =
            el.closest?.('button, [role="button"], [role="menuitem"], li, a, [tabindex]') || el;
        return clickable;
    }
    return null;
}

async function clickByContainsTextAndVerify(needles, { tries = 6, intervalMs = 350 } = {}) {
    for (let i = 1; i <= tries; i++) {
        if (!isAutoPilotOn) return { ok: false, reason: "autopilot_off" };
        const el = findClickableByContainsText(needles);
        if (!el) {
            await delay(intervalMs);
            continue;
        }
        try {
            el.scrollIntoView?.({ block: "center", inline: "center" });
        } catch {}
        try {
            console.log(`[DingTag] click contains attempt ${i}/${tries}:`, needles.join("/"));
            el.click();
            const parentBtn = el.closest?.('button, [role="button"]');
            if (parentBtn && parentBtn !== el) parentBtn.click();
            return { ok: true, reason: "clicked" };
        } catch (e) {
            console.warn("[DingTag] click contains error:", e?.name, e?.message);
        }
        await delay(intervalMs);
    }
    return { ok: false, reason: "not_found" };
}

function findAntCheckboxByName(checkboxName) {
    if (!checkboxName || typeof checkboxName !== "string") return null;
    if (/["\\]/.test(checkboxName)) return null;
    return document.querySelector(
        'input.ant-checkbox-input[type="checkbox"][name="' + checkboxName + '"]'
    );
}

/** ชื่อ checkbox ใน UI Invalid Reason (Required) — ใช้ fallback เมื่อหา section ไม่เจอ */
const INVALID_REASON_CHECKBOX_NAMES = [
    "Excessive Noise",
    "No Voice Detected",
    "Speaker Unintelligible",
    "Sentence Cut-off",
    "Data Missing",
    "Non-Target Language",
    "Noise or Silence at the Beginning or End Exceeds 1 Second",
];

function findInvalidReasonSectionRoot() {
    const headingCandidates = document.querySelectorAll(
        "h3, h4, .typography-title-large--fyTQU, [class*='typography-title']"
    );
    for (const h of headingCandidates) {
        const t = (h.textContent || "").replace(/\s+/g, " ").trim();
        if (!/invalid\s*reason/i.test(t)) continue;
        let node = h.parentElement;
        for (let depth = 0; depth < 6 && node; depth++) {
            if (
                node.querySelector(
                    'input.ant-checkbox-input[type="checkbox"][name]'
                )
            ) {
                return node;
            }
            node = node.parentElement;
        }
        return h.parentElement;
    }
    return null;
}

function getCheckedInvalidReasonCheckboxes() {
    const root = findInvalidReasonSectionRoot();
    if (root) {
        const inSection = [
            ...root.querySelectorAll(
                'input.ant-checkbox-input[type="checkbox"]:checked'
            ),
        ];
        if (inSection.length) return inSection;
    }
    const fallback = [];
    for (const name of INVALID_REASON_CHECKBOX_NAMES) {
        const cb = findAntCheckboxByName(name);
        if (cb && cb.checked) fallback.push(cb);
    }
    return fallback;
}

function getAntCheckboxClickTarget(input) {
    if (!input) return null;
    return (
        input.closest("label") ||
        input.closest(".ant-checkbox-wrapper") ||
        input.closest(".ant-checkbox") ||
        input
    );
}

async function uncheckAntCheckboxByNameAndVerify(
    checkboxName,
    { tries = 8, intervalMs = 300, logLabel = "checkbox", runToken } = {}
) {
    for (let i = 1; i <= tries; i++) {
        if (runToken != null && !isRunActive(runToken)) {
            return { ok: false, reason: "stale" };
        }
        if (!isAutoPilotOn) return { ok: false, reason: "autopilot_off" };
        const cb = findAntCheckboxByName(checkboxName);
        if (!cb) {
            await delay(intervalMs);
            continue;
        }
        if (!cb.checked) return { ok: true, reason: "already_unchecked" };
        const clickTarget = getAntCheckboxClickTarget(cb);
        try {
            clickTarget.scrollIntoView?.({ block: "center", inline: "center" });
        } catch {}
        try {
            console.log(`[DingTag] uncheck ${logLabel} ${i}/${tries}`);
            clickTarget.click();
        } catch (e) {
            console.warn("[DingTag] uncheck checkbox error:", e?.name, e?.message);
            try {
                cb.click();
            } catch {}
        }
        await delay(120);
        const cb2 = findAntCheckboxByName(checkboxName);
        if (cb2 && !cb2.checked) return { ok: true, reason: "unchecked" };
        await delay(intervalMs);
    }
    return { ok: false, reason: "still_checked" };
}

/**
 * Re-check path: ยกเลิกติ๊ก Invalid Reason ที่ค้างจากรอบ Invalid ก่อนสลับเป็น Valid
 */
async function clearCheckedInvalidReasons({ runToken } = {}) {
    const checked = getCheckedInvalidReasonCheckboxes();
    if (!checked.length) {
        console.log("[DingTag] Invalid Reason: ไม่มี checkbox ที่ติ๊กอยู่ — ข้ามเคลียร์");
        return { ok: true, count: 0, names: [] };
    }

    const names = [
        ...new Set(
            checked.map((cb) => (cb.getAttribute("name") || "").trim()).filter(Boolean)
        ),
    ];
    console.log(
        `[DingTag] Invalid Reason: เคลียร์ ${names.length} รายการก่อน Re-check → Valid:`,
        names.join(", ")
    );
    setStatus(`เคลียร์ Invalid Reason (${names.length})…`);

    let cleared = 0;
    const failed = [];
    for (const name of names) {
        if (runToken != null && !isRunActive(runToken)) {
            return { ok: false, reason: "stale", count: cleared, names, failed };
        }
        const res = await uncheckAntCheckboxByNameAndVerify(name, {
            logLabel: name,
            runToken,
        });
        if (res.reason === "stale") {
            return { ok: false, reason: "stale", count: cleared, names, failed };
        }
        if (res.ok) {
            cleared++;
        } else {
            failed.push(name);
            console.warn(`⚠️ Invalid Reason: เคลียร์ "${name}" ไม่สำเร็จ (${res.reason})`);
        }
        await delay(150);
    }

    const remaining = getCheckedInvalidReasonCheckboxes().length;
    if (remaining > 0) {
        console.warn(
            `[DingTag] Invalid Reason: ยังติ๊กค้าง ${remaining} รายการหลังเคลียร์`
        );
    } else if (cleared > 0) {
        console.log(`✅ Invalid Reason: เคลียร์ครบ ${cleared} รายการ`);
    }

    return {
        ok: failed.length === 0,
        count: cleared,
        names,
        failed,
        remaining,
    };
}

/**
 * Physical click (Python pyautogui) ที่ checkbox + verify ว่า state เปลี่ยนแล้ว
 * - คลิกที่ <label> หรือ .ant-checkbox parent (ไม่ใช่ input ที่ซ่อนอยู่) เพื่อให้พิกัดมองเห็นจริง
 * - ถ้า fail → ผู้เรียกควร fallback ไป clickAntCheckboxByNameAndVerify (JS click)
 */
async function physicalTickAntCheckboxByName(
    checkboxName,
    { tries = 3, intervalMs = 500, logLabel = "checkbox", moveDurationMs = 600 } = {}
) {
    for (let i = 1; i <= tries; i++) {
        if (!isAutoPilotOn) return { ok: false, reason: "autopilot_off" };
        const input = findAntCheckboxByName(checkboxName);
        if (!input) {
            console.warn(`⚠️ Physical checkbox ${logLabel}: ไม่พบ input (${i}/${tries})`);
            await delay(intervalMs);
            continue;
        }
        if (input.checked) return { ok: true, reason: "already_checked" };

        const clickTarget =
            input.closest("label") ||
            input.closest(".ant-checkbox-wrapper") ||
            input.closest(".ant-checkbox") ||
            input;
        try {
            clickTarget.scrollIntoView?.({ block: "center", inline: "center" });
        } catch {}
        await delay(120);

        const geom = getElementScreenGeometry(clickTarget);
        if (!geom) {
            console.warn(`⚠️ Physical checkbox ${logLabel}: หา geometry ไม่ได้ (${i}/${tries})`);
            await delay(intervalMs);
            continue;
        }
        console.log(
            `🖱️ Physical click checkbox ${logLabel} (${i}/${tries}) → ส่งพิกัดให้ Python (เลื่อน ${moveDurationMs}ms)`
        );
        const pcRes = await postPhysicalClick(geom, {
            description: `Checkbox ${logLabel} (${i}/${tries})`,
            button: "left",
            moveDurationMs,
            restorePosition: true,
        });
        if (!pcRes.ok) {
            console.warn(
                `⚠️ Physical click checkbox ${logLabel}: ${pcRes.errorLabel} — ${pcRes.detail}`
            );
            await delay(intervalMs);
            continue;
        }
        console.log(
            `✅ Physical click checkbox ${logLabel} สำเร็จ @ ${pcRes.data?.clickedAt?.join(",")}`
        );
        await delay(300);

        // verify state ใหม่
        const cb2 = findAntCheckboxByName(checkboxName);
        if (cb2 && cb2.checked) return { ok: true, reason: "checked_physical" };
        console.warn(
            `⚠️ Physical click checkbox ${logLabel}: คลิกแล้ว แต่ยังไม่ติ๊ก (${i}/${tries})`
        );
        await delay(intervalMs);
    }
    return { ok: false, reason: "not_checked" };
}

async function clickAntCheckboxByNameAndVerify(checkboxName, { tries = 12, intervalMs = 350, logLabel = "checkbox" } = {}) {
    for (let i = 1; i <= tries; i++) {
        if (!isAutoPilotOn) return { ok: false, reason: "autopilot_off" };
        const cb = findAntCheckboxByName(checkboxName);
        if (!cb) {
            await delay(intervalMs);
            continue;
        }
        if (cb.checked) return { ok: true, reason: "already_checked" };
        try {
            cb.scrollIntoView?.({ block: "center", inline: "center" });
        } catch {}
        try {
            console.log(`[DingTag] click ${logLabel} checkbox ${i}/${tries}`);
            cb.click();
        } catch (e) {
            console.warn("[DingTag] click checkbox error:", e?.name, e?.message);
        }
        await delay(120);
        if (cb.checked) return { ok: true, reason: "checked" };
        await delay(intervalMs);
    }
    return { ok: false, reason: "not_checked" };
}

/**
 * ถ้ายังโฟกัสที่ textarea/input อยู่ Label Studio จะ disable ปุ่ม Update
 * เพราะถือว่ายังพิมพ์อยู่ ดังนั้นต้อง blur ออกก่อน
 */
function blurActiveTextInput() {
    try {
        const active = document.activeElement;
        if (!active || typeof active.blur !== "function") return false;
        const tag = active.tagName;
        const isEditable = active.isContentEditable;
        if (tag === "TEXTAREA" || tag === "INPUT" || isEditable) {
            active.blur();
            return true;
        }
    } catch (e) {
        console.warn("[DingTag] blurActiveTextInput error:", e?.name, e?.message);
    }
    return false;
}

/**
 * ส่ง Shift+ArrowDown ไปยัง document.body เพื่อเลื่อนไป task ถัดไป
 * (shortcut ของ Label Studio)
 */
function dispatchShiftArrowDown() {
    const target = document.body || document.documentElement;
    if (!target) return false;
    const opts = {
        key: "ArrowDown",
        code: "ArrowDown",
        keyCode: 40,
        which: 40,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
    };
    try {
        target.dispatchEvent(new KeyboardEvent("keydown", opts));
        target.dispatchEvent(new KeyboardEvent("keyup", opts));
        return true;
    } catch (e) {
        console.warn("[DingTag] dispatchShiftArrowDown error:", e?.name, e?.message);
        return false;
    }
}

/**
 * ส่ง Shift+ArrowUp ไปยัง document.body เพื่อเลื่อนกลับ task ก่อนหน้า
 * (shortcut ของ Label Studio — ใช้ตอนเจอ task ซ้ำที่เคยทำแล้ว เพื่อกลับขึ้นไปหา task ใหม่)
 */
function dispatchShiftArrowUp() {
    const target = document.body || document.documentElement;
    if (!target) return false;
    const opts = {
        key: "ArrowUp",
        code: "ArrowUp",
        keyCode: 38,
        which: 38,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
    };
    try {
        target.dispatchEvent(new KeyboardEvent("keydown", opts));
        target.dispatchEvent(new KeyboardEvent("keyup", opts));
        return true;
    } catch (e) {
        console.warn("[DingTag] dispatchShiftArrowUp error:", e?.name, e?.message);
        return false;
    }
}

/**
 * Scroll sidebar (virtualized task list) ให้ row ที่ selected อยู่ในมุมมอง
 *
 * โครงสร้าง DOM ของ DingTag sidebar:
 *   div[overflow:auto; will-change:transform]        ← scroll container (viewport)
 *     div[height: Npx]                              ← inner (total height for virtual scroll)
 *       .lsf-table-head                             ← header
 *       .lsf-table__row-wrapper                     ← แต่ละ row (position:absolute, top:Xpx)
 *       .lsf-table__row-wrapper_selected            ← row ที่ active
 */
function scrollSidebarToActiveTask() {
    try {
        // หา selected row
        const selectedRow = document.querySelector(".lsf-table__row-wrapper_selected");
        if (!selectedRow) return false;

        // หา scroll container — parent ที่มี overflow:auto และ will-change:transform
        let scrollContainer = selectedRow.parentElement?.parentElement;
        if (!scrollContainer) {
            // fallback: ไล่ขึ้นหา element ที่ scrollable
            let el = selectedRow.parentElement;
            while (el && el !== document.body) {
                const style = getComputedStyle(el);
                if (
                    (style.overflow === "auto" || style.overflow === "scroll" ||
                     style.overflowY === "auto" || style.overflowY === "scroll") &&
                    el.scrollHeight > el.clientHeight
                ) {
                    scrollContainer = el;
                    break;
                }
                el = el.parentElement;
            }
        }
        if (!scrollContainer) return false;

        // คำนวณ position ของ selected row relative to scroll container (dynamic ทุกค่า)
        const rowTop = parseInt(selectedRow.style.top, 10) || 0;
        const rowHeight = selectedRow.offsetHeight || 70;
        const viewportHeight = scrollContainer.clientHeight;
        const currentScroll = scrollContainer.scrollTop;
        const headerEl = scrollContainer.querySelector(".lsf-table-head") ||
                         scrollContainer.children?.[0]?.querySelector(".lsf-table-head");
        const headerHeight = headerEl?.offsetHeight || 42;
        const bufferRows = 3;
        const bufferPx = bufferRows * rowHeight;

        // ตรวจว่า row อยู่ใน visible area (เผื่อ buffer 3 แถว) หรือไม่
        const rowVisibleTop = rowTop - currentScroll;
        const rowVisibleBottom = rowVisibleTop + rowHeight;

        if (rowVisibleTop < headerHeight + bufferPx) {
            // row อยู่เหนือ viewport (หรือใกล้ขอบบนเกิน) → scroll ขึ้น เผื่อ 3 แถวด้านบน
            scrollContainer.scrollTop = rowTop - headerHeight - bufferPx;
            console.log(`📜 sidebar scroll ↑ (เผื่อ ${bufferRows} แถวด้านบน)`);
        } else if (rowVisibleBottom > viewportHeight - bufferPx) {
            // row ใกล้ขอบล่างเกิน → scroll ลง เผื่อ 3 แถวด้านล่าง
            scrollContainer.scrollTop = rowTop - viewportHeight + rowHeight + bufferPx + 10;
            console.log(`📜 sidebar scroll ↓ (เผื่อ ${bufferRows} แถวด้านล่าง)`);
        } else {
            return true; // อยู่ใน viewport พร้อม buffer เพียงพอ
        }
        return true;
    } catch (e) {
        console.warn("[DingTag] scrollSidebarToActiveTask error:", e?.message);
    }
    return false;
}

/**
 * ตรวจจับว่า task ปัจจุบันอยู่ row บนสุดของ sidebar หรือไม่
 */
function isTaskAtTopOfList() {
    const selectedRow = document.querySelector(".lsf-table__row-wrapper_selected");
    if (!selectedRow) return false;
    const rowTop = parseInt(selectedRow.style.top, 10);
    // row แรกจะมี top ≈ 43 (header 42 + 1) หรือน้อยกว่า 113 (row ที่ 2)
    return rowTop <= 50;
}

/**
 * เลื่อนไป task ถัดไปด้วย Shift+ArrowDown
 * 1) blur textarea/input ที่ค้างอยู่ (ถ้ามี)
 * 2) focus document.body เพื่อให้ shortcut handler รับ event ได้
 * 3) dispatch Shift+ArrowDown
 * 4) scroll sidebar ให้ task ใหม่อยู่ในมุมมอง
 * 5) ถ้า task เด้งกลับบนสุด → Shift+ArrowDown อีก 1 ครั้ง
 */
async function goToNextTask({ runToken } = {}) {
    if (runToken != null && !isRunActive(runToken)) return false;
    if (!shouldUseShiftNavigation()) {
        console.log("[DingTag QC] ข้าม Shift+↓ — รอ queue ส่ง task ใหม่");
        return false;
    }
    if (blurActiveTextInput()) {
        console.log("👀 blur textarea/input ก่อนส่ง Shift+ArrowDown");
    }
    try {
        if (document.body && typeof document.body.focus === "function") {
            document.body.focus();
        }
    } catch {}

    const taskIdBefore = getCurrentTaskId();

    if (dispatchShiftArrowDown()) {
        console.log("⏭️ ส่ง Shift+ArrowDown เพื่อไป task ถัดไปแล้ว");
        lastNavigatedTaskId = taskIdBefore;

        setTimeout(() => {
            scrollSidebarToActiveTask();

            // Bounce detection: ถ้า task เด้งกลับบนสุดหลัง Shift+↓
            if (isTaskAtTopOfList() && !bounceSkipInProgress) {
                const taskIdAfter = getCurrentTaskId();
                if (taskIdAfter && taskIdAfter !== taskIdBefore) {
                    console.log(`⚡ ตรวจพบ task เด้งกลับบนสุด (${taskIdBefore} → ${taskIdAfter}) → Shift+↓ อีก 1 ครั้ง`);
                    bounceSkipInProgress = true;
                    setTimeout(() => {
                        dispatchShiftArrowDown();
                        setTimeout(() => {
                            scrollSidebarToActiveTask();
                            bounceSkipInProgress = false;
                            console.log(`📜 bounce skip เสร็จ → task: ${getCurrentTaskId()}`);
                        }, 500);
                    }, 300);
                }
            }
        }, 500);
        return true;
    }
    return false;
}

/**
 * เลื่อนกลับไป task ก่อนหน้าด้วย Shift+ArrowUp
 * 1) blur textarea/input ที่ค้างอยู่ (ถ้ามี)
 * 2) focus document.body เพื่อให้ shortcut handler รับ event ได้
 * 3) dispatch Shift+ArrowUp
 * 4) scroll sidebar ให้ task ใหม่อยู่ในมุมมอง
 *
 * ใช้ตอนเจอ task ที่เคยทำแล้ว (เด้งกลับ) — กลับขึ้นไปหา task ใหม่แทนที่จะลงไปต่อ
 */
async function goToPreviousTask({ runToken } = {}) {
    if (runToken != null && !isRunActive(runToken)) return false;
    if (!shouldUseShiftNavigation()) {
        console.log("[DingTag QC] ข้าม Shift+↑ — รอ queue ส่ง task ใหม่");
        return false;
    }
    if (blurActiveTextInput()) {
        console.log("👀 blur textarea/input ก่อนส่ง Shift+ArrowUp");
    }
    try {
        if (document.body && typeof document.body.focus === "function") {
            document.body.focus();
        }
    } catch {}

    const taskIdBefore = getCurrentTaskId();

    if (dispatchShiftArrowUp()) {
        console.log("⏮️ ส่ง Shift+ArrowUp เพื่อกลับ task ก่อนหน้าแล้ว");
        lastNavigatedTaskId = taskIdBefore;
        setTimeout(() => {
            scrollSidebarToActiveTask();
        }, 500);
        return true;
    }
    return false;
}

/**
 * Primary target: บรรทัด "Classification: Valid" — .lsf-annotation-items__result-item ที่ label คือ "Classification:"
 */
function findClassificationResultRow() {
    const items = document.querySelectorAll(".lsf-annotation-items__result-item");
    for (const item of items) {
        const label = item.querySelector(".lsf-annotation-items__result-label");
        if (!label || !label.textContent) continue;
        if (label.textContent.includes("Classification")) return item;
    }
    return null;
}

/**
 * Fallback target: .lsf-annotation-items__item — การ์ดทั้งใบ
 * (มี class _interactive / _selected ตาม Label Studio)
 */
function findAnnotationCard() {
    return (
        document.querySelector(
            ".lsf-annotation-items__item.lsf-annotation-items__item_interactive"
        ) ||
        document.querySelector(
            ".lsf-annotation-items__item.lsf-annotation-items__item_selected"
        ) ||
        document.querySelector(".lsf-annotation-items__item")
    );
}

function safeClickEl(el) {
    if (!el) return false;
    try {
        el.scrollIntoView?.({ block: "center", inline: "center" });
    } catch {}
    try {
        el.click();
        return true;
    } catch (e) {
        console.warn("[DingTag] safeClickEl error:", e?.name, e?.message);
        return false;
    }
}

/**
 * คลิกแบบ "เต็มชุด event" — pointerdown / mousedown / pointerup / mouseup / click
 * บางส่วนของ Label Studio (React) ฟัง mousedown ไม่ใช่แค่ click จึงต้องยิงครบเพื่อให้ state update
 */
function fireFullMouseClick(el) {
    if (!el) return false;
    try {
        el.scrollIntoView?.({ block: "center", inline: "center" });
    } catch {}
    try {
        const rect = el.getBoundingClientRect();
        const x = rect.left + Math.max(1, rect.width / 2);
        const y = rect.top + Math.max(1, rect.height / 2);
        const opts = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
            button: 0,
        };
        try {
            el.dispatchEvent(new PointerEvent("pointerdown", opts));
        } catch {
            try {
                el.dispatchEvent(new MouseEvent("pointerdown", opts));
            } catch {}
        }
        el.dispatchEvent(new MouseEvent("mousedown", opts));
        try {
            el.dispatchEvent(new PointerEvent("pointerup", opts));
        } catch {
            try {
                el.dispatchEvent(new MouseEvent("pointerup", opts));
            } catch {}
        }
        el.dispatchEvent(new MouseEvent("mouseup", opts));
        el.dispatchEvent(new MouseEvent("click", opts));
        return true;
    } catch (e) {
        console.warn("[DingTag] fireFullMouseClick error:", e?.name, e?.message);
        return false;
    }
}

/**
 * UI ว่างหลัง Cancel skip (ตามที่ user เรียก "No region"):
 * - ไม่มี Valid/Invalid ใน Annotation Item
 * - มักขึ้น "No annotation items" ทางขวา
 * - waveform ยังไม่มีช่วงสีเขียว
 */
/** sidebar ยังไม่มี segment (#1 / Classification) — ไม่มี region จริง */
function hasNoAnnotationItemsLabel() {
    const roots = document.querySelectorAll(
        ".lsf-annotation-items, .lsf-details__annotations, .lsf-details, .lsf-sidebar"
    );
    for (const root of roots) {
        const t = (root.textContent || "").replace(/\s+/g, " ");
        if (/no annotation items/i.test(t)) return true;
    }
    return false;
}

/**
 * region บน waveform มีอยู่แล้วพอ (ไม่ลากทับ)
 * ต้องไม่ใช่ "No annotation items" และต้องมี highlight เขียวชัด (ไม่ใช่แค่เส้น waveform เทา)
 */
function hasAdequateExistingWaveformRegion() {
    if (hasNoAnnotationItemsLabel()) {
        return { ok: false, reason: "no_annotation_items" };
    }
    if (scanClassificationTarget()) {
        return { ok: true, reason: "sidebar_classification" };
    }

    const canvasBar = estimateRegionWidthRatioFromCanvas();
    const domBar = measureDomRegionBarAgainstCanvas();
    const canvasStrong =
        canvasBar.found &&
        canvasBar.widthRatio >= 0.78 &&
        (canvasBar.leftInset ?? 1) <= 0.08 &&
        (canvasBar.rightInset ?? 1) <= 0.08;
    const domStrong =
        domBar.found &&
        domBar.widthRatio >= 0.78 &&
        (domBar.leftInset ?? 1) <= 0.1 &&
        (domBar.rightInset ?? 1) <= 0.1;

    if (!canvasStrong && !domStrong) {
        return {
            ok: false,
            reason: "no_green_region",
            metrics: { canvasBar, domBar },
        };
    }

    const verify = verifyWaveformRegionCoverage({
        requireZoomFit: false,
        minBarWidthRatio: 0.8,
        maxEdgeInset: 0.1,
    });
    if (verify.ok) {
        return { ok: true, reason: verify.reason, metrics: { verify, canvasBar, domBar } };
    }
    return { ok: false, reason: "no_region", metrics: { verify, canvasBar, domBar } };
}

/** ปุ่ม Valid/Invalid กลางจอ (Selection Scope) — ไม่ใช่แถว Classification ใน sidebar */
function getCenterPanelClassificationState() {
    let validEl = null;
    let invalidEl = null;
    for (const label of document.querySelectorAll(
        "span.lsf-label.lsf-label_clickable, .lsf-label.lsf-label_clickable"
    )) {
        const textEl = label.querySelector(".lsf-label__text");
        const raw = (textEl?.textContent || label.textContent || "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
        if (raw === "valid" || raw.startsWith("valid ")) validEl = label;
        if (raw === "invalid" || raw.startsWith("invalid ")) invalidEl = label;
    }
    const isChosen = (el) =>
        !!(
            el &&
            (el.classList.contains("lsf-label_selected") ||
                el.closest?.(".lsf-label_selected, .lsf-label_active"))
        );
    let selected = null;
    if (isChosen(validEl)) selected = "valid";
    else if (isChosen(invalidEl)) selected = "invalid";
    return {
        validEl,
        invalidEl,
        selected,
        buttonsPresent: !!(validEl && invalidEl),
    };
}

/** ยังไม่ถึงขั้น pipeline — sidebar ยังไม่มี Classification (ปกติก่อนลาก+Valid) */
function needsPrePipelineAnnotationSteps() {
    return !scanClassificationTarget();
}

/** อนุญาต recovery — ถ้ายังไม่มี Classification ใน sidebar ต้องลาก+Valid ได้เสมอ (แม้เคย Update) */
function canRunRecoveryForTask(taskId) {
    if (!taskId) return false;
    if (needsPrePipelineAnnotationSteps()) return true;
    return !processedTaskIds.has(taskId);
}

/** สำหรับ workflow: ยังไม่มี Valid/Invalid ใน sidebar */
function isAnnotationPanelEmpty() {
    if (scanClassificationTarget()) return false;
    if (hasNoAnnotationItemsLabel()) return true;
    const anyResult = document.querySelector(".lsf-annotation-items__result-item");
    return !anyResult;
}

function markPostCancelSkipWindow(reason) {
    postCancelSkipUntil = Date.now() + 15000;
    postCancelSkipKickTaskId = "";
    console.log("[DingTag] post-cancel skip window:", reason);
}

/**
 * หลัง Cancel skip DOM อาจโหลดช้า — รอให้เห็น Valid/Invalid หรือ region เดิมก่อนตัดสินใจลาก
 */
async function waitForPostCancelSkipReady(runToken, timeoutMs = 3500) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (runToken != null && !isRunActive(runToken)) {
            return { ok: false, reason: "stale", mode: "stale" };
        }
        const scanned = scanClassificationTarget();
        if (scanned) {
            return {
                ok: true,
                mode: "classified",
                classificationValue: scanned.classificationValue,
                targetEl: scanned.targetEl,
            };
        }
        const center = getCenterPanelClassificationState();
        if (center.selected && hasAdequateExistingWaveformRegion().ok) {
            return {
                ok: true,
                mode: "classified",
                classificationValue: center.selected,
                targetEl: center.selected === "valid" ? center.validEl : center.invalidEl,
            };
        }
        const region = hasAdequateExistingWaveformRegion();
        if (region.ok) {
            return { ok: true, mode: "has_region", regionReason: region.reason };
        }
        await delay(220);
    }
    const scanned = scanClassificationTarget();
    if (scanned) {
        return {
            ok: true,
            mode: "classified",
            classificationValue: scanned.classificationValue,
            targetEl: scanned.targetEl,
        };
    }
    if (hasAdequateExistingWaveformRegion().ok) {
        return { ok: true, mode: "has_region" };
    }
    if (isAnnotationPanelEmpty()) {
        return { ok: true, mode: "empty" };
    }
    return { ok: true, mode: "unknown" };
}

/**
 * อ่านสถานะ Classification จาก sidebar / Annotation Item
 * kind: valid | invalid | missing (ไม่มีแถว Classification) | other | no_region (ข้อความ combo เฉพาะกิจ)
 */
function getClassificationSidebarState() {
    const items = document.querySelectorAll(".lsf-annotation-items__result-item");
    for (const item of items) {
        const label = item.querySelector(".lsf-annotation-items__result-label");
        if (!label?.textContent?.includes("Classification")) continue;
        const valueEl = item.querySelector(".lsf-annotation-items__result-value");
        if (!valueEl) {
            return { kind: "missing", valueText: "", targetEl: null, row: item };
        }
        const valueText = (valueEl.textContent || "").trim();
        const norm = valueText.toLowerCase().replace(/\s+/g, " ");
        if (norm === "valid") {
            return {
                kind: "valid",
                valueText,
                targetEl: valueEl.querySelector("em") || valueEl,
                row: item,
            };
        }
        if (norm === "invalid") {
            return {
                kind: "invalid",
                valueText,
                targetEl: valueEl.querySelector("em") || valueEl,
                row: item,
            };
        }
        if (norm.includes("no region") || norm === "no_region" || norm === "noregon") {
            return { kind: "no_region", valueText, targetEl: valueEl, row: item };
        }
        return { kind: "other", valueText, targetEl: valueEl, row: item };
    }
    return { kind: "missing", valueText: "", targetEl: null, row: null };
}

/**
 * Classification ใน sidebar (Annotation Item) — ขึ้น **หลัง** ลาก region + กด Valid เท่านั้น
 * อย่าใช้เป็นเงื่อนไข "รอ target" ก่อนลาก — ใช้ needsPrePipelineAnnotationSteps() แทน
 */
function scanClassificationTarget() {
    const s = getClassificationSidebarState();
    if (s.kind === "valid" || s.kind === "invalid") {
        return { targetEl: s.targetEl, classificationValue: s.kind };
    }
    return null;
}

/** ต้องทำขั้นลาก/Valid ก่อน pipeline — จนกว่า sidebar จะมี Classification */
function classificationNeedsWaveformRecovery(state) {
    if (scanClassificationTarget()) return false;
    return true;
}

/** UI ว่าง (No region ตามภาพ user) → recovery ทันที ไม่รอ toggle */
function shouldRunWaveformRecovery(state) {
    return classificationNeedsWaveformRecovery(state);
}

function shouldRunWaveformRecoveryImmediately(state) {
    return !scanClassificationTarget();
}

function getWaveformRecoveryDelayMs(state) {
    if (!scanClassificationTarget()) return 300;
    return noClassificationTimeoutMs;
}

function getClassificationWaitStatusLabel(state, { waitedMs = 0, maxWaitMs = 0 } = {}) {
    if (scanClassificationTarget()) return "พร้อม pipeline";
    if (!autoSkipNoClassificationEnabled) {
        return "เปิด Waveform recovery ใน Settings เพื่อลาก region อัตโนมัติ";
    }
    if (isProcessing || activeRecoveryTaskId || postCancelSkipKickInFlight) {
        return "กำลังลาก region + Valid...";
    }
    if (maxWaitMs > 0 && waitedMs < maxWaitMs) {
        const left = Math.max(0, (maxWaitMs - waitedMs) / 1000).toFixed(1);
        return `รอเริ่ม recovery (${left}s)`;
    }
    return "ลาก region + กด Valid (Classification ขึ้น sidebar หลังนั้น)";
}

function findWaveformCanvas() {
    return (
        document.querySelector("#waveform-layer-main") ||
        document.querySelector('canvas[id*="waveform-layer"]') ||
        document.querySelector('canvas[id*="waveform"]')
    );
}

function findLsfAudioTag() {
    return document.querySelector(".lsf-audio-tag");
}

/**
 * scroller จริงจาก DOM ที่ user ส่งมา:
 * .lsf-audio-tag > div > div[style*="overflow: scroll hidden"]
 */
function findWaveformHorizontalScroller() {
    const audioTag = findLsfAudioTag();
    if (audioTag) {
        for (const div of audioTag.querySelectorAll("div")) {
            const st = div.style;
            const ox = (st.overflowX || st.overflow || "").toLowerCase();
            if (ox.includes("scroll") || ox.includes("auto")) return div;
        }
    }
    const canvas = findWaveformCanvas();
    if (!canvas) return null;
    let el = canvas.parentElement;
    for (let depth = 0; depth < 14 && el; depth++) {
        if (el.scrollWidth > el.clientWidth + 3) return el;
        const cs = getComputedStyle(el);
        const ox = cs.overflowX;
        const oy = cs.overflow;
        if (
            (ox === "auto" || ox === "scroll" || oy === "auto" || oy === "scroll") &&
            el.scrollHeight > el.clientHeight + 3
        ) {
            return el;
        }
        el = el.parentElement;
    }
    return canvas.parentElement || canvas;
}

/** แถบ absolute ใต้ waveform (ใช้ประกอบ ratio — ไม่ยึดค่า px คงที่ตามจอ) */
function findWaveformScrollTrackElement() {
    const audioTag = findLsfAudioTag();
    if (!audioTag) return null;
    let best = null;
    let bestW = 0;
    for (const div of audioTag.querySelectorAll("div")) {
        const st = div.style;
        if (st.position !== "absolute") continue;
        if (!String(st.top || "").includes("100")) continue;
        const w = div.getBoundingClientRect().width || div.offsetWidth || 0;
        if (w > bestW) {
            bestW = w;
            best = div;
        }
    }
    return best;
}

/**
 * วัดซูมแบบไม่พึ่งขนาดจอ (ใช้สัดส่วนเท่านั้น)
 * - scrollRatio = scroller.scrollWidth / clientWidth (หลัก — อัปเดตตาม viewport)
 * - trackRatio  = ความกว้างแถบ scroll track / viewport (สำรอง)
 * ซูมออกพอเมื่อ ratio ≈ 1.0 · ซูมเข้าเมื่อ ratio >> 1 (เช่น ~2.0 ไม่ว่า viewport กี่ px)
 */
function getWaveformZoomMetrics() {
    const scroller = findWaveformHorizontalScroller();
    const canvas = findWaveformCanvas();
    const canvasRect = canvas?.getBoundingClientRect();
    const viewportW =
        scroller?.clientWidth ||
        canvasRect?.width ||
        null;

    const scrollContentW = scroller?.scrollWidth || null;
    const scrollRatio =
        scrollContentW && viewportW
            ? scrollContentW / Math.max(1, viewportW)
            : null;

    const trackEl = findWaveformScrollTrackElement();
    const trackLayoutW = trackEl?.getBoundingClientRect().width || null;
    const trackStyleW = trackEl?.style?.width
        ? parseFloat(trackEl.style.width)
        : null;
    const trackW = trackLayoutW || trackStyleW || scrollContentW || null;
    const trackRatio =
        trackW && viewportW ? trackW / Math.max(1, viewportW) : null;

    const contentW = scrollContentW || trackW;
    const ratio = scrollRatio ?? trackRatio;
    const overflowPx = scroller
        ? Math.max(0, (scrollContentW || scroller.scrollWidth) - scroller.clientWidth)
        : Infinity;
    const overflowRatio =
        viewportW && Number.isFinite(overflowPx)
            ? overflowPx / Math.max(1, viewportW)
            : null;

    return {
        scroller,
        trackEl,
        trackW,
        viewportW,
        contentW,
        ratio,
        scrollRatio,
        trackRatio,
        overflowPx,
        overflowRatio,
    };
}

function getWaveformHorizontalOverflowPx() {
    return getWaveformZoomMetrics().overflowPx;
}

const WAVEFORM_ZOOM_FIT_MAX_RATIO = 1.05;
const WAVEFORM_ZOOM_FIT_MAX_OVERFLOW_RATIO = 0.02;
/** ปลาย timeline ที่มองเห็น vs duration รวม — ใช้ gap วินาที (ป้ายมักปัดเป็น 18.75 ทั้งที่ไฟล์ 19.4s) */
const WAVEFORM_MAX_TIMELINE_END_GAP_SEC = 0.85;
const WAVEFORM_MAX_TIMELINE_END_GAP_RATIO = 0.05;

function getWaveformTimelineCoverageRatio() {
    const total = getWaveformTotalDurationSec();
    const timelineEnd = collectTimecodeSecondsNearWaveform().timelineEndSec;
    if (!total || !timelineEnd) return null;
    return timelineEnd / total;
}

function getWaveformTimelineEndGapSec() {
    const total = getWaveformTotalDurationSec();
    const timelineEnd = collectTimecodeSecondsNearWaveform().timelineEndSec;
    if (!total || !timelineEnd) return null;
    return Math.max(0, total - timelineEnd);
}

function isWaveformTimelineSpanAdequate() {
    const gap = getWaveformTimelineEndGapSec();
    const total = getWaveformTotalDurationSec();
    if (gap == null || !total) return null;
    const maxGap = Math.max(
        WAVEFORM_MAX_TIMELINE_END_GAP_SEC,
        total * WAVEFORM_MAX_TIMELINE_END_GAP_RATIO
    );
    return gap <= maxGap;
}

function isWaveformZoomedToFit() {
    const zm = getWaveformZoomMetrics();
    if (zm.scrollRatio != null && zm.scrollRatio <= WAVEFORM_ZOOM_FIT_MAX_RATIO) {
        return true;
    }
    if (zm.trackRatio != null && zm.trackRatio <= WAVEFORM_ZOOM_FIT_MAX_RATIO) {
        return true;
    }
    if (zm.ratio != null && zm.ratio <= WAVEFORM_ZOOM_FIT_MAX_RATIO) {
        return true;
    }
    if (
        zm.overflowRatio != null &&
        zm.overflowRatio <= WAVEFORM_ZOOM_FIT_MAX_OVERFLOW_RATIO
    ) {
        return true;
    }
    return false;
}

/** พร้อมลาก region เต็ม: ซูมพอ + ปลาย timeline ใกล้ duration รวม */
function isWaveformReadyForFullRegionDrag() {
    if (!isWaveformZoomedToFit()) return false;
    const spanOk = isWaveformTimelineSpanAdequate();
    if (spanOk == null) return true;
    return spanOk;
}

/** duration รวมจาก [data-testid="timebox-end-time"] เช่น 00:00:19:400 */
function getWaveformTotalDurationSec() {
    const inp =
        document.querySelector('[data-testid="timebox-end-time"] input') ||
        document.querySelector(
            '.lsf-timer-duration-control input[readonly], .lsf-timer-duration-control input.lsf-time-box__input-time[readonly]'
        );
    if (inp?.value) {
        const sec = parseTimecodeToSec(inp.value);
        if (sec != null) return sec;
    }
    const fromDom = collectTimecodeSecondsNearWaveform().totalSec;
    return fromDom;
}

function scrollWaveformToStart() {
    const scroller = findWaveformHorizontalScroller();
    if (!scroller) return;
    try {
        scroller.scrollLeft = 0;
    } catch {}
}

/**
 * จำลอง Ctrl+Scroll บน waveform — บน Windows มักเป็น scroll ลง = ซูมออก (deltaY > 0)
 * ส่งทั้ง canvas และ scroller parent เผื่อ handler ผูกคนละ node
 */
function dispatchWaveformZoomWheel(el, { zoomOut = true, deltaMagnitude = 120 } = {}) {
    if (!el) return;
    const rect = el.getBoundingClientRect?.() || { left: 0, top: 0, width: 0, height: 0 };
    const x = rect.left + Math.max(1, rect.width) / 2;
    const y = rect.top + Math.max(1, rect.height) / 2;
    const deltaY = zoomOut ? Math.abs(deltaMagnitude) : -Math.abs(deltaMagnitude);
    const base = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        ctrlKey: true,
        deltaY,
        deltaX: 0,
        deltaMode: 0,
    };
    try {
        el.dispatchEvent(new WheelEvent("wheel", base));
    } catch {
        try {
            el.dispatchEvent(new WheelEvent("wheel", { ...base, deltaY }));
        } catch {}
    }
}

/** ซูมออกจนเห็น waveform เต็มความกว้าง (ก่อนลากสร้าง region) */
async function zoomWaveformOutToFit({ maxSteps = 28, stepDelayMs = 85 } = {}) {
    const canvas = findWaveformCanvas();
    if (!canvas) {
        console.warn("[DingTag] zoomWaveformOutToFit: ไม่พบ waveform canvas");
        return { ok: false, reason: "no_canvas", steps: 0 };
    }
    try {
        canvas.scrollIntoView?.({ block: "center", inline: "nearest" });
    } catch {}
    scrollWaveformToStart();
    if (isWaveformReadyForFullRegionDrag()) {
        const zm0 = getWaveformZoomMetrics();
        const gap = getWaveformTimelineEndGapSec();
        console.log(
            `[DingTag] waveform พร้อมลาก region (scrollRatio ${zm0.scrollRatio?.toFixed(3)}, endGap ${gap?.toFixed(2) ?? "?"}s)`
        );
        return { ok: true, reason: "already_fit", steps: 0 };
    }

    const wheelTargets = () => {
        const scroller = findWaveformHorizontalScroller();
        const audioTag = findLsfAudioTag();
        const list = [canvas];
        if (scroller && scroller !== canvas) list.push(scroller);
        if (audioTag) list.push(audioTag);
        return list;
    };

    let lastRatio = getWaveformZoomMetrics().ratio ?? Infinity;
    let stagnant = 0;
    for (let step = 1; step <= maxSteps; step++) {
        for (const t of wheelTargets()) {
            dispatchWaveformZoomWheel(t, { zoomOut: true });
        }
        await delay(stepDelayMs);
        scrollWaveformToStart();

        if (isWaveformReadyForFullRegionDrag()) {
            const zm = getWaveformZoomMetrics();
            const gap = getWaveformTimelineEndGapSec();
            console.log(
                `[DingTag] waveform พร้อมลาก region (${step} ครั้ง, scrollRatio ${zm.scrollRatio?.toFixed(3)}, endGap ${gap?.toFixed(2) ?? "?"}s)`
            );
            return { ok: true, reason: "fit", steps: step };
        }

        const zmStep = getWaveformZoomMetrics();
        const ratio = zmStep.scrollRatio ?? zmStep.ratio ?? lastRatio;
        if (ratio >= lastRatio - 0.02) {
            stagnant++;
        } else {
            stagnant = 0;
        }
        lastRatio = ratio;
        if (stagnant >= 4) {
            const zm = getWaveformZoomMetrics();
            console.log(
                `[DingTag] waveform ซูมออกหยุดเปลี่ยน (${step} ครั้ง, scrollRatio ${zm.scrollRatio?.toFixed(3)}) — ใช้ระดับปัจจุบัน`
            );
            return { ok: isWaveformReadyForFullRegionDrag(), reason: "stagnant", steps: step };
        }
    }

    const zm = getWaveformZoomMetrics();
    const gap = getWaveformTimelineEndGapSec();
    console.warn(
        `[DingTag] waveform ซูมครบ ${maxSteps} ครั้ง — scrollRatio ${zm.scrollRatio?.toFixed(3)}, endGap ${gap?.toFixed(2) ?? "?"}s`
    );
    return { ok: isWaveformReadyForFullRegionDrag(), reason: "max_steps", steps: maxSteps };
}

/** container รอบ waveform (timeline + canvas + scrollbar) */
function findWaveformRoot() {
    return findLsfAudioTag() || findWaveformCanvas()?.closest?.(".lsf-audio-tag") || findWaveformCanvas();
}

/** แปลง 00:00:19:400 / 00:00:17.500 → วินาที */
function parseTimecodeToSec(raw) {
    const t = String(raw || "").trim();
    if (!t) return null;
    let m = t.match(/^(\d+):(\d+):(\d+):(\d{1,3})$/);
    if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
    m = t.match(/^(\d+):(\d+):(\d+)\.(\d{1,3})$/);
    if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
    m = t.match(/^(\d+):(\d+):(\d+)$/);
    if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3];
    m = t.match(/^(\d+):(\d+)\.(\d{1,3})$/);
    if (m) return +m[1] * 60 + +m[2] + +m[3] / 1000;
    return null;
}

function collectTimecodeSecondsNearWaveform() {
    const root = findWaveformRoot();
    const canvas = findWaveformCanvas();
    if (!root || !canvas) return { totalSec: null, timelineEndSec: null, samples: [] };
    const cRect = canvas.getBoundingClientRect();
    const re = /\d{1,2}:\d{2}(?::\d{2})?(?:[.:]\d{1,3})?/g;
    const timelineSecs = [];
    const allSecs = [];

    for (const el of root.querySelectorAll("*")) {
        if (el.children.length > 0) continue;
        const text = (el.textContent || "").trim();
        if (!text || text.length > 24) continue;
        const matches = text.match(re);
        if (!matches) continue;
        for (const token of matches) {
            const sec = parseTimecodeToSec(token);
            if (sec == null || sec > 24 * 3600) continue;
            allSecs.push(sec);
            const r = el.getBoundingClientRect();
            if (
                r.width > 0 &&
                r.top >= cRect.top - 36 &&
                r.bottom <= cRect.top + 28
            ) {
                timelineSecs.push(sec);
            }
        }
    }

    const totalSec = allSecs.length ? Math.max(...allSecs) : null;
    const timelineEndSec = timelineSecs.length ? Math.max(...timelineSecs) : null;
    return { totalSec, timelineEndSec, samples: allSecs };
}

/** วัดแถบ region ใน DOM (ถ้ามี overlay แยกจาก canvas) */
function measureDomRegionBarAgainstCanvas() {
    const canvas = findWaveformCanvas();
    const root = findWaveformRoot();
    if (!canvas || !root) return { found: false, reason: "no_canvas_or_root" };

    const cRect = canvas.getBoundingClientRect();
    let best = null;

    for (const el of root.querySelectorAll(
        "div, span, [class*='region' i], [class*='segment' i], [class*='selection' i]"
    )) {
        const cls = String(el.className || "");
        if (cls.length > 200) continue;
        const r = el.getBoundingClientRect();
        if (r.width < cRect.width * 0.25 || r.height < 2 || r.height > 48) continue;
        if (r.top < cRect.top - 8 || r.bottom > cRect.bottom + 36) continue;
        if (r.right < cRect.left + 4 || r.left > cRect.right - 4) continue;
        const widthRatio = r.width / Math.max(1, cRect.width);
        const leftInset = (r.left - cRect.left) / Math.max(1, cRect.width);
        const rightInset = (cRect.right - r.right) / Math.max(1, cRect.width);
        const score = widthRatio - leftInset * 0.35 - rightInset * 0.35;
        if (!best || score > best.score) {
            best = {
                score,
                widthRatio,
                leftInset,
                rightInset,
                className: cls.slice(0, 120),
                tag: el.tagName,
            };
        }
    }

    if (!best) return { found: false, reason: "no_dom_bar" };
    return { found: true, ...best };
}

/** ประมาณความกว้าง highlight บน canvas (region อาจวาดบน #waveform-layer-main โดยตรง) */
function estimateRegionWidthRatioFromCanvas() {
    const canvas = findWaveformCanvas();
    if (!canvas || canvas.width < 20 || canvas.height < 20) {
        return { found: false, reason: "no_canvas" };
    }
    try {
        const ctx = canvas.getContext("2d");
        if (!ctx) return { found: false, reason: "no_ctx" };
        const w = canvas.width;
        const h = canvas.height;
        const yRows = [0.55, 0.68, 0.78].map((r) => Math.floor(h * r));
        const isSelectionPx = (r, g, b, a) =>
            a > 25 && g > 140 && g >= r + 10 && g >= b + 10;
        const isBg = (r, g, b, a, ref) =>
            a < 8 ||
            (Math.abs(r - ref[0]) < 14 &&
                Math.abs(g - ref[1]) < 14 &&
                Math.abs(b - ref[2]) < 14);

        let left = w;
        let right = 0;
        let activeCols = 0;
        for (const y of yRows) {
            const ref = ctx.getImageData(2, y, 1, 1).data;
            for (let x = 0; x < w; x++) {
                const px = ctx.getImageData(x, y, 1, 1).data;
                if (isSelectionPx(px[0], px[1], px[2], px[3])) {
                    left = Math.min(left, x);
                    right = Math.max(right, x);
                    activeCols++;
                }
            }
        }
        if (activeCols < Math.max(8, w * 0.08)) {
            return { found: false, reason: "no_highlight_band", activeCols, w };
        }
        const widthRatio = (right - left + 1) / w;
        const leftInset = left / w;
        const rightInset = (w - 1 - right) / w;
        return {
            found: true,
            method: "canvas_scan",
            widthRatio,
            leftInset,
            rightInset,
            activeCols,
            w,
        };
    } catch (e) {
        return { found: false, reason: "canvas_read_blocked", detail: e?.message };
    }
}

/**
 * ตรวจว่า region ครอบ waveform เต็มพอหรือไม่ (หลังลาก)
 * - DOM bar width (ถ้ามี)
 * - canvas highlight width (region วาดบน canvas)
 * - timeline ปลายสุดที่มองเห็น เทียบ duration รวม
 */
function verifyWaveformRegionCoverage({
    minBarWidthRatio = 0.93,
    maxEdgeInset = 0.06,
    requireZoomFit = true,
} = {}) {
    const canvas = findWaveformCanvas();
    const cRect = canvas?.getBoundingClientRect();
    const zoom = getWaveformZoomMetrics();
    const zoomFit = isWaveformZoomedToFit();
    const times = collectTimecodeSecondsNearWaveform();
    const domBar = measureDomRegionBarAgainstCanvas();
    const canvasBar = estimateRegionWidthRatioFromCanvas();

    const totalSec = times.totalSec;
    const timelineEndSec = times.timelineEndSec;
    const timelineCoverage =
        totalSec && timelineEndSec ? timelineEndSec / totalSec : null;
    const timelineEndGap = getWaveformTimelineEndGapSec();
    const spanOk = isWaveformTimelineSpanAdequate();

    const metrics = {
        zoomFit,
        zoomRatio: zoom.ratio,
        scrollRatio: zoom.scrollRatio,
        trackRatio: zoom.trackRatio,
        viewportWidthPx: zoom.viewportW,
        overflowRatio: zoom.overflowRatio,
        totalSec,
        timelineEndSec,
        timelineCoverage,
        timelineEndGap,
        timelineSpanOk: spanOk,
        domBar,
        canvasBar,
        canvasWidth: cRect ? Math.round(cRect.width) : null,
    };

    if (requireZoomFit && !zoomFit) {
        return { ok: false, reason: "not_zoomed_fit", metrics };
    }
    if (spanOk === false) {
        return { ok: false, reason: "timeline_end_gap", metrics };
    }

    if (domBar.found) {
        const edgeOk =
            (domBar.leftInset ?? 1) <= maxEdgeInset &&
            (domBar.rightInset ?? 1) <= maxEdgeInset;
        const widthOk = domBar.widthRatio >= minBarWidthRatio;
        if (widthOk && edgeOk) {
            return { ok: true, reason: "dom_bar_full", metrics };
        }
        return { ok: false, reason: "dom_bar_partial", metrics };
    }

    if (canvasBar.found) {
        const edgeOk =
            (canvasBar.leftInset ?? 1) <= maxEdgeInset &&
            (canvasBar.rightInset ?? 1) <= maxEdgeInset;
        const widthOk = canvasBar.widthRatio >= minBarWidthRatio;
        if (widthOk && edgeOk) {
            return { ok: true, reason: "canvas_highlight_full", metrics };
        }
        return { ok: false, reason: "canvas_highlight_partial", metrics };
    }

    if (spanOk === true && (canvasBar.found ? canvasBar.widthRatio >= 0.88 : true)) {
        return { ok: true, reason: "timeline_span_ok", metrics };
    }

    return { ok: false, reason: "coverage_unknown", metrics };
}

/** ซูมออก → ลาก → verify; ไม่ผ่านจะ retry */
async function createFullWaveformRegionWithVerify(runToken, { maxAttempts = 3 } = {}) {
    pauseWaveformMedia();
    let lastVerify = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (!isRunActive(runToken)) {
            return { ok: false, reason: "stale", attempt, verify: lastVerify };
        }
        pauseWaveformMedia();

        const zoomRes = await zoomWaveformOutToFit({
            maxSteps: attempt === 1 ? 32 : 18,
        });
        await delay(350);
        if (!isRunActive(runToken)) {
            return { ok: false, reason: "stale", attempt, verify: lastVerify };
        }

        scrollWaveformToStart();
        const dragRes = await dragWaveformFull({
            edgePx: 0,
            steps: 20 + attempt * 4,
        });
        if (!dragRes.ok) {
            return { ok: false, reason: dragRes.reason, attempt, zoomRes, verify: lastVerify };
        }
        await delay(450);

        lastVerify = verifyWaveformRegionCoverage();
        console.log(
            `[DingTag] region verify (attempt ${attempt}/${maxAttempts}):`,
            lastVerify.ok ? "OK" : "FAIL",
            lastVerify.reason,
            lastVerify.metrics
        );

        if (lastVerify.ok) {
            return {
                ok: true,
                reason: lastVerify.reason,
                attempt,
                zoomRes,
                verify: lastVerify,
            };
        }
    }

    return {
        ok: false,
        reason: "region_not_full",
        attempt: maxAttempts,
        verify: lastVerify,
    };
}

function dispatchPointerMouseChain(el, type, x, y, buttons = 0) {
    if (!el) return;
    const base = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        button: 0,
        buttons,
    };
    const ptrBase = {
        ...base,
        pointerType: "mouse",
        pointerId: 1,
        isPrimary: true,
        pressure: buttons ? 0.5 : 0,
        width: 1,
        height: 1,
    };
    const safe = (evt) => {
        try {
            el.dispatchEvent(evt);
        } catch {}
    };
    const ptr = (t) => {
        try {
            return new PointerEvent(t, ptrBase);
        } catch {
            return new MouseEvent(t, base);
        }
    };
    if (type === "down") {
        safe(ptr("pointerdown"));
        safe(new MouseEvent("mousedown", { ...base, buttons: 1 }));
    } else if (type === "move") {
        safe(ptr("pointermove"));
        safe(new MouseEvent("mousemove", { ...base, buttons: 1 }));
    } else if (type === "up") {
        safe(ptr("pointerup"));
        safe(new MouseEvent("mouseup", { ...base, buttons: 0 }));
    }
}

/** ลากเมาส์บน element จาก (x0,y0) ถึง (x1,y1) — client coordinates */
function dispatchDragOnElement(el, x0, y0, x1, y1, steps = 12) {
    if (!el) return false;
    try {
        el.scrollIntoView?.({ block: "center", inline: "nearest" });
    } catch {}
    dispatchPointerMouseChain(el, "down", x0, y0, 1);
    const n = Math.max(2, steps);
    for (let i = 1; i <= n; i++) {
        const t = i / n;
        const x = x0 + (x1 - x0) * t;
        const y = y0 + (y1 - y0) * t;
        dispatchPointerMouseChain(el, "move", x, y, 1);
    }
    dispatchPointerMouseChain(el, "up", x1, y1, 0);
    return true;
}

/**
 * ลากเต็มความกว้าง timeline หลังซูมออก
 * - X จาก scroll viewport (overflow: scroll) ไม่ใช่ขอบ canvas อย่างเดียว
 * - Y กลาง canvas (ชั้นคลื่นเสียง)
 * - ยิง event บน scroller เป็นหลัก (LSF ผูก timeline กับ scroll + spacer)
 */
async function dragWaveformFull({ edgePx = 0, steps = 22 } = {}) {
    pauseWaveformMedia();
    const canvas = findWaveformCanvas();
    if (!canvas) {
        console.warn("[DingTag] dragWaveformFull: ไม่พบ waveform canvas");
        return { ok: false, reason: "no_canvas" };
    }
    const scroller = findWaveformHorizontalScroller();
    if (!scroller) {
        console.warn("[DingTag] dragWaveformFull: ไม่พบ scroll container");
        return { ok: false, reason: "no_scroller" };
    }

    const scrollRect = scroller.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    if (scrollRect.width <= 8 || canvasRect.height <= 8) {
        return { ok: false, reason: "zero_size" };
    }

    const pad = Math.max(0, edgePx);
    const xStart = scrollRect.left + pad;
    const xEnd = scrollRect.right - pad;
    const y = canvasRect.top + canvasRect.height / 2;

    try {
        canvas.scrollIntoView?.({ block: "center", inline: "nearest" });
    } catch {}
    scrollWaveformToStart();

    dispatchDragOnElement(scroller, xStart, y, xEnd, y, steps);

    console.log(
        `[DingTag] ลาก waveform เต็มช่วง (scroll div) pad=${pad}px ` +
            `(${xStart.toFixed(0)},${y.toFixed(0)}) → (${xEnd.toFixed(0)},${y.toFixed(0)}) ` +
            `scrollW=${scrollRect.width.toFixed(0)} canvasW=${canvasRect.width.toFixed(0)}`
    );
    return {
        ok: true,
        reason: "dragged_scroller",
        xStart,
        xEnd,
        scrollWidth: scrollRect.width,
        canvasWidth: canvasRect.width,
    };
}

async function waitForClassificationRow(timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const row = findClassificationResultRow();
        if (row) return row;
        if (!isAutoPilotOn) return null;
        await delay(250);
    }
    return findClassificationResultRow();
}

async function waitForClassificationTarget(timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const hit = scanClassificationTarget();
        if (hit) return hit;
        if (!isAutoPilotOn) return null;
        await delay(250);
    }
    return scanClassificationTarget();
}

/**
 * กดปุ่ม Valid บน waveform / label bar (span.lsf-label_clickable + .lsf-label__text)
 * ใช้หลังลาก waveform เต็มช่วงเมื่อยังไม่มี Classification ใน sidebar
 */
function clickWaveformValidLabel() {
    const labels = document.querySelectorAll(
        "span.lsf-label.lsf-label_clickable, .lsf-label.lsf-label_clickable"
    );
    for (const label of labels) {
        const textEl = label.querySelector(".lsf-label__text");
        const text = (textEl?.textContent || "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
        if (text !== "valid") continue;
        try {
            label.scrollIntoView?.({ block: "center", inline: "center" });
        } catch {}
        if (fireFullMouseClick(label)) {
            return { ok: true, reason: "lsf_label_full_mouse" };
        }
        try {
            label.click();
            return { ok: true, reason: "lsf_label_click" };
        } catch (e) {
            console.warn("[DingTag] clickWaveformValidLabel:", e?.name, e?.message);
        }
    }
    for (const textEl of document.querySelectorAll(".lsf-label__text")) {
        const t = (textEl.textContent || "").trim().toLowerCase();
        if (t !== "valid") continue;
        const label = textEl.closest(".lsf-label_clickable, span.lsf-label, .lsf-label");
        if (!label) continue;
        try {
            label.scrollIntoView?.({ block: "center", inline: "center" });
        } catch {}
        if (fireFullMouseClick(label)) {
            return { ok: true, reason: "lsf_label__text_parent" };
        }
    }
    if (clickExactClassificationChoice("valid")) {
        return { ok: true, reason: "exact_choice" };
    }
    if (forceClickByText(["Valid"])) {
        return { ok: true, reason: "force_text" };
    }
    return { ok: false, reason: "valid_label_not_found" };
}

/** เปิด dropdown Classification แล้วเลือก Invalid */
async function setClassificationToInvalid() {
    const row = await waitForClassificationRow(10000);
    if (!row) {
        return { ok: false, reason: "no_classification_row" };
    }
    fireFullMouseClick(row);
    await delay(400);
    if (clickExactClassificationChoice("invalid")) {
        await delay(500);
        const hit = scanClassificationTarget();
        if (hit?.classificationValue === "invalid") {
            return { ok: true, reason: "exact_choice" };
        }
    }
    const valEl = row.querySelector(".lsf-annotation-items__result-value");
    if (valEl) fireFullMouseClick(valEl);
    await delay(350);
    if (forceClickByText(["Invalid"])) {
        await delay(500);
        return { ok: true, reason: "force_text" };
    }
    const hit = scanClassificationTarget();
    if (hit?.classificationValue === "invalid") {
        return { ok: true, reason: "verified_invalid" };
    }
    return { ok: false, reason: "invalid_not_set" };
}

function clickClassificationFocus() {
    const hit = scanClassificationTarget();
    if (hit?.targetEl) {
        fireFullMouseClick(hit.targetEl);
        return true;
    }
    const row = findClassificationResultRow();
    if (row) {
        fireFullMouseClick(row);
        return true;
    }
    return refocusClassification();
}

/**
 * หลัง Cancel skip (มักกดเอง) — รอ DOM แล้วเข้า pipeline/recovery (ไม่ค้าง status รอ target)
 */
async function kickPostCancelSkipHandling(seedTaskId = "") {
    if (postCancelSkipKickInFlight || activeRecoveryTaskId) return;
    if (isProcessing && activeRecoveryTaskId) return;

    let taskId = String(seedTaskId || "").trim();
    postCancelSkipKickInFlight = true;

    try {
        setStatus("Was skipped → รอ DOM หลัง Cancel skip...");
        await delay(900);

        for (let i = 0; i < 30 && !taskId; i++) {
            await delay(200);
            taskId = getCurrentTaskId();
        }
        if (!taskId) {
            setStatus("หลัง Cancel skip — รอ Task ID...");
            console.warn("[DingTag] post-cancel: อ่าน Task ID ไม่ได้");
            return;
        }
        if (!canRunRecoveryForTask(taskId)) return;

        console.log(`[DingTag] post-cancel: Cancel skip → ลาก region (task ${taskId})`);
        isProcessing = true;
        setStatus("Was skipped → กด Cancel skip...");
        const csRes = await ensureCancelSkipIfWasSkipped({ runToken: null });
        if (csRes.reason === "stale") return;
        pauseWaveformMedia();
        await delay(700);
        setStatus(`หลัง Cancel skip: รอ waveform...`);
        await waitForWaveformAnnotatable(14000);
        pauseWaveformMedia();
        setStatus(`หลัง Cancel skip: ลาก region + Valid...`);
        await runNoClassificationRecoveryFlow(taskId);
    } catch (e) {
        console.warn("[DingTag] post-cancel kick error:", e?.name, e?.message, e);
        setStatus("post-cancel error (ดู Console)");
    } finally {
        lastRecoveryEndedAt = Date.now();
        if (taskId) lastRecoveryEndedTaskId = taskId;
        postCancelSkipKickTaskId = "";
        postCancelSkipKickInFlight = false;
        isProcessing = false;
        activeRunToken = 0;
        activeTimeouts = [];
        if (isAutoPilotOn) setStatus("กำลังรอ task ใหม่...");
    }
}

/** เริ่ม waveform recovery จาก autopilot (กันเรียกซ้อนเมื่อ isProcessing) */
function scheduleNoClassificationRecoveryFromAutopilot(currentTaskId, classState, triggerLabel) {
    if (!currentTaskId || isProcessing || activeRecoveryTaskId || postCancelSkipKickInFlight) {
        return false;
    }
    if (!autoSkipNoClassificationEnabled) return false;
    if (!canRunRecoveryForTask(currentTaskId)) return false;
    if (scanClassificationTarget()) {
        return false;
    }
    if (!shouldRunWaveformRecovery(classState)) return false;

    const stillNeedsPrep = needsPrePipelineAnnotationSteps();
    const now = Date.now();
    if (now - prepRecoveryLastScheduleAt < PREP_RECOVERY_DEBOUNCE_MS) {
        return false;
    }
    if (
        !stillNeedsPrep &&
        currentTaskId === lastRecoveryEndedTaskId &&
        now - lastRecoveryEndedAt < RECOVERY_REPEAT_COOLDOWN_MS
    ) {
        console.warn(
            `[DingTag] ข้าม recovery ซ้ำ task ${currentTaskId} (cooldown ${RECOVERY_REPEAT_COOLDOWN_MS}ms)`
        );
        return false;
    }

    prepRecoveryLastScheduleAt = now;
    noClassificationTaskId = "";
    noClassificationStartedAt = 0;
    isProcessing = true;
    console.log(`🔧 task ${currentTaskId}: ${triggerLabel} → waveform recovery`);
    setStatus(`task ${currentTaskId}: waveform recovery (${triggerLabel})...`);

    (async () => {
        try {
            await runNoClassificationRecoveryFlow(currentTaskId);
        } catch (e) {
            console.warn("[DingTag] waveform recovery error:", e?.name, e?.message);
        } finally {
            if (activeRecoveryTaskId === currentTaskId) activeRecoveryTaskId = "";
            lastRecoveryEndedAt = Date.now();
            lastRecoveryEndedTaskId = currentTaskId;
            await delay(1500);
            isProcessing = false;
            activeRunToken = 0;
            activeTimeouts = [];
            console.log("🔄 จบ waveform recovery — รอ task ใหม่...");
            if (isAutoPilotOn) setStatus("กำลังรอ task ใหม่...");
        }
    })();
    return true;
}

async function fallbackSkipNoClassification(taskId) {
    lastProcessedTaskId = taskId;
    const sent = await goToNextTask({ runToken: null });
    if (sent) {
        console.log(`⏭️ no-classification fallback: Shift+↓ จาก task ${taskId}`);
    } else {
        console.warn(`⚠️ no-classification fallback: Shift+↓ ไม่สำเร็จ (task ${taskId})`);
    }
    await delay(800);
}

/**
 * ไม่เจอ Classification: ซูมออก waveform (Ctrl+Scroll) → ลากเต็มช่วง → กด Valid → pipeline Classification ปกติ
 */
async function runNoClassificationRecoveryFlow(currentTaskId) {
    const pipelineTaskId = currentTaskId;
    if (activeRecoveryTaskId && activeRecoveryTaskId !== pipelineTaskId) {
        console.warn(
            `[DingTag] recovery ซ้อน: ข้าม task ${pipelineTaskId} (กำลังทำ ${activeRecoveryTaskId})`
        );
        return;
    }
    activeRecoveryTaskId = pipelineTaskId;

    const runToken = ++runTokenCounter;
    activeRunToken = runToken;
    const cycleStartAt = Date.now();
    lastProcessedTaskId = pipelineTaskId;
    noClassificationTaskId = "";
    noClassificationStartedAt = 0;

    try {
        pauseWaveformMedia();
        setStatus(`task ${pipelineTaskId}: รอ waveform พร้อมลาก...`);
        await waitForWaveformAnnotatable(14000);
        pauseWaveformMedia();

        scrollSidebarToActiveTask();
        await delay(READ_DELAY_MS);
        if (!isRunActive(runToken)) return;

        const csRes = await ensureCancelSkipIfWasSkipped({ runToken });
        if (csRes.reason === "stale") return;
        if (!csRes.ok && csRes.reason !== "not_skipped") {
            console.warn("[DingTag] recovery: Cancel skip ไม่สำเร็จ —", csRes.reason);
        }

        const sidebarReady = scanClassificationTarget();
        if (sidebarReady) {
            console.log(
                `[DingTag] recovery: sidebar มี ${sidebarReady.classificationValue} — เข้า pipeline`
            );
            await runTranscriptionPipeline(runToken, cycleStartAt, pipelineTaskId, {
                classificationValue: sidebarReady.classificationValue,
                skipInitialClassificationClick: false,
                forceTranscribeFromInvalid: sidebarReady.classificationValue === "invalid",
            });
            return;
        }

        setStatus(`task ${pipelineTaskId}: ลาก region + กด Valid...`);
        const regionRes = await createFullWaveformRegionWithVerify(runToken, { maxAttempts: 3 });
        if (!regionRes.ok) {
            const vr = regionRes.verify?.reason || regionRes.reason;
            console.warn(
                "[DingTag] recovery: region ไม่ครอบ waveform เต็ม —",
                vr,
                regionRes.verify?.metrics
            );
            setStatus(`region ไม่เต็ม (${vr}) → Shift+↓`);
            await fallbackSkipNoClassification(pipelineTaskId);
            return;
        }
        console.log(
            `[DingTag] recovery: region OK (${regionRes.reason}, attempt ${regionRes.attempt})`
        );
        await delay(350);
        if (!isRunActive(runToken)) return;

        setStatus("recovery: กด Valid...");
        const validRes = clickWaveformValidLabel();
        if (!validRes.ok) {
            console.warn("[DingTag] recovery กด Valid ไม่สำเร็จ:", validRes.reason);
            setStatus(`กด Valid ไม่สำเร็จ → Shift+↓`);
            await fallbackSkipNoClassification(pipelineTaskId);
            return;
        }
        console.log("✅ recovery: กด Valid แล้ว (" + validRes.reason + ")");
        await delay(800);
        if (!isRunActive(runToken)) return;

        const scanned = await waitForClassificationTarget(4000);
        if (!scanned) {
            console.warn(
                "[DingTag] recovery: sidebar ยังไม่ขึ้น Classification หลัง Valid — ลอง pipeline ต่อ"
            );
        }

        setStatus("recovery: เข้า pipeline...");
        await runTranscriptionPipeline(runToken, cycleStartAt, pipelineTaskId, {
            classificationValue: scanned?.classificationValue || "valid",
            skipInitialClassificationClick: false,
            forceTranscribeFromInvalid: false,
        });
    } catch (e) {
        console.error("[DingTag] no-classification recovery:", e);
        setStatus("recovery error → Shift+↓");
        await fallbackSkipNoClassification(pipelineTaskId);
    } finally {
        releaseTaskClaimIfUncommitted(pipelineTaskId, "recovery_end");
        if (activeRecoveryTaskId === pipelineTaskId) activeRecoveryTaskId = "";
    }
}

/**
 * Robust JS click — แทน pyautogui Physical click
 * รวมทุก trick ที่ทำให้ React/Label Studio component "เชื่อ" ว่าคลิกจริง:
 *   1) ตรวจ DOM/disabled/aria-disabled — รอจนพร้อม (ลองได้สูงสุด `tries`)
 *   2) scrollIntoView (block: center) แล้ว wait double rAF ให้ React render เสร็จ
 *   3) Event ครบ chain (composed: true เผื่อ Shadow DOM):
 *        pointerover → mouseover → pointerenter → mouseenter
 *        → pointermove → mousemove
 *        → focus()
 *        → pointerdown → mousedown
 *        → pointerup   → mouseup
 *        → click
 *        → el.click()   (เผื่อกรณี React ผูกที่ native onClick)
 *   4) ใช้ viewport coordinate จริง (rect.left + rect.width/2, rect.top + rect.height/2)
 *      — ไม่ขึ้นกับขนาดจอ/DPI/multi-monitor (ต่างจาก pyautogui)
 *   5) Fallback ท้ายสุด: focus + KeyboardEvent Enter (บาง button รับ Enter)
 * Return: { ok, reason }
 */
async function robustClick(el, { tries = 3, intervalMs = 200, runToken, logLabel = "robustClick" } = {}) {
    if (!el) return { ok: false, reason: "no_element" };

    const waitDoubleRaf = () =>
        new Promise((resolve) => {
            try {
                requestAnimationFrame(() => requestAnimationFrame(resolve));
            } catch {
                resolve();
            }
        });

    const isDisabled = (node) => {
        if (!node) return true;
        if (node.disabled) return true;
        if (node.hasAttribute?.("disabled")) return true;
        if (node.getAttribute?.("aria-disabled") === "true") return true;
        return false;
    };

    for (let i = 1; i <= tries; i++) {
        if (runToken != null && !isRunActive(runToken)) {
            return { ok: false, reason: "stale" };
        }
        if (!document.contains(el)) {
            return { ok: false, reason: "element_removed" };
        }
        if (isDisabled(el)) {
            console.warn(`⚠️ ${logLabel}: element ยัง disabled (${i}/${tries})`);
            await delay(intervalMs);
            continue;
        }

        try {
            el.scrollIntoView?.({ block: "center", inline: "center" });
        } catch {}
        await waitDoubleRaf();
        if (runToken != null && !isRunActive(runToken)) {
            return { ok: false, reason: "stale" };
        }

        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            console.warn(`⚠️ ${logLabel}: element ขนาด 0 (${i}/${tries})`);
            await delay(intervalMs);
            continue;
        }
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;

        const baseMouseOpts = {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            clientX: x,
            clientY: y,
            screenX: x,
            screenY: y,
            button: 0,
            buttons: 1,
        };
        const releaseMouseOpts = { ...baseMouseOpts, buttons: 0 };
        const pointerOpts = {
            ...baseMouseOpts,
            pointerType: "mouse",
            pointerId: 1,
            isPrimary: true,
            pressure: 0.5,
            width: 1,
            height: 1,
        };
        const releasePointerOpts = {
            ...releaseMouseOpts,
            pointerType: "mouse",
            pointerId: 1,
            isPrimary: true,
            pressure: 0,
            width: 1,
            height: 1,
        };

        const safeDispatch = (target, evt) => {
            try {
                target.dispatchEvent(evt);
            } catch {}
        };
        const makePointer = (type, opts) => {
            try {
                return new PointerEvent(type, opts);
            } catch {
                return new MouseEvent(type, opts);
            }
        };

        try {
            safeDispatch(el, makePointer("pointerover", pointerOpts));
            safeDispatch(el, new MouseEvent("mouseover", baseMouseOpts));
            safeDispatch(el, makePointer("pointerenter", { ...pointerOpts, bubbles: false }));
            safeDispatch(el, new MouseEvent("mouseenter", { ...baseMouseOpts, bubbles: false }));
            safeDispatch(el, makePointer("pointermove", pointerOpts));
            safeDispatch(el, new MouseEvent("mousemove", baseMouseOpts));

            try {
                el.focus?.({ preventScroll: true });
            } catch {}

            safeDispatch(el, makePointer("pointerdown", pointerOpts));
            safeDispatch(el, new MouseEvent("mousedown", baseMouseOpts));
            safeDispatch(el, makePointer("pointerup", releasePointerOpts));
            safeDispatch(el, new MouseEvent("mouseup", releaseMouseOpts));
            safeDispatch(el, new MouseEvent("click", releaseMouseOpts));

            try {
                el.click?.();
            } catch {}

            console.log(`✅ ${logLabel}: คลิกสำเร็จ (${i}/${tries}) @ viewport(${x.toFixed(0)},${y.toFixed(0)})`);
            return { ok: true, reason: "clicked_robust" };
        } catch (e) {
            console.warn(`[DingTag] ${logLabel} dispatch error (${i}/${tries}):`, e?.name, e?.message);
        }

        await delay(intervalMs);
    }

    try {
        el.focus?.({ preventScroll: true });
        const enterOpts = {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
            composed: true,
        };
        el.dispatchEvent(new KeyboardEvent("keydown", enterOpts));
        el.dispatchEvent(new KeyboardEvent("keypress", enterOpts));
        el.dispatchEvent(new KeyboardEvent("keyup", enterOpts));
        console.log(`⌨️ ${logLabel}: Fallback กด Enter บน element ที่ focus`);
        return { ok: true, reason: "clicked_enter" };
    } catch {}

    return { ok: false, reason: "all_failed" };
}

/**
 * blur active element แบบกว้างกว่า blurActiveTextInput — รวม button / checkbox / div tabindex
 * เพราะหลังกด checkbox ใน dropdown "Non-Target Language" focus มักค้างที่ checkbox/label
 * ทำให้ Update ยัง disabled
 */
function blurAnyActiveElement() {
    try {
        const active = document.activeElement;
        if (
            active &&
            active !== document.body &&
            active !== document.documentElement &&
            typeof active.blur === "function"
        ) {
            active.blur();
            return true;
        }
    } catch {}
    return false;
}

/** ยิง Escape เพื่อปิด dropdown/popup ของ Label Studio ที่ค้างอยู่หลังเลือก Invalid reason */
function dispatchEscape() {
    const target = document.activeElement || document.body || document.documentElement;
    if (!target) return false;
    const opts = {
        key: "Escape",
        code: "Escape",
        keyCode: 27,
        which: 27,
        bubbles: true,
        cancelable: true,
    };
    try {
        target.dispatchEvent(new KeyboardEvent("keydown", opts));
        target.dispatchEvent(new KeyboardEvent("keyup", opts));
        return true;
    } catch {
        return false;
    }
}

/**
 * ยิง keyboard event ทั่วไป — ใช้สำหรับ hotkey ของ Label Studio เช่น 'w' = Verified
 * โดยจะส่งทั้ง keydown และ keyup ที่ document.body เพื่อให้ LSF handler รับได้
 */
function dispatchHotkey(key, keyCode) {
    const target = document.body || document.documentElement;
    if (!target) return false;
    const upper = String(key || "").toUpperCase();
    const kc = keyCode || (upper ? upper.charCodeAt(0) : 0);
    const opts = {
        key,
        code: upper.length === 1 ? `Key${upper}` : upper,
        keyCode: kc,
        which: kc,
        bubbles: true,
        cancelable: true,
    };
    try {
        target.dispatchEvent(new KeyboardEvent("keydown", opts));
        target.dispatchEvent(new KeyboardEvent("keyup", opts));
        return true;
    } catch (e) {
        console.warn("[DingTag] dispatchHotkey error:", e?.name, e?.message);
        return false;
    }
}

/**
 * หา element "Verified" ของ Label Studio
 * รูปแบบ HTML ที่คาดหวัง:
 *   <span ...>Verified<sup class="lsf-hint">[w]</sup></span>
 * จึงยึด .lsf-hint ที่มีข้อความ [w] เป็น anchor แล้วเช็คว่า parent มีคำว่า "verified"
 * ถ้าไม่เจอ จะ fallback ไปเช็ค .lsf-hint ทุกตัวที่ parent มี "verified"
 */
function findVerifiedHintButton() {
    const hints = document.querySelectorAll(".lsf-hint");
    let fallback = null;
    for (const hint of hints) {
        const hintText = (hint.textContent || "").trim().toLowerCase();
        const parent = hint.parentElement;
        if (!parent) continue;
        const parentText = (parent.textContent || "").trim().toLowerCase();
        if (!parentText.includes("verified")) continue;
        if (/\[\s*w\s*\]/i.test(hintText)) {
            return parent.closest('button, [role="button"], a, [tabindex]') || parent;
        }
        if (!fallback) {
            fallback = parent.closest('button, [role="button"], a, [tabindex]') || parent;
        }
    }
    return fallback;
}

/**
 * คลิก radio "Optimized" (Review Result) ก่อนกด Verified
 * โครงสร้าง: <input name="Optimized" class="ant-radio-input" type="radio">
 * หรือ label/span ที่มีข้อความ "Optimized"
 */
async function clickOptimizedRadio({ tries = 5, intervalMs = 300, runToken } = {}) {
    for (let i = 1; i <= tries; i++) {
        if (runToken != null && !isRunActive(runToken)) {
            return { ok: false, reason: "stale" };
        }
        // Strategy 1: หา input[name="Optimized"] โดยตรง
        let radio = document.querySelector('input.ant-radio-input[name="Optimized"]') ||
                    document.querySelector('input[type="radio"][name="Optimized"]');
        if (radio) {
            try { radio.scrollIntoView?.({ block: "center" }); } catch {}
            // คลิกที่ wrapper (.ant-radio) หรือ parent label เพื่อให้ Ant Design จัดการ state
            const wrapper = radio.closest(".ant-radio-wrapper") ||
                            radio.closest("label") ||
                            radio.parentElement;
            if (wrapper && wrapper !== radio) {
                try {
                    if (fireFullMouseClick(wrapper)) {
                        console.log(`✅ คลิก Optimized สำเร็จ (wrapper, ${i}/${tries})`);
                        return { ok: true };
                    }
                    wrapper.click();
                    console.log(`✅ คลิก Optimized สำเร็จ (wrapper.click, ${i}/${tries})`);
                    return { ok: true };
                } catch {}
            }
            try {
                radio.click();
                console.log(`✅ คลิก Optimized สำเร็จ (radio.click, ${i}/${tries})`);
                return { ok: true };
            } catch {}
        }

        // Strategy 2: หา element ที่มีข้อความ "Optimized"
        const btn = findClickableByContainsText(["optimized"]);
        if (btn) {
            try { btn.scrollIntoView?.({ block: "center" }); } catch {}
            if (fireFullMouseClick(btn)) {
                console.log(`✅ คลิก Optimized สำเร็จ (text match, ${i}/${tries})`);
                return { ok: true };
            }
            try {
                btn.click();
                console.log(`✅ คลิก Optimized สำเร็จ (text.click, ${i}/${tries})`);
                return { ok: true };
            } catch {}
        }
        await delay(intervalMs);
    }
    console.warn("⚠️ ไม่พบ radio Optimized");
    return { ok: false, reason: "not_found" };
}

/**
 * คลิก radio "Has Errors" (Review Result) 
 * โครงสร้าง: <input name="Has Errors" class="ant-radio-input" type="radio">
 */
async function clickHasErrorsRadio({ tries = 5, intervalMs = 300, runToken } = {}) {
    for (let i = 1; i <= tries; i++) {
        if (runToken != null && !isRunActive(runToken)) {
            return { ok: false, reason: "stale" };
        }
        let radio = document.querySelector('input.ant-radio-input[name="Has Errors"]') ||
                    document.querySelector('input[type="radio"][name="Has Errors"]');
        if (radio) {
            try { radio.scrollIntoView?.({ block: "center" }); } catch {}
            const wrapper = radio.closest(".ant-radio-wrapper") ||
                            radio.closest("label") ||
                            radio.parentElement;
            if (wrapper && wrapper !== radio) {
                try {
                    if (fireFullMouseClick(wrapper)) {
                        console.log(`✅ คลิก Has Errors สำเร็จ (wrapper, ${i}/${tries})`);
                        return { ok: true };
                    }
                    wrapper.click();
                    console.log(`✅ คลิก Has Errors สำเร็จ (wrapper.click, ${i}/${tries})`);
                    return { ok: true };
                } catch {}
            }
            try {
                radio.click();
                console.log(`✅ คลิก Has Errors สำเร็จ (radio.click, ${i}/${tries})`);
                return { ok: true };
            } catch {}
        }

        const btn = findClickableByContainsText(["has errors", "has error"]);
        if (btn) {
            try { btn.scrollIntoView?.({ block: "center" }); } catch {}
            if (fireFullMouseClick(btn)) {
                console.log(`✅ คลิก Has Errors สำเร็จ (text match, ${i}/${tries})`);
                return { ok: true };
            }
            try {
                btn.click();
                console.log(`✅ คลิก Has Errors สำเร็จ (text.click, ${i}/${tries})`);
                return { ok: true };
            } catch {}
        }
        await delay(intervalMs);
    }
    console.warn("⚠️ ไม่พบ radio Has Errors");
    return { ok: false, reason: "not_found" };
}

/**
 * คลิก radio "Verified" (Review Result / Ant Design)
 * โครงสร้าง: <input name="Verified" class="ant-radio-input" type="radio">
 */
async function clickVerifiedRadio({ tries = 5, intervalMs = 300, runToken } = {}) {
    for (let i = 1; i <= tries; i++) {
        if (runToken != null && !isRunActive(runToken)) {
            return { ok: false, reason: "stale" };
        }
        let radio =
            document.querySelector('input.ant-radio-input[name="Verified"]') ||
            document.querySelector('input[type="radio"][name="Verified"]');
        if (radio) {
            try {
                radio.scrollIntoView?.({ block: "center" });
            } catch {}
            const wrapper =
                radio.closest(".ant-radio-wrapper") || radio.closest("label") || radio.parentElement;
            if (wrapper && wrapper !== radio) {
                try {
                    if (fireFullMouseClick(wrapper)) {
                        console.log(`✅ คลิก Verified (radio) สำเร็จ (wrapper, ${i}/${tries})`);
                        return { ok: true };
                    }
                    wrapper.click();
                    console.log(`✅ คลิก Verified (radio) สำเร็จ (wrapper.click, ${i}/${tries})`);
                    return { ok: true };
                } catch {}
            }
            try {
                radio.click();
                console.log(`✅ คลิก Verified (radio) สำเร็จ (radio.click, ${i}/${tries})`);
                return { ok: true };
            } catch {}
        }

        const btn = findClickableByContainsText(["verified"]);
        if (btn && btn.closest && btn.closest(".ant-radio-wrapper, label.ant-radio-wrapper")) {
            try {
                btn.scrollIntoView?.({ block: "center" });
            } catch {}
            if (fireFullMouseClick(btn)) {
                console.log(`✅ คลิก Verified (radio) สำเร็จ (ant label, ${i}/${tries})`);
                return { ok: true };
            }
            try {
                btn.click();
                console.log(`✅ คลิก Verified (radio) สำเร็จ (ant label .click, ${i}/${tries})`);
                return { ok: true };
            } catch {}
        }
        await delay(intervalMs);
    }
    console.warn("⚠️ ไม่พบ radio Verified (Ant)");
    return { ok: false, reason: "not_found" };
}

/**
 * คลิกปุ่ม Verified แบบยืดหยุ่น:
 *  1) ลองหา .lsf-hint [w] แล้ว full-mouse-click parent (มี fallback เป็น .click())
 *  2) ถ้ายังไม่เจอ → findClickableByContainsText(["verified"])
 *  3) ถ้ายังไม่ได้อีก → fallback dispatch hotkey 'w'
 */
async function clickVerifiedButton({ tries = 6, intervalMs = 350, runToken } = {}) {
    for (let i = 1; i <= tries; i++) {
        if (runToken != null && !isRunActive(runToken)) {
            return { ok: false, reason: "stale" };
        }
        let btn = findVerifiedHintButton();
        if (!btn) btn = findClickableByContainsText(["verified"]);
        if (btn) {
            try {
                btn.scrollIntoView?.({ block: "center", inline: "center" });
            } catch {}
            await delay(100);
            if (fireFullMouseClick(btn)) {
                console.log(`✅ คลิก Verified สำเร็จ (full-mouse-click, ${i}/${tries})`);
                return { ok: true, reason: "clicked_dom" };
            }
            try {
                btn.click();
                console.log(`✅ คลิก Verified สำเร็จ (.click(), ${i}/${tries})`);
                return { ok: true, reason: "clicked_dom" };
            } catch (e) {
                console.warn("[DingTag] click Verified error:", e?.name, e?.message);
            }
        }
        await delay(intervalMs);
    }
    if (dispatchHotkey("w", 87)) {
        console.log("⌨️ Fallback: ส่งคีย์ 'w' (hotkey Verified)");
        return { ok: true, reason: "hotkey_w" };
    }
    return { ok: false, reason: "not_found" };
}

function refocusClassification() {
    if (blurActiveTextInput()) {
        console.log("👀 blur textarea/input ก่อน refocus Classification");
    }
    const row = findClassificationResultRow();
    if (row && safeClickEl(row)) {
        console.log("🖱️ refocus: คลิก .result-item (Classification: Valid)");
        return true;
    }
    const card = findAnnotationCard();
    if (card && safeClickEl(card)) {
        console.log("🖱️ refocus: คลิก .lsf-annotation-items__item card");
        return true;
    }
    return false;
}

/** หา textarea ของ Annotation Result (Label Studio LSF) แบบยืดหยุ่น */
function findAnnotationResultTextarea() {
    return (
        document.querySelector('textarea[name="Annotation Result"]') ||
        document.querySelector('textarea[name*="Annotation"]') ||
        document.querySelector(".lsf-textarea-tag textarea") ||
        document.querySelector("textarea")
    );
}

/**
 * Pre-Update sequence สำหรับ Non-Target flow โดยเฉพาะ
 * ลำดับ (มี delay ระหว่างทุกขั้น):
 *  1) คลิก Classification row แบบจำลองคลิกจริง (full mouse events)
 *  2) คลิก Text Area (Annotation Result) + focus
 *  3) blur active element ออก
 *  4) กด Escape ปิด popup/dropdown ที่อาจค้าง
 * ใช้แก้เคส "There was an error updating your Annotation" ที่เกิดเมื่อกด Update
 * ก่อน Label Studio commit state ครบ
 */
async function prepareForNonTargetUpdate({ runToken } = {}) {
    if (runToken != null && !isRunActive(runToken)) return false;
    let didSomething = false;

    // (1) คลิก Classification row แบบจริง
    const row = findClassificationResultRow();
    if (row && fireFullMouseClick(row)) {
        console.log("🖱️ pre-update[1/4]: คลิก Classification row (จำลองจริง)");
        didSomething = true;
    } else {
        console.warn("⚠️ pre-update[1/4]: ไม่พบ Classification row");
    }
    await delay(400);
    if (runToken != null && !isRunActive(runToken)) return didSomething;

    // (2) คลิก Text area (Annotation Result) + focus
    const ta = findAnnotationResultTextarea();
    if (ta) {
        fireFullMouseClick(ta);
        try {
            ta.focus();
        } catch {}
        console.log("📝 pre-update[2/4]: คลิก + focus textarea Annotation Result");
        didSomething = true;
    } else {
        console.warn("⚠️ pre-update[2/4]: ไม่พบ textarea Annotation Result");
    }
    await delay(350);
    if (runToken != null && !isRunActive(runToken)) return didSomething;

    // (3) blur active element ออก
    if (blurAnyActiveElement()) {
        console.log("👀 pre-update[3/4]: blur active element");
        didSomething = true;
    }
    await delay(250);
    if (runToken != null && !isRunActive(runToken)) return didSomething;

    // (4) Escape ปิด popup/dropdown ที่อาจค้าง
    if (dispatchEscape()) {
        console.log("⎋ pre-update[4/4]: ส่ง Escape");
        didSomething = true;
    }
    await delay(400);

    return didSomething;
}

/**
 * Sequence "ปลดล็อก" ปุ่ม Update — ใช้หลังกดเลือก Invalid reason (เช่น Data Missing)
 * เพราะแค่ refocusClassification() ตัวเดียวไม่พอ บางครั้งเกิดเคส:
 *   - dropdown เลือก reason ยังเปิดค้าง → คลิก Update ไม่โดน
 *   - focus อยู่ที่ checkbox/label → React ยังไม่ commit state
 *   - ใช้แค่ el.click() ไม่ trigger handler ที่ฟัง mousedown
 *
 * Steps:
 *  1) Escape ปิด dropdown/menu ที่ยังเปิด
 *  2) blur active element (ไม่จำกัดแค่ textarea/input)
 *  3) full-mouse-click ที่ annotation card (parent ใหญ่)
 *  4) full-mouse-click ที่ Classification row
 */
async function nudgeUnlockUpdate({ runToken } = {}) {
    if (runToken != null && !isRunActive(runToken)) return false;
    let nudged = false;

    if (dispatchEscape()) {
        console.log("⎋ nudge: ส่ง Escape ปิด dropdown/menu");
        nudged = true;
    }
    if (blurAnyActiveElement()) {
        console.log("👀 nudge: blur active element");
        nudged = true;
    }
    await delay(160);
    if (runToken != null && !isRunActive(runToken)) return nudged;

    const card = findAnnotationCard();
    if (card && fireFullMouseClick(card)) {
        console.log("🖱️ nudge: full-click annotation card");
        nudged = true;
    }
    await delay(140);
    if (runToken != null && !isRunActive(runToken)) return nudged;

    const row = findClassificationResultRow();
    if (row && fireFullMouseClick(row)) {
        console.log("🖱️ nudge: full-click Classification row");
        nudged = true;
    }
    await delay(180);
    return nudged;
}

/** งานที่เคย Shift+↓ skip ไว้ — แสดง "Was skipped" + ปุ่ม Cancel skip แทน Update */
function isTaskWasSkipped() {
    const info = document.querySelector(".lsf-controls__skipped-info");
    if (info) {
        const text = (info.innerText || info.textContent || "").trim().toLowerCase();
        if (text.includes("was skipped") || text.includes("skipped")) return true;
    }
    const controls = document.querySelector(".lsf-controls");
    if (controls) {
        const t = (controls.innerText || controls.textContent || "").trim().toLowerCase();
        if (t.includes("was skipped")) return true;
    }
    return false;
}

function findCancelSkipButton() {
    const byAria = document.querySelector('button[aria-label="cancel-skip"]');
    if (byAria) return byAria;
    const controls = document.querySelector(".lsf-controls");
    const scope = controls || document;
    const buttons = scope.querySelectorAll("button");
    for (const btn of buttons) {
        const text = (btn.innerText || btn.textContent || "").trim().toLowerCase();
        if (text === "cancel skip" || text.includes("cancel skip")) return btn;
    }
    return null;
}

/**
 * ถ้า task อยู่สถานะ Was skipped → กด Cancel skip เพื่อให้กลับมาแก้/กด Update ได้
 */
async function ensureCancelSkipIfWasSkipped({ runToken } = {}) {
    if (!isTaskWasSkipped() && !findCancelSkipButton()) {
        return { ok: true, reason: "not_skipped" };
    }
    const btn = findCancelSkipButton();
    if (!btn) {
        console.warn("[DingTag] Was skipped แต่ไม่เจอปุ่ม Cancel skip");
        return { ok: false, reason: "cancel_skip_not_found" };
    }
    if (runToken != null && !isRunActive(runToken)) {
        return { ok: false, reason: "stale" };
    }
    console.log("[DingTag] task Was skipped — กด Cancel skip ก่อน flow ปกติ");
    setStatus("Was skipped → กด Cancel skip...");
    const rcRes = await robustClick(btn, {
        tries: 3,
        intervalMs: 220,
        runToken,
        logLabel: "Cancel skip",
    });
    if (rcRes.reason === "stale") return { ok: false, reason: "stale" };
    if (!rcRes.ok) {
        console.warn("[DingTag] Cancel skip ไม่สำเร็จ:", rcRes.reason);
        return { ok: false, reason: rcRes.reason || "click_failed" };
    }
    markPostCancelSkipWindow("bot_cancel_skip");
    pauseWaveformMedia();
    await delay(500);
    if (runToken != null && !isRunActive(runToken)) {
        return { ok: false, reason: "stale" };
    }

    const postReady = await waitForPostCancelSkipReady(runToken, 3500);
    if (postReady.reason === "stale") return { ok: false, reason: "stale" };

    const classState = getClassificationSidebarState();
    if (postReady.mode === "classified") {
        console.log(
            `[DingTag] Cancel skip แล้ว — มี Classification ${postReady.classificationValue} (ไม่ลากทับ)`
        );
        return {
            ok: true,
            reason: "cancel_skip_has_classification",
            classificationValue: postReady.classificationValue,
            classState,
        };
    }
    if (postReady.mode === "has_region") {
        console.log("[DingTag] Cancel skip แล้ว — มี region บน waveform อยู่แล้ว (ไม่ลากทับ)");
        return { ok: true, reason: "cancel_skip_has_region", classState };
    }
    if (postReady.mode === "empty") {
        console.log(
            "[DingTag] Cancel skip แล้ว — UI ว่างจริง → waveform recovery"
        );
        return { ok: true, reason: "cancel_skip_empty_annotation", classState };
    }

    const upd = findSubmitUpdateButton();
    console.log(
        upd
            ? "✅ Cancel skip แล้ว — เจอปุ่ม Update"
            : "✅ Cancel skip แล้ว — รอ DOM ต่อ"
    );
    return { ok: true, reason: "cancel_skip_clicked", classState };
}

function findSubmitUpdateButton() {
    const candidates = document.querySelectorAll(
        'button[name="submit"][aria-label="submit"]'
    );
    for (const btn of candidates) {
        const text = (btn.innerText || btn.textContent || "").trim().toLowerCase();
        if (text.includes("update")) return btn;
    }
    const buttons = document.querySelectorAll('button, [role="button"]');
    for (const btn of buttons) {
        const text = (btn.innerText || btn.textContent || "").trim();
        if (text === "Update") return btn;
    }
    return null;
}

function isUpdateButtonClickable(btn) {
    if (!btn) return false;
    if (btn.disabled) return false;
    if (btn.hasAttribute && btn.hasAttribute("disabled")) return false;
    if (btn.getAttribute && btn.getAttribute("aria-disabled") === "true") return false;
    return true;
}

/** QC: ปุ่ม Accept / Fix+Accept — แยกด้วยข้อความใน span (aria-label เดียวกัน) */
function findAcceptAnnotationButton(kind) {
    const buttons = document.querySelectorAll('button[aria-label="accept-annotation"]');
    for (const btn of buttons) {
        const text = (btn.innerText || btn.textContent || "").trim();
        if (kind === "accept") {
            if (text === "Accept") return btn;
        } else if (kind === "fix_accept") {
            if (/fix/i.test(text) && /accept/i.test(text)) return btn;
        }
    }
    return null;
}

/** QC: ลำดับ Update → Fix+Accept → Accept (เฉพาะปุ่มที่กดได้) */
function findQcSubmitCandidate() {
    const upd = findSubmitUpdateButton();
    if (isUpdateButtonClickable(upd)) return { btn: upd, kind: "update" };
    const fixAcc = findAcceptAnnotationButton("fix_accept");
    if (isUpdateButtonClickable(fixAcc)) return { btn: fixAcc, kind: "fix_accept" };
    const acc = findAcceptAnnotationButton("accept");
    if (isUpdateButtonClickable(acc)) return { btn: acc, kind: "accept" };
    return null;
}

function qcSubmitKindLabel(kind) {
    if (kind === "fix_accept") return "Fix+Accept";
    if (kind === "accept") return "Accept";
    return "Update";
}

/**
 * QC โหมด: เช็คและกด Update / Fix+Accept / Accept (ลำดับเดียวกับ findQcSubmitCandidate)
 */
async function clickQcSubmitWithEnabledCheck({
    runToken,
    maxTries = 2,
    retryDelayMs = 1000,
    useNudgeOnRetry = true,
    skipBlurBeforeCheck = false,
    pressEscBeforeClick = false,
    escBeforeClickDelayMs = 200,
} = {}) {
    let cancelSkipTried = false;
    for (let i = 1; i <= maxTries; i++) {
        if (runToken != null && !isRunActive(runToken)) {
            return { ok: false, reason: "stale" };
        }

        if (!cancelSkipTried && (isTaskWasSkipped() || findCancelSkipButton())) {
            cancelSkipTried = true;
            const csRes = await ensureCancelSkipIfWasSkipped({ runToken });
            if (csRes.reason === "stale") return { ok: false, reason: "stale" };
            if (csRes.reason === "cancel_skip_clicked") {
                continue;
            }
        }

        if (!skipBlurBeforeCheck && blurActiveTextInput()) {
            console.log("👀 blur textarea/input ก่อนเช็คปุ่มส่งงาน (QC)");
        }

        if (pressEscBeforeClick) {
            if (dispatchEscape()) {
                console.log(`⎋ ส่ง Escape ก่อนกดส่งงาน QC (ครั้งที่ ${i}/${maxTries})`);
            }
            if (escBeforeClickDelayMs > 0) {
                await delay(escBeforeClickDelayMs);
                if (runToken != null && !isRunActive(runToken)) {
                    return { ok: false, reason: "stale" };
                }
            }
        }

        const candidate = findQcSubmitCandidate();
        if (candidate) {
            const label = qcSubmitKindLabel(candidate.kind);
            const rcRes = await robustClick(candidate.btn, {
                tries: 2,
                intervalMs: 150,
                runToken,
                logLabel: `${label} (${i}/${maxTries})`,
            });
            if (rcRes.reason === "stale") {
                return { ok: false, reason: "stale" };
            }
            if (rcRes.ok) {
                return { ok: true, reason: rcRes.reason, submitKind: candidate.kind };
            }
            console.warn(`⚠️ robustClick ${label} ล้มเหลว (${i}/${maxTries}): ${rcRes.reason}`);
        } else {
            console.warn(`⚠️ QC: ไม่เจอปุ่ม Update/Accept/Fix+Accept ที่กดได้ (ครั้งที่ ${i}/${maxTries})`);
        }

        if (i < maxTries) {
            if (useNudgeOnRetry) {
                const nudged = await nudgeUnlockUpdate({ runToken });
                if (runToken != null && !isRunActive(runToken)) {
                    return { ok: false, reason: "stale" };
                }
                if (nudged) {
                    console.log(`🧰 nudge unlock (QC) — รอ ${retryDelayMs}ms แล้วลองใหม่`);
                } else {
                    console.warn("⚠️ nudge (QC) ไม่เจอ element — ลองรอแล้วเช็คอีกครั้ง");
                }
            } else {
                console.log(`⏳ ข้าม nudge (QC) — รอ ${retryDelayMs}ms แล้วลองใหม่`);
            }
            await delay(retryDelayMs);
        }
    }
    console.warn("❌ QC: ปุ่มส่งงานยังกดไม่ได้ — ข้าม");
    return { ok: false, reason: "disabled_after_retries" };
}

/**
 * ลำดับการทำงาน:
 * 1) เช็คปุ่ม Update — ถ้ากดได้ (ไม่ disabled) ก็กดเลย จบ
 * 2) ถ้า disabled => (ถ้า useNudgeOnRetry=true) กด nudgeUnlockUpdate, ไม่งั้นแค่หน่วง
 * 3) เช็ค Update อีกครั้ง (รอบถัดไป) — ถ้ายังกดไม่ได้ครบ maxTries ถึงข้าม
 *
 * Options:
 *  - useNudgeOnRetry: true (default) → ใช้ nudgeUnlockUpdate ก่อนลอง Update รอบถัดไป
 *                      false → ข้าม nudge, แค่หน่วง retryDelayMs แล้วลอง Update ใหม่ตรงๆ
 *  - skipBlurBeforeCheck: true → ข้าม blurActiveTextInput() ก่อนเช็คปุ่ม Update
 *                        false (default) → blur textarea/input ก่อนเช็คปุ่ม
 *  - pressEscBeforeClick: true → กด Escape + delay สั้นๆ ก่อนกด Update "ทุกรอบ" (รวม retry)
 *                         false (default) → ไม่ส่ง Escape
 *  - escBeforeClickDelayMs: หน่วงหลังกด Escape (default 200ms)
 *
 * หมายเหตุ: ตั้งแต่เวอร์ชันนี้ใช้ robustClick() แทน pyautogui Physical click ทั้งหมด
 *   เพราะ robustClick ทำงานบน viewport coordinate ใน Chrome → cross-machine 100%
 *   (ไม่ขึ้นกับ DPI/screen size/multi-monitor) และ dispatch event chain เต็ม
 *   (hover/focus/pointer/mouse/click + Enter fallback) ครอบคลุมเคส React ของ LS
 */
async function clickUpdateWithEnabledCheck({
    runToken,
    maxTries = 2,
    retryDelayMs = 1000,
    useNudgeOnRetry = true,
    skipBlurBeforeCheck = false,
    pressEscBeforeClick = false,
    escBeforeClickDelayMs = 200,
} = {}) {
    if (isQcMode()) {
        return clickQcSubmitWithEnabledCheck({
            runToken,
            maxTries,
            retryDelayMs,
            useNudgeOnRetry,
            skipBlurBeforeCheck,
            pressEscBeforeClick,
            escBeforeClickDelayMs,
        });
    }
    let cancelSkipTried = false;
    for (let i = 1; i <= maxTries; i++) {
        if (runToken != null && !isRunActive(runToken)) {
            return { ok: false, reason: "stale" };
        }

        if (!cancelSkipTried && (isTaskWasSkipped() || findCancelSkipButton())) {
            cancelSkipTried = true;
            const csRes = await ensureCancelSkipIfWasSkipped({ runToken });
            if (csRes.reason === "stale") return { ok: false, reason: "stale" };
            if (csRes.reason === "cancel_skip_clicked") {
                continue;
            }
        }

        if (!skipBlurBeforeCheck && blurActiveTextInput()) {
            console.log("👀 blur textarea/input ก่อนเช็คปุ่ม Update");
        }

        if (pressEscBeforeClick) {
            if (dispatchEscape()) {
                console.log(`⎋ ส่ง Escape ก่อนกด Update (ครั้งที่ ${i}/${maxTries})`);
            }
            if (escBeforeClickDelayMs > 0) {
                await delay(escBeforeClickDelayMs);
                if (runToken != null && !isRunActive(runToken)) {
                    return { ok: false, reason: "stale" };
                }
            }
        }

        const btn = findSubmitUpdateButton();
        if (isUpdateButtonClickable(btn)) {
            const rcRes = await robustClick(btn, {
                tries: 2,
                intervalMs: 150,
                runToken,
                logLabel: `Update (${i}/${maxTries})`,
            });
            if (rcRes.reason === "stale") {
                return { ok: false, reason: "stale" };
            }
            if (rcRes.ok) {
                return { ok: true, reason: rcRes.reason };
            }
            console.warn(`⚠️ robustClick Update ล้มเหลว (${i}/${maxTries}): ${rcRes.reason}`);
        } else {
            const why = !btn ? "ไม่เจอปุ่ม" : "ปุ่มยัง disabled";
            console.warn(`⚠️ Update ${why} (ครั้งที่ ${i}/${maxTries})`);
        }

        if (i < maxTries) {
            if (useNudgeOnRetry) {
                const nudged = await nudgeUnlockUpdate({ runToken });
                if (runToken != null && !isRunActive(runToken)) {
                    return { ok: false, reason: "stale" };
                }
                if (nudged) {
                    console.log(`🧰 nudge Update unlock เสร็จ — รอ ${retryDelayMs}ms แล้วลองใหม่`);
                } else {
                    console.warn("⚠️ nudge Update ไม่เจอ element ใดๆ เลย — ลองรอแล้วเช็คอีกครั้ง");
                }
            } else {
                console.log(`⏳ ข้าม nudge — รอ ${retryDelayMs}ms แล้วลองกด Update ใหม่`);
            }
            await delay(retryDelayMs);
        }
    }
    console.warn("❌ ปุ่ม Update ยัง disabled — ข้ามการกด Update");
    return { ok: false, reason: "disabled_after_retries" };
}

/**
 * ตรวจหา "Quality Check Failed" popup (lsf-modal-dm) หลังกด Update — ถ้าเจอให้ปิดให้เรียบร้อย
 * โดยคลิก "Ignore & Submit" (data-testid=dialog-ok-button) ก่อนจะส่ง Shift+↓ ไป task ถัดไป
 *
 * DOM โครงสร้างที่รู้:
 *   <div class="lsf-modal-dm__content">
 *     <div class="lsf-modal-dm__header">
 *       <div class="lsf-modal-dm__title">Quality Check Failed</div>
 *     </div>
 *     <div class="lsf-modal-dm__body">Annotation has N error(s)...</div>
 *     <div class="lsf-modal-dm__footer">
 *       <button data-testid="dialog-cancel-button" aria-label="Cancel">Go Back & Fix</button>
 *       <button data-testid="dialog-ok-button" aria-label="Ignore & Submit">Ignore & Submit</button>
 *     </div>
 *   </div>
 *
 * พฤติกรรม:
 *  1) Poll หา .lsf-modal-dm__title ที่มีข้อความ "Quality Check Failed" ในหน้าต่างเวลา detectTimeoutMs
 *  2) ไม่เจอจริงๆ → return { found: false } (caller ส่ง Shift+↓ ได้ทันที)
 *  3) เจอ → คลิก dialog-ok-button (Ignore & Submit) → รอ popup หาย
 *  4) คลิกไม่ติด → fallback Escape
 *
 * หมายเหตุ: เราเลือกคลิก "Ignore & Submit" (ไม่ใช่ "Go Back & Fix") เพราะ:
 *  - Auto-pilot ต้องการ commit งานแล้วเดินต่อ
 *  - สอดคล้องกับ clickPopupAndVerify(["Ignore & Submit"], ...) เดิมในโค้ด
 *  - "Go Back & Fix" จะค้างที่ task เดิมแบบไม่มี classification ทำให้ stuck
 *
 * @param {object} opts
 *   - runToken: ใช้เช็คว่า run ยัง active อยู่
 *   - detectTimeoutMs: เวลา poll หา popup (default 1500ms)
 *   - closeTimeoutMs: เวลารอ popup ปิดสนิทหลังคลิก (default 3000ms)
 * @returns {Promise<{ found: boolean, closed: boolean }>}
 */
async function closeQualityCheckFailedIfPresent({
    runToken,
    detectTimeoutMs = 1500,
    closeTimeoutMs = 3000,
} = {}) {
    if (runToken != null && !isRunActive(runToken)) return { found: false, closed: false };

    const QCF_REGEX = /quality\s*check\s*failed/i;

    // หา QCF modal: title element + container
    const findQcfModal = () => {
        // (a) primary: ใช้ class .lsf-modal-dm__title ที่มี text "Quality Check Failed"
        const titles = document.querySelectorAll(".lsf-modal-dm__title");
        for (const titleEl of titles) {
            const t = (titleEl.textContent || "").trim();
            if (QCF_REGEX.test(t)) {
                const container =
                    titleEl.closest(".lsf-modal-dm__content") ||
                    titleEl.closest('[role="dialog"], [role="alertdialog"]') ||
                    titleEl.parentElement;
                return container || titleEl;
            }
        }
        // (b) fallback: เผื่อ class เปลี่ยน — หา text "Quality Check Failed" ใน node สั้นๆ ทั่วหน้า
        const candidates = document.querySelectorAll(
            'div, span, h1, h2, h3, h4, h5, p, [role="dialog"], [role="alertdialog"]'
        );
        for (const el of candidates) {
            const raw = (el.textContent || "").trim();
            if (!raw || raw.length > 200) continue;
            if (QCF_REGEX.test(raw)) {
                const container =
                    el.closest(".lsf-modal-dm__content") ||
                    el.closest('[role="dialog"], [role="alertdialog"]') ||
                    el;
                return container;
            }
        }
        return null;
    };

    // หา "Ignore & Submit" button ใน modal (ตามลำดับความน่าเชื่อถือ)
    const findIgnoreSubmitBtn = (modal) => {
        if (!modal) return null;
        const selectors = [
            '[data-testid="dialog-ok-button"]',
            'button[aria-label="Ignore & Submit"]',
            'button[aria-label*="Ignore" i]',
        ];
        for (const sel of selectors) {
            try {
                const btn = modal.querySelector(sel);
                if (btn && !btn.disabled && btn.offsetParent !== null) return btn;
            } catch {}
        }
        // text fallback: ปุ่มที่ text มีคำว่า ignore + submit
        const buttons = modal.querySelectorAll('button, [role="button"]');
        for (const btn of buttons) {
            const t = (btn.innerText || btn.textContent || "").trim().toLowerCase();
            if (t === "ignore & submit" || (t.includes("ignore") && t.includes("submit"))) {
                return btn;
            }
        }
        return null;
    };

    const sendEscape = () => {
        const target = document.body || document.documentElement;
        if (!target) return false;
        const opts = {
            key: "Escape",
            code: "Escape",
            keyCode: 27,
            which: 27,
            bubbles: true,
            cancelable: true,
        };
        try {
            target.dispatchEvent(new KeyboardEvent("keydown", opts));
            target.dispatchEvent(new KeyboardEvent("keyup", opts));
            return true;
        } catch {
            return false;
        }
    };

    // (1) Poll หา QCF modal
    const detectStart = Date.now();
    let modal = findQcfModal();
    while (!modal && Date.now() - detectStart < detectTimeoutMs) {
        await delay(150);
        if (runToken != null && !isRunActive(runToken)) return { found: false, closed: false };
        modal = findQcfModal();
    }

    if (!modal) {
        console.log("🔍 Quality Check Failed: ไม่เจอ popup — พร้อมส่ง Shift+↓ ได้เลย");
        return { found: false, closed: false };
    }

    console.warn("⚠️ ตรวจพบ Quality Check Failed — กำลังคลิก 'Ignore & Submit'");
    setStatus("พบ Quality Check Failed — คลิก Ignore & Submit");

    // (2) คลิก Ignore & Submit
    const btn = findIgnoreSubmitBtn(modal);
    if (btn) {
        try {
            btn.scrollIntoView?.({ block: "center", inline: "center" });
        } catch {}
        try {
            console.log("🖱️ คลิก 'Ignore & Submit' ใน Quality Check Failed");
            btn.click();
            const parentBtn = btn.closest?.('button, [role="button"]');
            if (parentBtn && parentBtn !== btn) parentBtn.click();
        } catch (e) {
            console.warn("[DingTag] คลิก Ignore & Submit ล้มเหลว:", e?.name, e?.message);
        }
    } else {
        console.warn(
            "⚠️ ไม่พบปุ่ม 'Ignore & Submit' ใน QCF modal — ใช้ Escape แทน (อาจปิดไม่ลง)"
        );
        sendEscape();
    }

    // (3) รอ popup หาย
    const closeStart = Date.now();
    while (Date.now() - closeStart < closeTimeoutMs) {
        await delay(200);
        if (runToken != null && !isRunActive(runToken)) return { found: true, closed: false };
        if (!findQcfModal()) {
            console.log("✅ Quality Check Failed ปิดสำเร็จ (Ignore & Submit)");
            setStatus("Quality Check Failed: Ignore & Submit แล้ว — เตรียมไป task ถัดไป");
            return { found: true, closed: true };
        }
    }

    // (4) ปิดไม่ลง → ลองคลิก Ignore & Submit อีกครั้ง + Escape fallback
    console.warn("⚠️ Quality Check Failed ยังไม่หายหลังหมดเวลา — ลอง click ซ้ำ + Escape");
    const btnRetry = findIgnoreSubmitBtn(findQcfModal());
    if (btnRetry) {
        try {
            btnRetry.click();
        } catch {}
    }
    await delay(400);
    sendEscape();
    await delay(500);

    const stillThere = !!findQcfModal();
    if (!stillThere) {
        console.log("✅ Quality Check Failed ปิดได้หลัง retry");
        setStatus("Quality Check Failed ปิดแล้ว — เตรียมไป task ถัดไป");
    } else {
        console.warn("⚠️ Quality Check Failed ยังค้าง — ส่ง Shift+↓ ต่อ (อาจถูก block)");
        setStatus("Quality Check Failed ยังค้างอยู่ — ส่ง Shift+↓ ต่อ");
    }
    return { found: true, closed: !stillThere };
}

async function clickPopupAndVerify(keywords, { tries = 6, intervalMs = 450, waitDisappearMs = 1800 } = {}) {
    // Goal: ensure the popup button is actually clicked and disappears.
    for (let i = 1; i <= tries; i++) {
        if (!isAutoPilotOn) return { ok: false, reason: "autopilot_off" };

        const el = findClickableByExactText(keywords);
        if (!el) {
            // Not visible => consider it already gone
            return { ok: true, reason: "not_found" };
        }

        try {
            el.scrollIntoView?.({ block: "center", inline: "center" });
        } catch {}

        try {
            console.log(`[DingTag] Popup click attempt ${i}/${tries}:`, keywords.join("/"));
            el.click();
            const parentBtn = el.closest?.('button, [role="button"]');
            if (parentBtn && parentBtn !== el) parentBtn.click();
        } catch (e) {
            console.warn("[DingTag] popup click error:", e?.name, e?.message);
        }

        // Wait for disappearance
        const start = Date.now();
        while (Date.now() - start < waitDisappearMs) {
            if (!isAutoPilotOn) return { ok: false, reason: "autopilot_off" };
            if (!isKeywordPresentOnPage(keywords)) return { ok: true, reason: "disappeared" };
            await delay(Math.min(250, intervalMs));
        }

        await delay(intervalMs);
    }
    return { ok: false, reason: "still_present" };
}

const delay = (ms) =>
    new Promise((resolve) => {
        const t = setTimeout(resolve, ms);
        activeTimeouts.push(t);
    });

/** รอให้ครบ minElapsedBeforeAcceptMs นับจาก cycleStartAt ก่อนกด Accept (งานนานอยู่แล้วจะไม่รอเพิ่ม) */
async function ensureMinElapsedBeforeAccept(runToken, cycleStartAt) {
    const minMs = minElapsedBeforeAcceptMs;
    if (!minMs || minMs <= 0) return;

    let remaining = minMs - (Date.now() - cycleStartAt);
    while (remaining > 0) {
        if (!isRunActive(runToken)) return;
        setStatus(`รอเวลาขั้นต่ำก่อน Accept อีก ~${(remaining / 1000).toFixed(1)} วิ`);
        const chunk = Math.min(remaining, 400);
        await delay(chunk);
        remaining = minMs - (Date.now() - cycleStartAt);
    }
}

async function waitForSelector(selector, { timeoutMs = 8000, intervalMs = 200 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (!isAutoPilotOn) return null;
        const el = document.querySelector(selector);
        if (el) return el;
        await delay(intervalMs);
    }
    return null;
}

async function runInvalidReasonAcceptFlow(
    reasonText = "invalid flow",
    {
        checkboxName,
        menuNeedles,
        logLabel = "reason",
        runToken,
        cycleStartAt,
        // ปรับพฤติกรรมก่อน/ระหว่างกด Update ต่อ flow ได้
        // - skipNudgeBeforeUpdate: true → ข้าม nudge ก่อนกด Update ครั้งแรก
        // - preUpdateDelayMs: เวลาที่หน่วงก่อนกด Update ครั้งแรก
        // - useNudgeOnUpdateRetry: false → ระหว่าง retry Update ก็ไม่ nudge เช่นกัน (แค่หน่วงรอ)
        // - updateMaxTries / updateRetryDelayMs: ตั้งจำนวนครั้งและช่วงเวลา retry Update
        // - updateSkipBlurBeforeCheck: true → ข้าม blurActiveTextInput() ก่อนเช็คปุ่ม Update
        // - useNonTargetPreUpdateSequence: true → ใช้ลำดับเฉพาะของ Non-Target
        //    (คลิก Classification → คลิก Text area → blur → Escape) แทน nudge/skip-nudge
        // - updatePressEscBeforeClick: true → กด Escape ก่อนกด Update ทุกครั้ง (รวม retry)
        // - preCheckboxDelayMs: หน่วงก่อนติ๊ก checkbox (หลังเปิดเมนูเลือก reason)
        //
        // หมายเหตุ: ตั้งแต่เวอร์ชันนี้ใช้ robustClick() แทน pyautogui Physical click
        //   ทั้งการกด Update และติ๊ก checkbox — cross-machine ทำงานเหมือนกันทุกเครื่อง
        skipNudgeBeforeUpdate = false,
        preUpdateDelayMs = 250,
        useNudgeOnUpdateRetry = true,
        updateMaxTries = 4,
        updateRetryDelayMs = 800,
        updateSkipBlurBeforeCheck = false,
        useNonTargetPreUpdateSequence = false,
        updatePressEscBeforeClick = false,
        updateEscBeforeClickDelayMs = 200,
        preCheckboxDelayMs = 0,
        /** ถ้ามี — ก่อนกด Update จะเช็คว่า .lsf-current-task__task-id ยังตรงกับ task นี้; หลัง Update สำเร็จจะ add เข้า processedTaskIds */
        expectedTaskId = "",
    }
) {
    console.log(`🚩 ${reasonText}: Invalid -> ${logLabel} -> Classification -> Update`);

    if (forceClickByText(["Invalid"]) || (await clickByContainsTextAndVerify(["invalid"])).ok) {
        console.log("✅ กด Invalid สำเร็จ");
    } else {
        console.warn("⚠️ ไม่พบปุ่ม Invalid");
        setStatus("ไม่พบปุ่ม Invalid");
        return;
    }

    await delay(300);
    if (menuNeedles && menuNeedles.length) {
        await clickByContainsTextAndVerify(menuNeedles, { tries: 10, intervalMs: 350 });
    }

    if (preCheckboxDelayMs > 0) {
        console.log(
            `⏳ invalid flow (${logLabel}): หน่วง ${preCheckboxDelayMs}ms หลังเปิดเมนู ก่อนติ๊ก checkbox`
        );
        setStatus(
            `Invalid flow (${logLabel}): รอ ${(preCheckboxDelayMs / 1000).toFixed(1)} วิ ก่อนติ๊ก checkbox`
        );
        await delay(preCheckboxDelayMs);
        if (runToken != null && !isRunActive(runToken)) return;
    }

    const cbRes = await clickAntCheckboxByNameAndVerify(checkboxName, {
        tries: 12,
        intervalMs: 350,
        logLabel,
    });
    if (!cbRes.ok) {
        console.warn(`⚠️ ติ๊ก ${logLabel} ไม่สำเร็จ:`, cbRes.reason);
        setStatus(`Invalid flow: ติ๊ก ${logLabel} ไม่สำเร็จ`);
        return;
    }
    console.log(`✅ ติ๊ก ${logLabel} สำเร็จ (${cbRes.reason})`);

    await delay(350);
    if (runToken != null && cycleStartAt != null) {
        await ensureMinElapsedBeforeAccept(runToken, cycleStartAt);
        if (!isRunActive(runToken)) return;
    }

    if (useNonTargetPreUpdateSequence) {
        // เคส Non-Target: ลำดับเฉพาะ — คลิก Classification (จริง) → คลิก Text area → blur → Escape
        console.log(
            `🛠️ invalid flow (${logLabel}): pre-Update sequence ` +
                `(Classification → Text area → blur → Escape) ก่อนกด Update`
        );
        setStatus(`Invalid flow (${logLabel}): เตรียม Update (Classification → Textarea → blur → Esc)`);
        await prepareForNonTargetUpdate({ runToken });
        if (runToken != null && !isRunActive(runToken)) return;
    } else if (skipNudgeBeforeUpdate) {
        // ข้าม nudge แค่หน่วงตามค่าที่กำหนดแล้วกด Update ตรงๆ
        console.log(
            `⏳ invalid flow (${logLabel}): ข้าม nudge — หน่วง ${preUpdateDelayMs}ms ก่อนกด Update`
        );
        setStatus(`Invalid flow (${logLabel}): รอ ${(preUpdateDelayMs / 1000).toFixed(1)} วิ ก่อนกด Update`);
        await delay(preUpdateDelayMs);
    } else {
        // หลังติ๊ก checkbox dropdown อาจเปิดค้าง / focus อยู่ที่ checkbox
        // → nudge ปลดล็อกก่อนกด Update (Escape + blur + full-click annotation card/Classification row)
        const nudgedBeforeUpdate = await nudgeUnlockUpdate({ runToken });
        if (runToken != null && !isRunActive(runToken)) return;
        if (nudgedBeforeUpdate) {
            console.log("🧰 invalid flow: nudge ปลดล็อก Update เสร็จ → เช็คปุ่ม Update");
        } else {
            console.warn("⚠️ invalid flow: ไม่พบ element สำหรับ nudge — เช็คปุ่ม Update โดยตรง");
        }
        await delay(preUpdateDelayMs);
    }
    if (!isRunActive(runToken)) return;

    if (expectedTaskId) {
        const tchk = verifyExpectedTaskIdBeforeUpdate(expectedTaskId, `invalid flow (${logLabel})`);
        if (!tchk.ok) {
            setStatus("Invalid flow: Task เปลี่ยนก่อน Update — ข้าม");
            return;
        }
    }

    const updRes = await clickUpdateWithEnabledCheck({
        runToken,
        maxTries: updateMaxTries,
        retryDelayMs: updateRetryDelayMs,
        useNudgeOnRetry: useNudgeOnUpdateRetry,
        skipBlurBeforeCheck: updateSkipBlurBeforeCheck,
        pressEscBeforeClick: updatePressEscBeforeClick,
        escBeforeClickDelayMs: updateEscBeforeClickDelayMs,
    });
    if (updRes.ok) {
        if (expectedTaskId) {
            markTaskCommittedAfterSuccessfulUpdate(expectedTaskId);
        }
        setStatus(
            isQcMode()
                ? "QC: Invalid flow ส่งงานแล้ว — รอ queue"
                : "Invalid flow: ส่งงานแล้ว — รอ 2 วิ ก่อน Shift+↓"
        );
        await delay(2000);
        if (runToken != null && !isRunActive(runToken)) return;
        await closeQualityCheckFailedIfPresent({ runToken });
        if (runToken != null && !isRunActive(runToken)) return;
        if (!isQcMode() && (await goToNextTask({ runToken }))) {
            setStatus("Invalid flow: ส่ง Shift+↓ ไป task ถัดไปแล้ว");
            await delay(600);
        }
    } else if (updRes.reason === "stale") {
        return;
    } else {
        console.log("❌ Invalid flow: ปุ่มส่งงานยัง disabled — ข้าม");
        setStatus(
            isQcMode()
                ? "QC: Invalid flow ข้ามส่งงาน — รอ queue"
                : "Invalid flow: ข้าม Update (ปุ่มยัง disabled) → ไป task ถัดไป"
        );
        await delay(500);
        if (runToken != null && !isRunActive(runToken)) return;
        if (!isQcMode() && (await goToNextTask({ runToken }))) {
            setStatus("Invalid flow: ส่ง Shift+↓ ไป task ถัดไปแล้ว (ข้าม Update)");
            await delay(600);
        }
    }
}

async function runInvalidDataMissingAcceptFlow(
    reasonText = "invalid flow",
    runToken,
    cycleStartAt,
    expectedTaskId = ""
) {
    return runInvalidReasonAcceptFlow(reasonText, {
        checkboxName: "Data Missing",
        menuNeedles: ["data missing", "datamissing"],
        logLabel: "Data Missing",
        runToken,
        cycleStartAt,
        expectedTaskId,
    });
}

async function runInvalidNonTargetLanguageAcceptFlow(
    reasonText = "non-target language",
    runToken,
    cycleStartAt,
    expectedTaskId = ""
) {
    return runInvalidReasonAcceptFlow(reasonText, {
        checkboxName: "Non-Target Language",
        menuNeedles: ["non-target", "non target language", "nontarget language", "non target", "nontarget"],
        logLabel: "Non-Target Language",
        runToken,
        cycleStartAt,
        expectedTaskId,
        // Non-Target (ใช้ robustClick ทุกจุด — cross-machine ทำงานเหมือนกันทุกเครื่อง):
        // • หลังกด Invalid + เปิดเมนู → หน่วง 1.5 วินาที ก่อนติ๊ก checkbox
        // • ติ๊ก checkbox ด้วย JS click ปกติ (clickAntCheckboxByNameAndVerify)
        // • pre-Update sequence (คลิก Classification → Text area → blur → Esc)
        // • กด Escape ก่อน Update ทุกครั้ง
        // • กด Update ด้วย robustClick (event chain เต็ม + Enter fallback)
        preCheckboxDelayMs: 1500,
        useNonTargetPreUpdateSequence: true,
        useNudgeOnUpdateRetry: false,
        updateMaxTries: 3,
        updateRetryDelayMs: 800,
        updateSkipBlurBeforeCheck: true,
        updatePressEscBeforeClick: true,
        updateEscBeforeClickDelayMs: 200,
    });
}

/**
 * คลิกตัวเลือก Classification ที่ข้อความตรงกับ `exactLower` แบบทั้งคำ
 * (หลีกเลี่ยง substring: "invalid".includes("valid") === true)
 */
function clickExactClassificationChoice(exactLower) {
    const want = String(exactLower).toLowerCase();
    const candidates = document.querySelectorAll(
        '[role="option"], [role="menuitem"], .ant-select-item-option-content, .ant-select-item, li.lsf-label, span.lsf-label, button'
    );
    for (const el of candidates) {
        const raw = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
        if (!raw || raw.length > 48) continue;
        if (raw.toLowerCase() !== want) continue;
        const clickable =
            el.closest?.(
                'button, [role="button"], [role="menuitem"], [role="option"], .ant-select-item, li'
            ) || el;
        try {
            clickable.scrollIntoView?.({ block: "center", inline: "center" });
        } catch {}
        try {
            clickable.click();
            const parentBtn = clickable.closest?.('button, [role="button"]');
            if (parentBtn && parentBtn !== clickable) parentBtn.click();
            return true;
        } catch (e) {
            console.warn("[DingTag] clickExactClassificationChoice:", e?.name, e?.message);
        }
    }
    return false;
}

/**
 * เมื่ออ่าน Classification = Invalid: พยายามเปิดตัวเลือกแล้วคลิก "Valid"
 * จากนั้น autopilot รัน pipeline ถอดเสียง + QC ตามเดิม — ถ้า API บอก sensitive / non-target ฯลฯ
 * ค่อยส่ง Invalid flow ตามโปรแกรม (ไม่ใช้ Esc → Optimized → Has Errors ตั้งแต่ต้น)
 */
async function switchClassificationInvalidToValid(runToken) {
    const tryValid = () => {
        if (clickExactClassificationChoice("valid")) return true;
        if (forceClickByText(["Valid"])) return true;
        return false;
    };

    for (let attempt = 1; attempt <= 4; attempt++) {
        if (!isRunActive(runToken)) return false;
        if (tryValid()) {
            await delay(500);
            return true;
        }
        const row = findClassificationResultRow();
        const valEl = row?.querySelector(".lsf-annotation-items__result-value");
        try {
            valEl?.click();
        } catch {}
        await delay(400);
    }
    console.warn("[DingTag] ⚠️ สลับ Classification → Valid ไม่สำเร็จ — ยังรัน pipeline ถอดเสียงต่อ");
    setStatus("เตือน: คลิก Valid ไม่สำเร็จ — ลองถอดเสียงต่อ");
    return false;
}

/**
 * เจอ Classification = Invalid แบบไม่สลับเป็น Valid: Esc → Optimized → Has Errors → เช็ค Task ID → Update
 * โหมด QC: ข้าม Review Result (Optimized / Has Errors) → ส่งงานตรง
 * เรียกจาก autopilot เมื่อเปิดสวิตช์ "No Recheck Invalid" (dingtag_no_recheck_invalid)
 *
 * ขั้นตอน (Auto):
 *  1) ส่ง Escape เพื่อปิด popup/dropdown ที่อาจค้างอยู่
 *  2) คลิก radio "Optimized" — รอ 1 วิ
 *  3) คลิก radio "Has Errors"
 *  4) รอเวลาขั้นต่ำก่อน Accept ตามที่ตั้งไว้ (ถ้ามี)
 *  5) blur active element + Esc อีกครั้ง ก่อนกด Update
 *  6) Physical click ปุ่ม Update (เลื่อนเมาส์จริงผ่าน Python pyautogui)
 *  7) ตรวจ popup "Ignore & Submit" ถ้าโผล่ก็ปิดให้
 *  8) Shift+↓ ไป task ถัดไป
 */
async function runInvalidToVerifiedFlow(runToken, cycleStartAt, expectedTaskId = "") {
    if (isQcMode()) {
        console.log("🚩 Invalid (No Recheck, QC): ข้าม Review Result → ส่งงาน");
        setStatus("QC: Invalid (No Recheck) — ข้าม Review → ส่งงาน");
    } else {
        console.log("🚩 Invalid (No Recheck): Esc → Optimized → Has Errors → Update");
        setStatus("Invalid (No Recheck) — Optimized → Has Errors");
    }

    if (dispatchEscape()) {
        console.log(
            isQcMode()
                ? "⎋ Invalid flow (QC): ส่ง Escape ก่อนส่งงาน"
                : "⎋ Invalid flow: ส่ง Escape ก่อนคลิก Optimized"
        );
    }
    blurAnyActiveElement();
    await delay(400);
    if (!isRunActive(runToken)) return;

    if (!isQcMode()) {
        const optRes = await clickOptimizedRadio({ tries: 5, intervalMs: 300, runToken });
        if (optRes.reason === "stale") return;
        if (!optRes.ok) {
            console.warn("⚠️ Invalid flow: ไม่พบ radio Optimized — ข้ามไปกด Has Errors เลย");
        } else {
            console.log("✅ กด Optimized แล้ว — รอ 1 วิ ก่อนกด Has Errors");
            setStatus("Invalid: กด Optimized แล้ว — รอ 1 วิ");
            await delay(1000);
            if (!isRunActive(runToken)) return;
        }

        const errRes = await clickHasErrorsRadio({ tries: 8, intervalMs: 400, runToken });
        if (errRes.reason === "stale") return;
        if (!errRes.ok) {
            console.warn("⚠️ Invalid flow: ไม่พบ radio Has Errors");
            setStatus("Invalid: ไม่พบ Has Errors → ไป task ถัดไป");
            await delay(500);
            if (!isRunActive(runToken)) return;
            if (await goToNextTask({ runToken })) {
                setStatus("Invalid: ส่ง Shift+↓ ไป task ถัดไปแล้ว (ไม่พบ Has Errors)");
                await delay(600);
            }
            return;
        }
        setStatus("Invalid → คลิก Has Errors แล้ว");

        await delay(700);
        if (!isRunActive(runToken)) return;
    } else {
        console.log("⏭️ Invalid flow (QC): ข้าม Optimized และ Has Errors");
    }

    if (cycleStartAt != null) {
        await ensureMinElapsedBeforeAccept(runToken, cycleStartAt);
        if (!isRunActive(runToken)) return;
    }

    if (blurAnyActiveElement()) {
        console.log(
            isQcMode()
                ? "👀 Invalid flow (QC): blur ก่อนส่งงาน"
                : "👀 Invalid flow: blur active element ก่อนกด Update"
        );
    }
    if (dispatchEscape()) {
        console.log(
            isQcMode()
                ? "⎋ Invalid flow (QC): ส่ง Escape ก่อนส่งงาน"
                : "⎋ Invalid flow: ส่ง Escape ก่อนกด Update"
        );
    }
    await delay(300);
    if (!isRunActive(runToken)) return;

    if (expectedTaskId) {
        const tchk = verifyExpectedTaskIdBeforeUpdate(
            expectedTaskId,
            isQcMode() ? "Invalid (No Recheck) QC flow" : "Invalid Optimized→Has Errors flow"
        );
        if (!tchk.ok) {
            setStatus("Invalid flow: Task เปลี่ยนก่อน Update — ข้าม");
            return;
        }
    }

    const updRes = await clickUpdateWithEnabledCheck({
        runToken,
        maxTries: 3,
        retryDelayMs: 800,
        useNudgeOnRetry: false,
        skipBlurBeforeCheck: true,
        pressEscBeforeClick: true,
        escBeforeClickDelayMs: 200,
    });

    if (updRes.reason === "stale") return;

    if (updRes.ok) {
        if (expectedTaskId) {
            markTaskCommittedAfterSuccessfulUpdate(expectedTaskId);
        }
        setStatus(
            isQcMode()
                ? "QC: Invalid (No Recheck) ส่งงานแล้ว — รอ queue"
                : "Invalid flow: ส่งงานแล้ว — รอให้ระบบบันทึก"
        );
        await delay(1500);
        if (!isRunActive(runToken)) return;

        const pop = await clickPopupAndVerify(["Ignore & Submit"], {
            tries: 8,
            intervalMs: 500,
            waitDisappearMs: 2200,
        });
        if (pop.ok && pop.reason !== "not_found") {
            console.log("✅ Invalid flow: popup ถูกกดและหายไปแล้ว");
        }

        const postUpdateDelayMs = 2000;
        if (isQcMode()) {
            setStatus("QC: รอ queue ส่ง task ใหม่");
        } else {
            console.log(
                `⏳ Invalid flow: รอ ${(postUpdateDelayMs / 1000).toFixed(1)} วิ หลัง Update ก่อนส่ง Shift+↓`
            );
            setStatus(
                `Invalid flow: รอ ${(postUpdateDelayMs / 1000).toFixed(1)} วิ ก่อนเลื่อนไป task ถัดไป`
            );
        }
        await delay(postUpdateDelayMs);
        if (!isRunActive(runToken)) return;
        await closeQualityCheckFailedIfPresent({ runToken });
        if (!isRunActive(runToken)) return;
        if (!isQcMode() && (await goToNextTask({ runToken }))) {
            setStatus("Invalid flow: ส่ง Shift+↓ ไป task ถัดไปแล้ว");
            await delay(600);
        }
    } else {
        console.log("❌ Invalid flow: ปุ่มส่งงานยัง disabled");
        setStatus(
            isQcMode()
                ? "QC: Invalid flow ข้ามส่งงาน — รอ queue"
                : "Invalid flow: ข้าม Update (disabled) → ไป task ถัดไป"
        );
        await delay(500);
        if (!isRunActive(runToken)) return;
        if (!isQcMode() && (await goToNextTask({ runToken }))) {
            setStatus("Invalid flow: ส่ง Shift+↓ แล้ว (ข้าม Update)");
            await delay(600);
        }
    }
}

function getCurrentTaskId() {
    const el = document.querySelector(".lsf-current-task__task-id");
    if (!el) return "";
    return (el.textContent || "").trim();
}

/** จำว่า task นี้ส่ง Update สำเร็จแล้ว (เรียกหลัง clickUpdate สำเร็จเท่านั้น) */
function markTaskCommittedAfterSuccessfulUpdate(taskId) {
    if (!taskId) return;
    processedTaskIds.add(taskId);
    lastProcessedTaskId = taskId;
    console.log(`[DingTag] บันทึกประวัติ task ${taskId} (Update สำเร็จ)`);
}

/**
 * ปล่อย claim ชั่วคราว (lastProcessedTaskId) เมื่อ pipeline จบโดยยังไม่ commit
 * — กัน QC/Auto ค้าง "รอ queue" หลัง API fail / ไม่มีเสียง / return กลางทาง
 */
function releaseTaskClaimIfUncommitted(taskId, reason = "") {
    if (!taskId) return false;
    if (lastProcessedTaskId !== taskId) return false;
    if (processedTaskIds.has(taskId)) return false;
    lastProcessedTaskId = "";
    const suffix = reason ? ` (${reason})` : "";
    console.log(`[DingTag] ปล่อย claim task ${taskId} — ยังไม่ส่งงานสำเร็จ${suffix}`);
    return true;
}

/**
 * ก่อนกด Update — ตรวจว่า UI ยังชี้ task เดิมอยู่
 * @returns {{ ok: boolean, current: string, reason: string }}
 */
function verifyExpectedTaskIdBeforeUpdate(expectedTaskId, logLabel = "pre-Update") {
    if (!expectedTaskId) {
        return { ok: true, current: getCurrentTaskId(), reason: "no_expected" };
    }
    const current = getCurrentTaskId();
    if (!current) {
        console.warn(`[DingTag] ${logLabel}: อ่าน Task ID ปัจจุบันไม่ได้ (คาดหวัง ${expectedTaskId})`);
        return { ok: false, current: "", reason: "no_current" };
    }
    if (current !== expectedTaskId) {
        console.warn(
            `[DingTag] ${logLabel}: Task ID ไม่ตรง — คาดหวัง ${expectedTaskId} แต่ได้ ${current} → ข้าม Update`
        );
        return { ok: false, current, reason: "mismatch" };
    }
    return { ok: true, current, reason: "ok" };
}

// ===========================================================================
// Auto-Filter: ตั้งค่า "Annotators / Does not contain / <user>" ใน Filter panel
// เรียกผ่านปุ่ม Apply ในแผงตั้งค่า หรือ hotkey Shift+↑
// ===========================================================================

/** ส่ง Enter (keydown + keypress + keyup) ไปที่ active element หรือ document.body
 *  ใช้ปิด popover หลังเลือก option และยืนยันค่าใน filter
 */
function dispatchEnterKey() {
    const target = document.activeElement || document.body || document.documentElement;
    if (!target) return false;
    const opts = {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
    };
    try {
        target.dispatchEvent(new KeyboardEvent("keydown", opts));
        target.dispatchEvent(new KeyboardEvent("keypress", opts));
        target.dispatchEvent(new KeyboardEvent("keyup", opts));
        console.log(`⌨️ [Filter] dispatch Enter → ${target.tagName}${target.id ? "#" + target.id : ""}`);
        return true;
    } catch (e) {
        console.warn("[DingTag] dispatchEnterKey error:", e?.name, e?.message);
        return false;
    }
}

/** Native setter เพื่อให้ React/Vue ฯลฯ "เห็น" การเปลี่ยนค่า input/textarea */
function setNativeInputValue(el, value) {
    if (!el) return false;
    const proto =
        el.tagName === "TEXTAREA"
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    try {
        if (desc && desc.set) {
            desc.set.call(el, value);
        } else {
            el.value = value;
        }
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
    } catch (e) {
        console.warn("[DingTag] setNativeInputValue error:", e?.name, e?.message);
        return false;
    }
}

/** หา filter row ทั้งหมดในหน้า (popover-trigger ที่ไม่ใช่ปุ่ม Filters/global buttons)
 *
 * testid ที่เป็นไปได้:
 *   - "select-trigger-filter:tasks:annotators" (column ที่เลือกแล้ว)
 *   - "select-trigger-not_contains" (operator ที่เลือกแล้ว)
 *   - "select-trigger-94542" (value ที่เลือกแล้ว — ID user)
 *   - "select-trigger" (value ที่ยังว่าง เช่น "Select users")
 */
function getFilterRowTriggers() {
    const all = Array.from(document.querySelectorAll('[data-slot="popover-trigger"]'));
    return all.filter((b) => {
        // ข้ามปุ่ม Filters เอง
        if (b.getAttribute("aria-label") === "Filters") return false;
        const t = b.getAttribute("data-testid") || "";
        // รับทั้ง "select-trigger" และ "select-trigger-*"
        if (t === "select-trigger" || t.startsWith("select-trigger-")) return true;
        // ถ้าไม่มี testid เลย ให้ดูว่าอยู่ใน popover ของ Filter panel หรือเปล่า
        const inDialog = b.closest('[role="dialog"]');
        return !!inDialog;
    });
}

/** อ่านค่าที่แสดงอยู่ใน trigger (เช่น "Annotators" / "Does not contain" / "Thai-1-Nuntawut" / "Select users") */
function getTriggerDisplayValue(trigger) {
    if (!trigger) return "";
    const displayEl = trigger.querySelector('[data-testid="select-display-value"]');
    const text = (displayEl?.innerText || displayEl?.textContent || trigger.innerText || trigger.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
    return text;
}

/** อ่าน data-value ของ trigger (เช่น "filter:tasks:annotators" / "not_contains" / "94542") */
function getTriggerDataValue(trigger) {
    return (trigger?.getAttribute("data-value") || "").trim();
}

/** Parse filter rows ปัจจุบัน — group ทุก 3 triggers เป็น 1 row */
function parseFilterRows() {
    const triggers = getFilterRowTriggers();
    const rows = [];
    for (let i = 0; i + 2 < triggers.length; i += 3) {
        const colT = triggers[i];
        const opT = triggers[i + 1];
        const valT = triggers[i + 2];
        rows.push({
            column: getTriggerDisplayValue(colT),
            operator: getTriggerDisplayValue(opT),
            value: getTriggerDisplayValue(valT),
            columnDataValue: getTriggerDataValue(colT),
            operatorDataValue: getTriggerDataValue(opT),
            valueDataValue: getTriggerDataValue(valT),
            columnTrigger: colT,
            operatorTrigger: opT,
            valueTrigger: valT,
        });
    }
    return rows;
}

/** หา filter row ที่ column = Annotators (case-insensitive) */
function findAnnotatorRow(rows) {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
    for (const row of rows) {
        const col = norm(row.column);
        const colDV = norm(row.columnDataValue);
        // match จากทั้ง display text หรือ data-value (filter:tasks:annotators)
        if (col === "annotators" || col.startsWith("annotator") || colDV.includes("annotator")) {
            return row;
        }
    }
    return null;
}

/** สรุปสั้นๆ สำหรับ status bar เวลา "ไม่เจอ target" — อ่านจาก DOM (ไม่เปิด panel เอง) */
function getNoTargetFilterStatusHint() {
    if (filterApplyInFlight) {
        return "กำลังตั้ง Filter...";
    }
    const username = (filterAnnotatorUsername || "").trim();
    if (!isFilterButtonPresent()) {
        return "หน้านี้ไม่มีปุ่ม Filters — เปิดหน้ารายการ Tasks";
    }
    const filterBtn = document.querySelector('button[aria-label="Filters"]');
    const panelExpanded = filterBtn?.getAttribute("aria-expanded") === "true";
    const rows = parseFilterRows();
    const ann = findAnnotatorRow(rows);

    if (rows.length === 0 && !panelExpanded) {
        return (
            "ไม่เห็นแถว filter (panel ปิด) — กด Filters ตรวจว่ามี Annotators / Does not contain / " +
            (username || "(ตั้งชื่อใน Settings)")
        );
    }
    if (!ann) {
        if (rows.length > 0) {
            return "มี filter แต่ไม่มีแถว Annotators";
        }
        return "ยังไม่เห็นแถว filter ใน DOM";
    }
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
    const opOk = norm(ann.operator) === norm("Does not contain");
    const valOk = username ? norm(ann.value) === norm(username) : false;

    let core;
    if (!username) {
        core = "มีแถว Annotators แต่ยังไม่ได้ตั้งชื่อ exclude ใน Settings";
    } else if (opOk && valOk) {
        core = "Annotators filter ตรง Settings ✓";
    } else if (!opOk) {
        core = "Annotators: operator ไม่ใช่ Does not contain";
    } else {
        core = "Annotators: ค่าไม่ตรงชื่อใน Settings";
    }

    const auto = autoFilterEnabled ? "Auto-Filter ON" : "Auto-Filter OFF";
    return `${core} · ${auto}`;
}

/** หาว่ามี filter "Platform Acceptance Status" อยู่หรือยัง
 *  ใช้ .lsf-filterLine DOM structure แทนการนับ trigger index
 *  เพราะแถว 2+ มี conjunction trigger ("and") และ "Is empty" ไม่มี value trigger
 */
function findPlatformAcceptanceTriggers() {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
    const lines = document.querySelectorAll(".lsf-filterLine");
    for (const line of lines) {
        const fieldTrigger = line.querySelector('.lsf-field [data-slot="popover-trigger"]');
        if (!fieldTrigger) continue;
        const text = norm(getTriggerDisplayValue(fieldTrigger));
        const dv = norm(getTriggerDataValue(fieldTrigger));
        if (
            text.includes("platform acceptance") ||
            dv.includes("acceptance_result") ||
            dv.includes("platform_acceptance")
        ) {
            const opTrigger = line.querySelector('.lsf-operation [data-slot="popover-trigger"]');
            return {
                filterLine: line,
                columnTrigger: fieldTrigger,
                operatorTrigger: opTrigger || null,
            };
        }
    }
    return null;
}

/** หา <button> ที่ innerText ตรงกับ needle (case-insensitive, normalized whitespace) */
function findButtonByText(needles, { exact = false } = {}) {
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
    const lowerNeedles = (Array.isArray(needles) ? needles : [needles]).map(norm);
    const buttons = document.querySelectorAll('button, [role="button"]');
    for (const btn of buttons) {
        const t = norm(btn.innerText || btn.textContent);
        if (!t) continue;
        if (exact) {
            if (lowerNeedles.includes(t)) return btn;
        } else {
            if (lowerNeedles.some((n) => t === n || t.includes(n))) return btn;
        }
    }
    return null;
}

/** รอจน filter row โผล่ (มี trigger ≥ minTriggers ตัว) */
async function waitForFilterRows(minTriggers = 3, { timeoutMs = 4000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const trs = getFilterRowTriggers();
        if (trs.length >= minTriggers) return trs;
        await delay(100);
    }
    return getFilterRowTriggers();
}

/** รอจน trigger เพิ่มขึ้น (หลังคลิก Add Filter — รอแถวใหม่โผล่) */
async function waitForFilterRowsIncrease(prevCount, { timeoutMs = 5000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const trs = getFilterRowTriggers();
        if (trs.length > prevCount) return trs;
        await delay(100);
    }
    return getFilterRowTriggers();
}

/** รอ Radix popover (dialog) ที่ผูกกับ trigger เปิดขึ้น */
async function waitForPopoverFromTrigger(triggerBtn, { timeoutMs = 4000 } = {}) {
    const start = Date.now();
    let lastId = "";
    while (Date.now() - start < timeoutMs) {
        // 1) ลองดูจาก aria-controls ก่อน (ตรงและเสถียรสุด)
        const ctrlId = triggerBtn.getAttribute("aria-controls");
        if (ctrlId) {
            lastId = ctrlId;
            const byId = document.getElementById(ctrlId);
            if (byId && byId.getAttribute("data-state") !== "closed") return byId;
        }
        // 2) fallback: หา dialog/listbox ที่ data-state="open" ตัวล่าสุด
        const open = document.querySelector(
            '[role="dialog"][data-state="open"], [role="listbox"][data-state="open"]'
        );
        if (open) return open;
        await delay(80);
    }
    console.warn(`[DingTag] waitForPopover timeout (aria-controls=${lastId || "n/a"})`);
    return null;
}

/** คลิก option ใน popover ที่ข้อความ "ตรง" หรือ "contain" needle (ไม่สนใจตัวเล็ก/ใหญ่) */
async function clickOptionInPopover(popover, needle, { timeoutMs = 4000 } = {}) {
    if (!popover || !needle) return false;
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
    const needleLower = norm(needle);

    // หา scroll container ใน popover (virtualized list)
    const findScrollContainer = () => {
        const all = popover.querySelectorAll("*");
        for (const el of all) {
            try {
                const cs = getComputedStyle(el);
                const oy = cs.overflowY;
                if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 1) {
                    return el;
                }
            } catch {}
        }
        return null;
    };

    const findInPopover = () => {
        const candidates = popover.querySelectorAll(
            '[role="option"], [role="menuitem"], [data-slot="option"], button, li, div[role]'
        );
        // pass 1: exact
        for (const el of candidates) {
            const t = norm(el.innerText || el.textContent);
            if (t && t === needleLower) return el;
        }
        // pass 2: contains
        for (const el of candidates) {
            const t = norm(el.innerText || el.textContent);
            if (t && t.includes(needleLower)) return el;
        }
        return null;
    };

    const scrollEl = findScrollContainer();
    const start = Date.now();
    let scrollProgress = 0;

    while (Date.now() - start < timeoutMs) {
        let target = findInPopover();

        // ถ้ายังไม่เจอ และ popover scroll ได้ → ค่อย ๆ เลื่อนลงทีละครึ่งหน้า (กัน virtualized list)
        if (!target && scrollEl) {
            const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
            if (scrollProgress < maxScroll) {
                scrollProgress = Math.min(maxScroll, scrollProgress + scrollEl.clientHeight * 0.6);
                scrollEl.scrollTop = scrollProgress;
                await delay(150);
                target = findInPopover();
            }
        }

        if (target) {
            try { target.scrollIntoView?.({ block: "center", inline: "nearest" }); } catch {}
            const clickable = target.closest?.('[role="option"], [role="menuitem"], button, li') || target;
            try {
                clickable.click();
                return true;
            } catch (e) {
                console.warn("[DingTag] clickOptionInPopover click error:", e?.name, e?.message);
                return false;
            }
        }
        await delay(120);
    }
    console.warn(`[DingTag] clickOptionInPopover: ไม่พบ option ที่ตรงกับ "${needle}"`);
    return false;
}

/** เปิด trigger (ถ้ายังไม่เปิด) แล้วคลิก option ที่ match needle */
async function openSelectAndChoose(triggerBtn, needle, { timeoutMs = 4000 } = {}) {
    if (!triggerBtn) return false;
    if (triggerBtn.getAttribute("aria-expanded") !== "true") {
        try { triggerBtn.scrollIntoView?.({ block: "center" }); } catch {}
        triggerBtn.click();
    }
    const popover = await waitForPopoverFromTrigger(triggerBtn, { timeoutMs });
    if (!popover) return false;
    const ok = await clickOptionInPopover(popover, needle, { timeoutMs });
    return ok;
}

/** เปิด trigger ที่มี search box, พิมพ์ค่า แล้วคลิก option ที่ตรงกัน */
async function openSelectTypeAndChoose(triggerBtn, valueText, { timeoutMs = 5000 } = {}) {
    if (!triggerBtn) return false;
    if (triggerBtn.getAttribute("aria-expanded") !== "true") {
        try { triggerBtn.scrollIntoView?.({ block: "center" }); } catch {}
        triggerBtn.click();
    }
    const popover = await waitForPopoverFromTrigger(triggerBtn, { timeoutMs });
    if (!popover) return false;

    // หาช่อง search
    const input =
        popover.querySelector('input[type="search"]') ||
        popover.querySelector('input[type="text"]') ||
        popover.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])') ||
        popover.querySelector('[role="combobox"] input') ||
        popover.querySelector('[contenteditable="true"]');
    if (input) {
        try { input.focus(); } catch {}
        // เคลียร์ก่อน (เผื่อมีค่าเก่าค้าง)
        setNativeInputValue(input, "");
        await delay(80);
        setNativeInputValue(input, valueText);
        // รอ debounce/filter list
        await delay(400);
    } else {
        console.warn("[DingTag] openSelectTypeAndChoose: ไม่พบ input ใน popover — ลองคลิก option ตรงๆ");
    }

    return await clickOptionInPopover(popover, valueText, { timeoutMs });
}

/** รอเมนู Order by เปิด (listbox/menu/cmdk — ไม่ใช้ dialog ทั่วไปกันโดน Filters panel) */
async function waitForOpenOrderByMenu(orderBtn, { timeoutMs = 5000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const ctrlId = orderBtn.getAttribute("aria-controls");
        if (ctrlId) {
            const byId = document.getElementById(ctrlId);
            if (byId && byId.getAttribute("data-state") !== "closed") return byId;
        }
        const lb = document.querySelector(
            '[role="listbox"][data-state="open"], [role="menu"][data-state="open"]'
        );
        if (lb) return lb;
        const wrap = document.querySelector("[data-radix-popper-content-wrapper]");
        if (wrap && wrap.querySelector('[role="option"], [cmdk-item]')) return wrap;
        await delay(80);
    }
    return null;
}

/** ปุ่มสลับทิศเรียงคอลัมน์ — หลังคลิกแล้ว LS สลับ aria-label ระหว่าง Sort descending / Sort ascending */
function findTaskListSortDirectionButton() {
    return (
        document.querySelector('button[aria-label="Sort descending"]') ||
        document.querySelector('button[aria-label="Sort ascending"]')
    );
}

/** รอจน aria-label ของปุ่มเรียงเปลี่ยน (หลังคลิกครั้งก่อน) หรือหมดเวลา */
async function waitForSortButtonLabelFlip(prevLabel, { timeoutMs = 1500 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const btn = findTaskListSortDirectionButton();
        const lab = btn?.getAttribute("aria-label") || "";
        if (btn && lab && lab !== prevLabel) return btn;
        await delay(45);
    }
    return findTaskListSortDirectionButton();
}

/**
 * หลัง apply filter สำเร็จ (best-effort): คลิก Order by → เลือก columnList.lumenTaskId → blur →
 * กดปุ่มเรียงทิศตามตั้งค่า (1 ครั้ง = ท้ายก่อน, 2 ครั้ง = สลับอีกที = หัวก่อน) — รองรับปุ่มที่สลับ ascending/descending
 * ไม่ throw — ถ้า UI ไม่พร้อมจะ log แล้วจบ (ไม่ทำให้ filter fail)
 */
async function runOrderByLumenTaskIdDescendingBestEffort() {
    const STEP_MS = 450;
    const BETWEEN_SORT_MS = 380;
    const needle = "columnList.lumenTaskId";
    const sortClicks = Math.min(2, Math.max(1, orderBySortDescendingClicks || 1));
    try {
        const orderBtn = findButtonByText(["Order by"], { exact: true });
        if (!orderBtn) {
            console.warn("[OrderBy] ไม่พบปุ่ม Order by — ข้าม");
            return;
        }
        try {
            orderBtn.scrollIntoView?.({ block: "center" });
        } catch {}
        setStatus(
            sortClicks === 2
                ? "Order by: เลือก Task ID → กดปุ่มเรียง 2 ครั้ง (หัวก่อน)…"
                : "Order by: เลือก Task ID → กดปุ่มเรียง 1 ครั้ง (ท้ายก่อน)…"
        );
        orderBtn.click();
        console.log("[OrderBy] คลิกปุ่ม Order by");
        await delay(STEP_MS);

        const menuRoot = await waitForOpenOrderByMenu(orderBtn, { timeoutMs: 5000 });
        const searchRoots =
            menuRoot && document.contains(menuRoot)
                ? [menuRoot, document.body]
                : [document.body];

        const tryClickOption = () => {
            const direct =
                document.querySelector(
                    '[cmdk-item][data-value="columnList.lumenTaskId"], ' +
                        '[role="option"][data-value="columnList.lumenTaskId"]'
                ) ||
                document.querySelector('[data-value="columnList.lumenTaskId"]');
            if (direct && document.contains(direct)) {
                try {
                    direct.scrollIntoView?.({ block: "nearest" });
                } catch {}
                direct.click();
                return true;
            }
            for (const root of searchRoots) {
                if (!root) continue;
                const cand = root.querySelectorAll(
                    '[role="option"], [cmdk-item], .lsf-space-dm_direction_horizontal, .lsf-space-dm'
                );
                for (const el of cand) {
                    const raw = (el.textContent || "").replace(/\s+/g, " ").trim();
                    if (!raw.includes(needle)) continue;
                    const pick =
                        el.closest('[role="option"]') ||
                        el.closest("[cmdk-item]") ||
                        el.closest("button") ||
                        el;
                    try {
                        pick.scrollIntoView?.({ block: "nearest" });
                    } catch {}
                    pick.click();
                    return true;
                }
            }
            return false;
        };

        let clicked = false;
        const optDeadline = Date.now() + 5000;
        while (Date.now() < optDeadline && !clicked) {
            clicked = tryClickOption();
            if (!clicked) await delay(100);
        }
        if (!clicked) {
            console.warn("[OrderBy] ไม่พบรายการ", needle, "— ข้าม");
        } else {
            console.log("[OrderBy] เลือก", needle, "แล้ว");
        }
        await delay(STEP_MS);

        blurAnyActiveElement();
        try {
            if (document.body && typeof document.body.focus === "function") {
                document.body.focus();
            }
        } catch {}
        await delay(220);

        for (let i = 0; i < sortClicks; i++) {
            const sortBtn = findTaskListSortDirectionButton();
            if (!sortBtn) {
                console.warn(
                    "[OrderBy] ไม่พบปุ่ม Sort descending/ascending — หยุดที่ครั้งที่",
                    i + 1
                );
                return;
            }
            const prevLabel = sortBtn.getAttribute("aria-label") || "";
            try {
                sortBtn.scrollIntoView?.({ block: "center" });
            } catch {}
            sortBtn.click();
            console.log(`[OrderBy] คลิกเรียงทิศ ครั้งที่ ${i + 1}/${sortClicks} (${prevLabel})`);
            if (i < sortClicks - 1) {
                await delay(BETWEEN_SORT_MS);
                await waitForSortButtonLabelFlip(prevLabel, { timeoutMs: 1800 });
            }
        }
        await delay(STEP_MS);
    } catch (e) {
        console.warn("[OrderBy] error:", e?.name, e?.message);
    }
}

/**
 * ตั้ง filter ทีละ step (ค่อย ๆ ทำ):
 *   1) คลิกปุ่ม Filters (เปิด panel)
 *   2) คลิก "Add Filter" (เพิ่มแถวใหม่ 1 ครั้งเสมอ — ไม่ overwrite แถวเก่า)
 *   3) ในแถวที่เพิ่งเพิ่ม: เลือก column = Annotators
 *   4) เลือก operator = Does not contain
 *   5) พิมพ์ user แล้วเลือก option
 *
 * แถวใหม่จะเป็น "แถวล่างสุด" → เราเลือก trigger ตามตำแหน่งสุดท้ายในรายการ
 */
async function applyMyAnnotatorFilter() {
    if (!autoFilterEnabled) {
        console.log("[DingTag] Apply filter: ปิดอยู่ใน toggle — ข้าม");
        setStatus("Auto-Filter ปิดอยู่");
        return false;
    }
    if (!isFilterButtonPresent()) {
        console.log("[DingTag] Apply filter: ไม่เจอปุ่ม Filters บนหน้านี้ — ข้าม");
        setStatus("Apply filter: ไม่เจอปุ่ม Filters บนหน้านี้");
        return false;
    }
    if (filterApplyInFlight) {
        console.log("[DingTag] Apply filter: กำลังทำงานอยู่ — ข้ามการเรียกซ้ำ");
        return false;
    }
    const username = (filterAnnotatorUsername || "").trim();
    if (!username) {
        console.warn("[DingTag] Apply filter: ยังไม่ได้ตั้งชื่อ user (filterAnnotatorUsername ว่าง)");
        return false;
    }

    filterApplyInFlight = true;
    setStatus(`Apply filter: Annotators ≠ ${username} ...`);
    console.log(`🚫 [Filter] เริ่มตั้งค่า: Annotators / Does not contain / ${username}`);

    // หน่วงระหว่าง step ให้ UI หายใจ (ค่อย ๆ ทำตามที่ user สั่ง)
    const STEP_DELAY_MS = 500;

    try {
        // ─────────── Step 1: คลิก Filters เพื่อเปิด panel ───────────
        const filterBtn = document.querySelector('button[aria-label="Filters"]');
        if (!filterBtn) {
            console.warn("[Filter] Step 1: ไม่พบปุ่ม Filters บนหน้านี้");
            setStatus("Apply filter: ไม่พบปุ่ม Filters");
            return false;
        }
        if (filterBtn.getAttribute("aria-expanded") !== "true") {
            console.log("[Filter] Step 1: คลิกปุ่ม Filters เพื่อเปิด panel");
            setStatus("Filter: เปิด panel");
            try { filterBtn.scrollIntoView?.({ block: "center" }); } catch {}
            filterBtn.click();
            await delay(STEP_DELAY_MS);
        } else {
            console.log("[Filter] Step 1: panel เปิดอยู่แล้ว — ข้าม");
        }

        // ─────────── ตั้ง Platform Acceptance Status ก่อน (ไม่มี value → ไม่โดนกวน) ───────────
        await applyPlatformAcceptanceFilter();
        await delay(STEP_DELAY_MS);

        // ─────────── เช็คก่อน: filter Annotators ตั้งอยู่แล้วหรือยัง ───────────
        // (ตามที่ user สั่ง: ถ้ามีครบแล้วไม่ต้องทำซ้ำ / ถ้ามีแถวแต่ขาด field ใด → fix เฉพาะที่ขาด /
        //  ถ้าไม่มีแถวเลย → ไป Step 2 (Add Filter) ตามปกติ)
        const desiredOp = "Does not contain";
        const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
        const existingRows = parseFilterRows();
        const existing = findAnnotatorRow(existingRows);

        if (existing) {
            const opOk = norm(existing.operator) === norm(desiredOp);
            const valOk = norm(existing.value) === norm(username);
            console.log(
                `[Filter] เจอแถว Annotators อยู่แล้ว — col="${existing.column}" ` +
                `op="${existing.operator}" (${opOk ? "OK" : "ผิด"}) ` +
                `val="${existing.value}" (${valOk ? "OK" : "ผิด"})`
            );

            if (opOk && valOk) {
                console.log(`✅ [Filter] มี filter ครบอยู่แล้ว — ไม่ต้องทำซ้ำ (Annotators ≠ ${username})`);
                setStatus(`Filter already set: Annotators ≠ ${username}`);
                await runOrderByLumenTaskIdDescendingBestEffort();
                return true;
            }

            setStatus("Filter: เติมช่องที่ขาด...");
            console.log("[Filter] เติมเฉพาะ field ที่ขาด/ผิด (ไม่ add แถวใหม่)");

            // fix operator ถ้าผิด
            if (!opOk) {
                console.log(`[Filter] เติม operator: "${existing.operator}" → "${desiredOp}"`);
                const ok = await openSelectAndChoose(existing.operatorTrigger, desiredOp);
                if (!ok) {
                    console.warn("[Filter] เติม operator ไม่สำเร็จ");
                    setStatus("Apply filter: เติม operator ไม่ได้");
                    return false;
                }
                console.log(`✅ [Filter] เติม operator = ${desiredOp}`);
                await delay(STEP_DELAY_MS);
            }

            // fix value ถ้าผิด (re-query trigger เพราะอาจถูก re-render หลังเปลี่ยน operator)
            if (!valOk) {
                const refreshedRow = findAnnotatorRow(parseFilterRows()) || existing;
                const valTrigger = refreshedRow.valueTrigger;
                console.log(`[Filter] เติม value: "${existing.value}" → "${username}"`);
                const ok = await openSelectTypeAndChoose(valTrigger, username);
                if (!ok) {
                    console.warn(`[Filter] เติม user "${username}" ไม่สำเร็จ`);
                    setStatus(`Apply filter: เติม ${username} ไม่ได้`);
                    return false;
                }
                console.log(`✅ [Filter] เติม value = ${username}`);
                await delay(STEP_DELAY_MS);
                dispatchEnterKey();
                await delay(200);
            }

            setStatus(`Filter applied (เติม): Annotators ≠ ${username}`);
            console.log(`✅ [Filter] เติมครบ — Annotators ≠ ${username}`);
            await runOrderByLumenTaskIdDescendingBestEffort();
            return true;
        }

        console.log("[Filter] ยังไม่เจอแถว Annotators เลย — จะ Add Filter แถวใหม่");

        // ─────────── Step 2: คลิก "Add Filter" 1 ครั้ง (เสมอ) ───────────
        const triggersBefore = getFilterRowTriggers().length;
        console.log(`[Filter] Step 2/5: หาปุ่ม Add Filter (มี trigger เดิม ${triggersBefore} ตัว)`);
        setStatus("Filter 2/5: คลิก Add Filter");

        let addBtn = findButtonByText(
            ["Add Filter", "Add filter", "Add Another", "Add another"],
            { exact: false }
        );
        if (!addBtn) {
            console.log("[Filter] ยังไม่เจอปุ่ม Add Filter — รอ 600ms แล้วลองอีกครั้ง");
            await delay(600);
            addBtn = findButtonByText(
                ["Add Filter", "Add filter", "Add Another", "Add another"],
                { exact: false }
            );
        }
        if (!addBtn) {
            console.warn("[Filter] ไม่พบปุ่ม Add Filter / Add Another เลย");
            setStatus("Apply filter: ไม่พบปุ่ม Add Filter");
            return false;
        }
        console.log(`[Filter] คลิก "${(addBtn.innerText || "").trim()}"`);
        try { addBtn.scrollIntoView?.({ block: "center" }); } catch {}
        addBtn.click();

        // รอแถวใหม่โผล่ (trigger เพิ่มขึ้นอย่างน้อย 1 ตัว)
        let triggers = await waitForFilterRowsIncrease(triggersBefore, { timeoutMs: 5000 });
        if (triggers.length <= triggersBefore) {
            console.warn(
                `[Filter] รอแถวใหม่ไม่ทัน — trigger ยังเท่าเดิม (${triggers.length})`
            );
            setStatus("Apply filter: คลิก Add Filter แล้วแถวไม่โผล่");
            return false;
        }
        console.log(
            `[Filter] แถวใหม่โผล่แล้ว — trigger ${triggersBefore} → ${triggers.length}`
        );
        await delay(STEP_DELAY_MS);

        // helper: ดึง trigger จาก .lsf-filterLine ตัวสุดท้าย (ข้าม conjunction "and" trigger)
        const getLastLineTriggers = () => {
            const lines = document.querySelectorAll(".lsf-filterLine");
            const lastLine = lines.length > 0 ? lines[lines.length - 1] : null;
            if (!lastLine) return null;
            return {
                line: lastLine,
                colTrigger: lastLine.querySelector('.lsf-field [data-slot="popover-trigger"]'),
                opTrigger: lastLine.querySelector('.lsf-operation [data-slot="popover-trigger"]'),
                valTrigger: lastLine.querySelector('.lsf-value [data-slot="popover-trigger"]'),
            };
        };

        // ─────────── Step 3: เลือก column = Annotators (ในแถวล่างสุด) ───────────
        let lastRow = getLastLineTriggers();
        if (!lastRow || !lastRow.colTrigger) {
            console.warn("[Filter] ไม่เจอ column trigger ในแถวใหม่");
            setStatus("Apply filter: ไม่เจอ column trigger");
            return false;
        }
        let colTrigger = lastRow.colTrigger;
        console.log(
            `[Filter] Step 3/5: เปิด column dropdown แล้วเลือก "Annotators" ` +
                `(ค่าปัจจุบัน: "${(colTrigger.innerText || "").replace(/\s+/g, " ").trim()}")`
        );
        setStatus("Filter 3/5: เลือก Annotators");

        // เปิด dropdown แล้วหา option Annotators จาก data-testid โดยตรง
        try { colTrigger.scrollIntoView?.({ block: "center" }); } catch {}
        colTrigger.click();
        await delay(400);

        const ANNOTATOR_OPTION_SELECTOR =
            '[data-testid="select-option-filter:tasks:annotators"], ' +
            '[cmdk-item][data-value="filter:tasks:annotators"], ' +
            '[role="option"][data-value="filter:tasks:annotators"]';

        let annotatorOption = null;
        const optStart = Date.now();
        while (Date.now() - optStart < 4000) {
            annotatorOption = document.querySelector(ANNOTATOR_OPTION_SELECTOR);
            if (annotatorOption) break;
            await delay(100);
        }
        if (!annotatorOption) {
            console.warn("[Filter] ไม่เจอ Annotators option ใน dropdown");
            setStatus("Apply filter: เลือก Annotators ไม่ได้");
            return false;
        }
        try { annotatorOption.scrollIntoView?.({ block: "center" }); } catch {}
        await delay(100);
        annotatorOption.click();
        console.log("✅ [Filter] column = Annotators (คลิก option โดยตรง)");
        await delay(STEP_DELAY_MS);

        // ─────────── Step 4: เลือก operator = Does not contain ───────────
        lastRow = getLastLineTriggers();
        if (!lastRow || !lastRow.opTrigger) {
            console.log("[Filter] ยังไม่เจอ operator trigger — รอ 500ms แล้วลองอีก");
            await delay(500);
            lastRow = getLastLineTriggers();
        }
        if (!lastRow || !lastRow.opTrigger) {
            console.warn("[Filter] หลังเลือก column ยังหา operator trigger ไม่เจอ");
            setStatus("Apply filter: ไม่เจอ operator trigger");
            return false;
        }
        const opTrigger = lastRow.opTrigger;
        console.log("[Filter] Step 4/5: เปิด operator dropdown แล้วเลือก \"Does not contain\"");
        setStatus("Filter 4/5: เลือก Does not contain");
        const opOk = await openSelectAndChoose(opTrigger, "Does not contain");
        if (!opOk) {
            console.warn("[Filter] เลือก operator ไม่สำเร็จ");
            setStatus("Apply filter: เลือก Does not contain ไม่ได้");
            return false;
        }
        console.log("✅ [Filter] operator = Does not contain");
        await delay(STEP_DELAY_MS);

        // ─────────── Step 5: พิมพ์ user แล้วเลือก option ───────────
        lastRow = getLastLineTriggers();
        if (!lastRow || !lastRow.valTrigger) {
            console.log("[Filter] ยังไม่เจอ value trigger — รอ 500ms แล้วลองอีก");
            await delay(500);
            lastRow = getLastLineTriggers();
        }
        if (!lastRow || !lastRow.valTrigger) {
            console.warn("[Filter] หลังเลือก operator ยังหา value trigger ไม่เจอ");
            setStatus("Apply filter: ไม่เจอ value trigger");
            return false;
        }
        const valTrigger = lastRow.valTrigger;
        console.log(`[Filter] Step 5/6: พิมพ์และเลือก "${username}"`);
        setStatus(`Filter 5/6: เลือก ${username}`);
        const valOk = await openSelectTypeAndChoose(valTrigger, username);
        if (!valOk) {
            console.warn(`[Filter] เลือก user "${username}" ไม่สำเร็จ`);
            setStatus(`Apply filter: เลือก ${username} ไม่ได้`);
            return false;
        }
        console.log(`✅ [Filter] value = ${username}`);
        await delay(STEP_DELAY_MS);

        // ─────────── Step 6: กด Enter เพื่อ apply filter ───────────
        console.log("[Filter] Step 6/6: กด Enter เพื่อยืนยัน");
        setStatus("Filter 6/6: กด Enter");
        dispatchEnterKey();
        await delay(200);
        console.log(`✅ [Filter] เสร็จครบทุก step! (Annotators ≠ ${username})`);
        setStatus(`Filter applied: Annotators ≠ ${username}`);
        await runOrderByLumenTaskIdDescendingBestEffort();
        return true;
    } catch (e) {
        console.warn("[Filter] applyMyAnnotatorFilter error:", e?.name, e?.message, e);
        setStatus("Apply filter: error");
        return false;
    } finally {
        filterApplyInFlight = false;
    }
}

/**
 * ตั้ง filter "Platform Acceptance Status / Is empty"
 *
 * ใช้ .lsf-filterLine DOM structure จับ trigger ตรง ๆ ผ่าน .lsf-field / .lsf-operation
 * แทนการนับ index เพราะแถว 2+ มี conjunction trigger ("and") ปนอยู่
 * และ "Is empty" ไม่มี value trigger
 */
async function applyPlatformAcceptanceFilter() {
    const STEP_DELAY_MS = 600;
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();

    /** กด Escape เพื่อปิด popover/dropdown ที่ค้างอยู่ */
    const dismissPopovers = () => {
        const target = document.activeElement || document.body;
        if (!target) return;
        try {
            target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true }));
            target.dispatchEvent(new KeyboardEvent("keyup",   { key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true }));
        } catch {}
    };

    /** ดึง column/operator trigger จาก .lsf-filterLine ตัวสุดท้าย */
    const getLastLineTriggers = () => {
        const lines = document.querySelectorAll(".lsf-filterLine");
        const lastLine = lines.length > 0 ? lines[lines.length - 1] : null;
        if (!lastLine) return null;
        return {
            line: lastLine,
            colTrigger: lastLine.querySelector('.lsf-field [data-slot="popover-trigger"]'),
            opTrigger: lastLine.querySelector('.lsf-operation [data-slot="popover-trigger"]'),
        };
    };

    /** เช็คว่า filter panel (.lsf-filters) มีอยู่ใน DOM หรือไม่ */
    const isFilterPanelVisible = () => !!document.querySelector(".lsf-filters");

    /** เปิด filter panel ถ้ายังปิดอยู่ */
    const ensureFilterPanelOpen = async () => {
        if (isFilterPanelVisible()) {
            console.log("[Filter-PAS] filter panel เปิดอยู่แล้ว (.lsf-filters เจอ)");
            return true;
        }
        const filterBtn = document.querySelector('button[aria-label="Filters"]');
        if (!filterBtn) {
            console.warn("[Filter-PAS] ไม่พบปุ่ม Filters เลย");
            return false;
        }
        console.log("[Filter-PAS] filter panel ปิดอยู่ — คลิก Filters เพื่อเปิด");
        try { filterBtn.scrollIntoView?.({ block: "center" }); } catch {}
        filterBtn.click();
        await delay(800);
        if (isFilterPanelVisible()) return true;
        console.warn("[Filter-PAS] คลิก Filters แล้วแต่ .lsf-filters ยังไม่โผล่");
        return false;
    };

    try {
        console.log("🔧 [Filter-PAS] เริ่มตั้งค่า Platform Acceptance Status / Is empty");

        // ─── Step 0: ปิด popover ที่ค้างอยู่ + เปิด filter panel ───
        dismissPopovers();
        await delay(300);

        if (!(await ensureFilterPanelOpen())) {
            setStatus("Filter-PAS: เปิด filter panel ไม่ได้");
            return false;
        }

        // ─── Step 1: เช็คว่ามี Platform Acceptance Status filter อยู่แล้วหรือยัง ───
        const existingPAS = findPlatformAcceptanceTriggers();
        if (existingPAS) {
            const opTrigger = existingPAS.operatorTrigger;
            if (opTrigger) {
                const opText = norm(getTriggerDisplayValue(opTrigger));
                if (opText === "is empty" || opText.includes("is empty")) {
                    console.log("✅ [Filter-PAS] Platform Acceptance Status / Is empty — มีอยู่แล้ว");
                    setStatus("Filter: Platform Acceptance Status ✓");
                    return true;
                }
                console.log(`[Filter-PAS] fix operator: "${opText}" → "Is empty"`);
                setStatus("Filter-PAS: fix operator → Is empty");
                const ok = await openSelectAndChoose(opTrigger, "Is empty");
                if (!ok) {
                    console.warn("[Filter-PAS] เลือก Is empty ไม่สำเร็จ");
                    setStatus("Filter-PAS: เลือก Is empty ไม่ได้");
                    return false;
                }
                await delay(STEP_DELAY_MS);
                console.log("✅ [Filter-PAS] fix operator สำเร็จ");
                setStatus("Filter-PAS: Is empty ✓");
                return true;
            }
        }

        // ─── Step 2: คลิก "Add Another Filter" ───
        console.log("[Filter-PAS] ไม่เจอแถว Platform Acceptance Status — จะ Add Filter แถวใหม่");
        setStatus("Filter-PAS: กด Add Another Filter...");

        const linesBefore = document.querySelectorAll(".lsf-filterLine").length;
        console.log(`[Filter-PAS] จำนวนแถวก่อนกด = ${linesBefore}`);

        let addBtn = findButtonByText(
            ["Add Another Filter", "Add Filter", "Add filter", "Add Another", "Add another"],
            { exact: false }
        );
        if (!addBtn) {
            await delay(800);
            addBtn = findButtonByText(
                ["Add Another Filter", "Add Filter", "Add filter", "Add Another", "Add another"],
                { exact: false }
            );
        }
        if (!addBtn) {
            console.warn("[Filter-PAS] ไม่พบปุ่ม Add Another Filter");
            setStatus("Filter-PAS: ไม่พบปุ่ม Add Another Filter");
            return false;
        }
        console.log(`[Filter-PAS] กดปุ่ม "${(addBtn.innerText || "").replace(/\s+/g, " ").trim()}"`);
        try { addBtn.scrollIntoView?.({ block: "center" }); } catch {}
        addBtn.click();

        // รอ .lsf-filterLine ใหม่โผล่
        const waitStart = Date.now();
        while (Date.now() - waitStart < 5000) {
            if (document.querySelectorAll(".lsf-filterLine").length > linesBefore) break;
            await delay(100);
        }
        const linesNow = document.querySelectorAll(".lsf-filterLine").length;
        if (linesNow <= linesBefore) {
            console.warn(`[Filter-PAS] รอแถวใหม่ไม่ทัน (ยังมี ${linesNow} แถว)`);
            setStatus("Filter-PAS: แถวใหม่ไม่โผล่");
            return false;
        }
        console.log(`[Filter-PAS] แถวใหม่โผล่แล้ว (${linesBefore} → ${linesNow})`);
        await delay(STEP_DELAY_MS);

        // ─── helper: รอจนกว่าจะเจอ element ตาม selector ใน DOM ───
        const waitForElement = async (selector, timeoutMs = 4000) => {
            const start = Date.now();
            while (Date.now() - start < timeoutMs) {
                const el = document.querySelector(selector);
                if (el) return el;
                await delay(100);
            }
            return null;
        };

        // ─── Step 3: เลือก column = Platform Acceptance Status (ในแถวล่างสุด) ───
        let last = getLastLineTriggers();
        if (!last || !last.colTrigger) {
            console.warn("[Filter-PAS] ไม่เจอ column trigger ในแถวใหม่");
            setStatus("Filter-PAS: ไม่เจอ column trigger");
            return false;
        }
        const colCurrentText = (last.colTrigger.innerText || "").replace(/\s+/g, " ").trim();
        console.log(`[Filter-PAS] Step 3: เลือก column (ค่าปัจจุบัน: "${colCurrentText}")`);
        setStatus("Filter-PAS: เลือก Platform Acceptance Status");

        // คลิก column trigger เพื่อเปิด cmdk dropdown
        try { last.colTrigger.scrollIntoView?.({ block: "center" }); } catch {}
        last.colTrigger.click();
        console.log("[Filter-PAS] คลิก column trigger แล้ว — รอ cmdk dropdown");
        await delay(400);

        // รอ option "Platform Acceptance Status" โผล่ใน DOM (cmdk render เป็น [cmdk-item] / [role="option"])
        const PAS_OPTION_SELECTOR =
            '[data-testid="select-option-filter:tasks:acceptance_result"], ' +
            '[cmdk-item][data-value="filter:tasks:acceptance_result"], ' +
            '[role="option"][data-value="filter:tasks:acceptance_result"]';

        let pasOption = await waitForElement(PAS_OPTION_SELECTOR, 4000);
        if (!pasOption) {
            // retry: ปิด popover แล้วเปิดใหม่
            console.log("[Filter-PAS] ไม่เจอ PAS option — ลองคลิก column trigger อีกครั้ง");
            dismissPopovers();
            await delay(300);
            last = getLastLineTriggers();
            if (last?.colTrigger) {
                last.colTrigger.click();
                await delay(500);
                pasOption = await waitForElement(PAS_OPTION_SELECTOR, 4000);
            }
        }
        if (!pasOption) {
            console.warn("[Filter-PAS] เลือก Platform Acceptance Status ไม่สำเร็จ — ไม่เจอ option ใน DOM");
            setStatus("Filter-PAS: ไม่เจอ Platform Acceptance Status ใน dropdown");
            dismissPopovers();
            return false;
        }

        // scroll ให้เห็น แล้วคลิก
        try { pasOption.scrollIntoView?.({ block: "center" }); } catch {}
        await delay(100);
        pasOption.click();
        console.log("✅ [Filter-PAS] column = Platform Acceptance Status (คลิก option โดยตรง)");
        await delay(STEP_DELAY_MS);

        // ─── Step 4: เลือก operator = Is empty (ในแถวล่างสุด) ───
        // re-query เพราะ DOM re-render หลังเลือก column
        last = getLastLineTriggers();
        if (!last || !last.opTrigger) {
            console.log("[Filter-PAS] ยังไม่เจอ operator trigger — รอ 600ms แล้วลองอีก");
            await delay(600);
            last = getLastLineTriggers();
        }
        if (!last || !last.opTrigger) {
            console.warn("[Filter-PAS] หลังเลือก column ยังหา operator trigger ไม่เจอ");
            setStatus("Filter-PAS: ไม่เจอ operator trigger");
            return false;
        }
        const opCurrentText = (last.opTrigger.innerText || "").replace(/\s+/g, " ").trim();
        console.log(`[Filter-PAS] Step 4: เลือก operator (ค่าปัจจุบัน: "${opCurrentText}")`);
        setStatus("Filter-PAS: เลือก Is empty");

        // คลิก operator trigger เพื่อเปิด dropdown
        try { last.opTrigger.scrollIntoView?.({ block: "center" }); } catch {}
        last.opTrigger.click();
        console.log("[Filter-PAS] คลิก operator trigger แล้ว — รอ option");
        await delay(400);

        // หา "Is empty" option โดยตรงจาก data-value / data-testid
        const EMPTY_OPTION_SELECTOR =
            '[data-testid="select-option-empty"], ' +
            '[cmdk-item][data-value="empty"], ' +
            '[role="option"][data-value="empty"]';

        let emptyOption = await waitForElement(EMPTY_OPTION_SELECTOR, 4000);
        if (!emptyOption) {
            // fallback: ลอง openSelectAndChoose ด้วย text matching
            console.log("[Filter-PAS] ไม่เจอ Is empty option จาก selector — ลอง text matching");
            last = getLastLineTriggers();
            if (last?.opTrigger) {
                const opOk = await openSelectAndChoose(last.opTrigger, "Is empty");
                if (opOk) {
                    console.log("✅ [Filter-PAS] operator = Is empty (text matching fallback)");
                    await delay(300);
                    console.log("✅ [Filter-PAS] เสร็จ! Platform Acceptance Status / Is empty");
                    setStatus("Filter-PAS: Platform Acceptance Status / Is empty ✓");
                    return true;
                }
            }
            console.warn("[Filter-PAS] เลือก Is empty ไม่สำเร็จ");
            setStatus("Filter-PAS: เลือก Is empty ไม่ได้");
            return false;
        }

        try { emptyOption.scrollIntoView?.({ block: "center" }); } catch {}
        await delay(100);
        emptyOption.click();
        console.log("✅ [Filter-PAS] operator = Is empty (คลิก option โดยตรง)");
        await delay(300);

        console.log("✅ [Filter-PAS] เสร็จ! Platform Acceptance Status / Is empty");
        setStatus("Filter-PAS: Platform Acceptance Status / Is empty ✓");
        return true;
    } catch (e) {
        console.warn("[Filter-PAS] applyPlatformAcceptanceFilter error:", e?.name, e?.message, e);
        setStatus("Filter-PAS: error — " + (e?.message || "unknown"));
        return false;
    }
}

/**
 * Auto-recovery sequence เมื่อ BOT ไม่เจอ target task นาน:
 *   1) apply filter (Annotators / Does not contain / <user>) — 6 steps
 *   2) blur active element (ปิด popover/dropdown ที่ค้างอยู่)
 *   3) กด Shift+ArrowDown (เลื่อนไป task ถัดไปใน list ที่ถูก filter)
 */
async function runAutoFilterRecovery() {
    console.log("🚨 [Auto-Filter] BOT ไม่เจอ target นาน → เริ่ม recovery sequence");
    setStatus("Auto-Filter recovery: apply filter...");

    const ok = await applyMyAnnotatorFilter();
    if (!ok) {
        console.warn("⚠️ [Auto-Filter] applyMyAnnotatorFilter ไม่สำเร็จ — ข้าม blur/Shift+↓");
        return false;
    }

    // (2) blur active element เพื่อปิด popover/dropdown ที่อาจค้างหลัง apply
    try {
        const ae = document.activeElement;
        if (ae && typeof ae.blur === "function" && ae !== document.body) {
            ae.blur();
            console.log("👀 [Auto-Filter] blur active element แล้ว — รอ 3 วิ ก่อน Shift+↓");
        } else {
            console.log("👀 [Auto-Filter] ไม่มี element ที่ต้อง blur — รอ 3 วิ ก่อน Shift+↓");
        }
    } catch {}
    setStatus("Auto-Filter: รอ 3 วิ ก่อน Shift+↓");
    await delay(3000);

    // (3) Shift+ArrowDown เพื่อเลื่อนไป task ถัดไปใน list ที่ถูก filter
    if (dispatchShiftArrowDown()) {
        console.log("⌨️ [Auto-Filter] dispatch Shift+ArrowDown แล้ว");
        setStatus("Auto-Filter: ส่ง Shift+↓ เลื่อนไป task ถัดไป");
    } else {
        console.warn("⚠️ [Auto-Filter] dispatch Shift+ArrowDown ล้มเหลว");
    }
    return true;
}

/** หน้า Data Manager (QC): ปุ่ม "QC All Tasks" — แทน Filter ของโหมด Auto */
function findQcAllTasksButton() {
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
        const text = (btn.innerText || btn.textContent || "").trim();
        if (/^qc\s+all\s+tasks$/i.test(text)) return btn;
        const span = btn.querySelector("span");
        if (span) {
            const spanText = (span.innerText || span.textContent || "").trim();
            if (/^qc\s+all\s+tasks$/i.test(spanText)) return btn;
        }
    }
    return null;
}

function isQcAllTasksButtonPresent() {
    const btn = findQcAllTasksButton();
    if (!btn) return false;
    if (btn.disabled) return false;
    if (btn.hasAttribute && btn.hasAttribute("disabled")) return false;
    if (btn.getAttribute && btn.getAttribute("aria-disabled") === "true") return false;
    if (btn.getAttribute && btn.getAttribute("data-waiting") === "true") return false;
    return true;
}

/**
 * QC recovery บนหน้า Data Manager: กด "QC All Tasks" แล้วรอกลับเข้า labeling queue
 * (ไม่ใช้ Shift+↓ — รอ navigation / task ใหม่จากระบบ)
 */
async function runQcAllTasksRecovery() {
    if (qcAllTasksInFlight) {
        console.log("[DingTag QC] QC All Tasks: กำลังทำงานอยู่ — ข้ามการเรียกซ้ำ");
        return false;
    }
    const btn = findQcAllTasksButton();
    if (!btn || !isQcAllTasksButtonPresent()) {
        console.log("[DingTag QC] QC All Tasks: ไม่เจอปุ่มบนหน้านี้ — ข้าม");
        return false;
    }

    qcAllTasksInFlight = true;
    const urlBefore = location.href;
    console.log("🚨 [DingTag QC] หน้า Data Manager — กด QC All Tasks");
    setStatus("QC: กด QC All Tasks...");

    try {
        try {
            btn.scrollIntoView?.({ block: "center" });
        } catch {}
        const rcRes = await robustClick(btn, {
            tries: 2,
            intervalMs: 200,
            logLabel: "QC All Tasks",
        });
        if (!rcRes.ok) {
            console.warn("[DingTag QC] QC All Tasks: robustClick ล้มเหลว —", rcRes.reason);
            setStatus("QC: กด QC All Tasks ไม่สำเร็จ");
            return false;
        }

        setStatus("QC: รอเข้า queue หลัง QC All Tasks...");
        await delay(2500);

        const urlAfter = location.href;
        const btnGone = !isQcAllTasksButtonPresent();
        const hasClassification = !!scanClassificationTarget()?.targetEl;
        if (urlAfter !== urlBefore || btnGone || hasClassification) {
            console.log(
                `[DingTag QC] QC All Tasks สำเร็จ (urlChanged=${urlAfter !== urlBefore}, btnGone=${btnGone}, hasCls=${hasClassification})`
            );
            setStatus("QC: เข้า queue แล้ว — รอ task");
            return true;
        }

        console.warn("[DingTag QC] QC All Tasks: คลิกแล้วแต่ยังไม่เห็น navigation — ลองอีกครั้งในรอบถัดไป");
        setStatus("QC: รอผลจาก QC All Tasks...");
        return false;
    } catch (e) {
        console.warn("[DingTag QC] runQcAllTasksRecovery error:", e?.name, e?.message);
        setStatus("QC All Tasks: error");
        return false;
    } finally {
        qcAllTasksInFlight = false;
    }
}

// Hotkey Manual mode: คีย์บอร์ด + ปุ่มเมาส์ (เช่น Forward = button 4)
document.addEventListener(
    "keydown",
    (e) => {
        if (hotkeyCaptureTarget) {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cancelHotkeyCapture();
                setManualStatus("ยกเลิกการตั้งค่าคีย์ลัด");
                return;
            }
            if (finishHotkeyCaptureFromKeyboard(e)) {
                e.preventDefault();
                e.stopPropagation();
            }
            return;
        }
        if (extensionMode !== "manual" || isManualBusy()) return;
        if (manualHotkeyMatchesKeyboard(e, manualTranscribeHotkey)) {
            e.preventDefault();
            e.stopPropagation();
            runManualTranscribe().catch((err) => console.warn("[DingTag Manual] hotkey transcribe:", err?.message));
            return;
        }
        if (manualHotkeyMatchesKeyboard(e, manualFormalizeHotkey)) {
            e.preventDefault();
            e.stopPropagation();
            runManualFormalize().catch((err) => console.warn("[DingTag Manual] hotkey formalize:", err?.message));
        }
    },
    true
);

document.addEventListener(
    "mousedown",
    (e) => {
        if (hotkeyCaptureTarget) {
            if (e.button === 0 && panel.contains(e.target)) return;
            if (finishHotkeyCaptureFromMouse(e)) {
                e.preventDefault();
                e.stopPropagation();
            }
            return;
        }
        if (extensionMode !== "manual" || isManualBusy()) return;
        if (manualHotkeyMatchesMouse(e, manualTranscribeHotkey)) {
            e.preventDefault();
            e.stopPropagation();
            runManualTranscribe().catch((err) => console.warn("[DingTag Manual] mouse transcribe:", err?.message));
            return;
        }
        if (manualHotkeyMatchesMouse(e, manualFormalizeHotkey)) {
            e.preventDefault();
            e.stopPropagation();
            runManualFormalize().catch((err) => console.warn("[DingTag Manual] mouse formalize:", err?.message));
        }
    },
    true
);

// Hotkey: Shift+ArrowUp → applyMyAnnotatorFilter
// - ทำงานก็ต่อเมื่อ Auto-Filter toggle ON และเจอปุ่ม Filters บนหน้านี้
// - ไม่ทำงานถ้ากำลังพิมพ์ในช่อง input/textarea/contenteditable (ปล่อยให้ event ผ่านไป)
// - capture phase + preventDefault เพื่อกัน LSF/Browser หยิบ event ไปก่อน
document.addEventListener(
    "keydown",
    (e) => {
        if (extensionMode !== "auto") return;
        if (!e.shiftKey) return;
        if (e.key !== "ArrowUp") return;
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        if (e.repeat) return;

        const ae = document.activeElement;
        const tag = ae?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || ae?.isContentEditable) return;

        // ถ้าฟีเจอร์ปิด หรือไม่เจอปุ่ม Filters บนหน้านี้ → ไม่ทำอะไร (ปล่อยให้ default behavior ทำงาน)
        if (!autoFilterEnabled) return;
        if (!isFilterButtonPresent()) return;

        e.preventDefault();
        e.stopPropagation();
        console.log("⌨️ Hotkey Shift+↑ → Apply My Annotator Filter");
        applyMyAnnotatorFilter().catch((err) => {
            console.warn("[DingTag] hotkey apply filter error:", err?.name, err?.message);
        });
    },
    true
);

/**
 * Pipeline หลัก: Classification → (Invalid→Valid ถ้าต้อง) → ถอดเสียง → formal → Update → Shift+↓
 */
async function runTranscriptionPipeline(
    runToken,
    cycleStartAt,
    pipelineTaskId,
    {
        classificationValue = "valid",
        skipInitialClassificationClick = false,
        forceTranscribeFromInvalid = false,
    } = {}
) {
    const csRes = await ensureCancelSkipIfWasSkipped({ runToken });
    if (csRes.reason === "stale") return;
    if (!csRes.ok && csRes.reason !== "not_skipped") {
        console.warn("[DingTag] pipeline: Cancel skip ไม่สำเร็จ —", csRes.reason);
    }
    if (
        csRes.reason === "cancel_skip_has_classification" ||
        csRes.reason === "cancel_skip_has_region"
    ) {
        console.log(
            `[DingTag] pipeline: Cancel skip — ข้าม recovery (${csRes.reason})`
        );
    } else if (
        csRes.reason === "cancel_skip_empty_annotation" ||
        csRes.reason === "cancel_skip_no_region"
    ) {
        setStatus("Cancel skip → ไม่มี region — waveform recovery...");
        await runNoClassificationRecoveryFlow(pipelineTaskId);
        return;
    } else {
        const postCancelState = getClassificationSidebarState();
        if (shouldRunWaveformRecovery(postCancelState)) {
            setStatus("Cancel skip → ยังไม่มี Valid-Invalid — waveform recovery...");
            await runNoClassificationRecoveryFlow(pipelineTaskId);
            return;
        }
    }

    if (!skipInitialClassificationClick) {
        await delay(READ_DELAY_MS);
        if (!isRunActive(runToken)) return;

        const scanned = scanClassificationTarget();
        if (scanned?.targetEl) {
            scanned.targetEl.click();
            console.log("🖱️ 1. กด Classification เรียบร้อย!");
            if (scanned.classificationValue) {
                classificationValue = scanned.classificationValue;
            }
        } else {
            console.warn("⚠️ pipeline: ไม่พบ Classification element สำหรับคลิก");
        }

        await delay(1000);
        if (!isRunActive(runToken)) return;
    } else {
        await delay(500);
        if (!isRunActive(runToken)) return;
    }

    if (classificationValue === "invalid") {
        if (noRecheckInvalidEnabled && !forceTranscribeFromInvalid) {
            if (isQcMode()) {
                console.log(
                    "⚡ Classification = Invalid — No Recheck (QC): ข้าม Review → ส่งงาน"
                );
                setStatus("QC: Invalid (No Recheck) — ส่งงาน…");
            } else {
                console.log(
                    "⚡ Classification = Invalid — No Recheck: Optimized → Has Errors → เช็ค Task ID → Update"
                );
                setStatus("Invalid (No Recheck): Optimized → Has Errors…");
            }
            await runInvalidToVerifiedFlow(runToken, cycleStartAt, pipelineTaskId);
            return;
        }
        console.log(
            "⚡ Classification = Invalid → เคลียร์ Invalid Reason → สลับเป็น Valid แล้วรัน pipeline (คัดกรองด้วย API)"
        );
        if (!noRecheckInvalidEnabled) {
            setStatus("Invalid → เคลียร์ Invalid Reason ก่อน Re-check...");
            const clearRes = await clearCheckedInvalidReasons({ runToken });
            if (clearRes.reason === "stale") return;
            if (clearRes.count > 0) {
                console.log(
                    `[DingTag] Re-check: เคลียร์ Invalid Reason ${clearRes.count} รายการ`
                );
            }
            await delay(300);
            if (!isRunActive(runToken)) return;
        }
        setStatus("Invalid → Valid แล้วถอดเสียง...");
        await switchClassificationInvalidToValid(runToken);
        await delay(450);
        if (!isRunActive(runToken)) return;
    }

    let ta = await waitForSelector('textarea[name="Annotation Result"]', {
        timeoutMs: 8000,
        intervalMs: 250,
    });
    if (ta) {
        ta.focus();
        console.log("📝 2. โฟกัสกล่อง Annotation Result แล้ว");

        setStatus("ถอดเสียง (Local API)...");
        const audioBase64 = await fetchAudioAsBase64();
        if (!audioBase64) {
            console.warn("⚠️ ไม่มีข้อมูลเสียง — ข้ามการเรียก API");
            setStatus("ไม่มีไฟล์เสียง");
            return;
        }

        const apiResult = await postTranscribe(audioBase64);
        if (!isRunActive(runToken)) return;
        if (!apiResult.ok) {
            console.error("[DingTag]", apiResult.errorLabel, "—", apiResult.detail);
            setStatus(apiResult.errorLabel + " — " + (apiResult.detail || "").slice(0, 100));
            return;
        }
        const data = apiResult.data;

        if (data.status === "paused") {
            console.warn("[DingTag] โปรแกรม Python ตั้งค่า PAUSE — ไม่ถอดเสียง (เปิดสวิตช์ AI ในแอป)");
            setStatus("API: ระบบ AI หยุดชั่วคราว");
            return;
        }

        if (data.status === "error") {
            console.error("[DingTag] ถอดเสียงล้มเหลว:", data.message || JSON.stringify(data));
            setStatus("ถอดเสียงล้มเหลว: " + String(data.message || "").slice(0, 80));
            return;
        }

        const qc = data.qc || {};
        const longSil = qc.longSilence;
        if (longSil && longSil.trigger === true) {
            console.warn(
                `[DingTag] ช่วงเงียบ/พลังงานต่ำต่อเนื่อง ${longSil.longestRunSec}s (เกณฑ์ ${longSil.thresholdSec}s) → Invalid Data Missing`
            );
            setStatus("เงียบ/ไม่มีเสียงพูดต่อเนื่องเกิน 2.5 วิ — ส่ง Data Missing");
            await runInvalidDataMissingAcceptFlow(
                "Long silence / low-energy segment (>=2.5s)",
                runToken,
                cycleStartAt,
                pipelineTaskId
            );
            return;
        }

        const audioQ = qc.audioQuality;
        if (audioQ && audioQ.trigger === true) {
            console.warn(
                `[DingTag] AI QC เสียง/ถอดเสียง → ${audioQ.category || "BAD"} (Data Missing)`
            );
            setStatus(
                `คุณภาพเสียง/ถอดเสียงไม่ผ่าน (${audioQ.category || ""}) — ส่ง Data Missing`
            );
            await runInvalidDataMissingAcceptFlow(
                `Audio/transcript QC: ${audioQ.category || "BAD"}`,
                runToken,
                cycleStartAt,
                pipelineTaskId
            );
            return;
        }

        if (data.isSensitive === true) {
            console.warn("⚠️ เนื้อหาอ่อนไหว (Politics/War/Monarchy) — ข้ามการวางข้อความ และคงค่าเดิมไว้");
            setStatus("Sensitive — ส่ง invalid flow");
            await runInvalidDataMissingAcceptFlow("Sensitive content", runToken, cycleStartAt, pipelineTaskId);
            return;
        }

        const halu = qc.hallucination || {};
        if (halu.retried) {
            const fb = halu.fallbackModel || "fallback";
            if (halu.retriedHallucinated) {
                console.warn(
                    `[DingTag] 🌀 AI หลอนซ้ำ (unit='${halu.unit}'×${halu.reps}) — ลอง ${fb} แล้วยังหลอนอีก (unit='${halu.retriedUnit}'×${halu.retriedReps}) → ใช้ผลลัพธ์เดิม`
                );
                setStatus(`AI หลอน (ลอง ${fb} แล้วยังซ้ำ) — ใช้ผลลัพธ์เดิม`);
            } else {
                console.log(
                    `[DingTag] ✅ AI หลอน (unit='${halu.unit}'×${halu.reps}) → ${fb} แก้ได้ (${halu.textLen} → ${halu.retriedTextLen} chars)`
                );
                setStatus(`AI หลอน → ${fb} แก้แล้ว`);
            }
        } else if (halu.primaryHallucinated) {
            console.warn(
                `[DingTag] 🌀 AI หลอน (unit='${halu.unit}'×${halu.reps}) — แต่ primary คือ fallback อยู่แล้ว ข้าม retry`
            );
        }

        if (qc.isNonTarget === true) {
            const warnParts = [
                "⚠️ QC Non-Target — englishRatio:",
                qc.englishRatio,
                "source:",
                qc.nonTargetSource,
            ];
            if (qc.foreignScript) {
                warnParts.push(
                    "foreignScript:",
                    qc.foreignScript,
                    "count:",
                    qc.foreignScriptCount,
                    "share:",
                    qc.foreignScriptShare
                );
            }
            if (qc.centralThaiRecheck) {
                warnParts.push(
                    "recheck:",
                    qc.centralThaiRecheck.overturned ? "overturned" : "confirmed"
                );
            }
            warnParts.push("— ข้ามการวางข้อความ และคงค่าเดิมไว้");
            console.warn(...warnParts);
            const statusSuffix = qc.foreignScript ? ` (${qc.foreignScript})` : "";
            setStatus(`Non-Target${statusSuffix} — ส่ง invalid flow`);
            await runInvalidNonTargetLanguageAcceptFlow(
                qc.foreignScript
                    ? `Non-target language (foreign script: ${qc.foreignScript})`
                    : "Non-target language (QC)",
                runToken,
                cycleStartAt,
                pipelineTaskId
            );
            return;
        }

        if ((qc.hallucination || {}).stillHallucinated === true) {
            const hh = qc.hallucination || {};
            const u = hh.finalUnit || hh.unit || "";
            const r = hh.finalReps ?? hh.reps ?? 0;
            console.warn(
                `[DingTag] คำซ้ำหลังถอดเสียง (unit='${u}'×${r}) — วางข้อความดิบแล้วส่ง Invalid (Data Missing)`
            );
            setStatus("คำซ้ำหลังถอดเสียง — วางข้อความแล้วส่ง Data Missing");
            safeSetTextarea(runToken, ta, data.text || "", "raw → invalid (repetition)");
            await runInvalidDataMissingAcceptFlow(
                "Repetitive transcript / data missing (hallucination)",
                runToken,
                cycleStartAt,
                pipelineTaskId
            );
            return;
        }

        safeSetTextarea(runToken, ta, data.text || "", "raw");
        setStatus("วางข้อความดิบแล้ว (กำลังจัดคำ)...");

        const formalResult = await postFormalize(data.text || "");
        if (!isRunActive(runToken)) return;
        if (!formalResult.ok) {
            console.warn("[DingTag] formalize failed:", formalResult.errorLabel, formalResult.detail);
            setStatus("จัดคำไม่สำเร็จ (ใช้ข้อความดิบ)");
        } else if ((formalResult.data || {}).status === "paused") {
            setStatus("Formal: ระบบ AI หยุดชั่วคราว");
        } else {
            const formatted = (formalResult.data || {}).text || "";
            const fqc = (formalResult.data || {}).qc || {};
            const fsp = fqc.formalSpacing;
            if (fsp && fsp.spacingRefined) {
                console.log(
                    "[DingTag] 📐 Formal spacing refined:",
                    fsp.spacingModel || "",
                    fsp.reason || ""
                );
            }
            if (formatted && formatted.trim()) {
                const fHallu = (fqc.hallucination || {}).stillHallucinated === true;
                if (fHallu) {
                    const fh = fqc.hallucination || {};
                    const fu = fh.finalUnit || fh.unit || "";
                    const fr = fh.finalReps ?? fh.reps ?? 0;
                    console.warn(
                        `[DingTag] คำซ้ำหลังจัดคำ (unit='${fu}'×${fr}) — วางข้อความแล้วส่ง Invalid (Data Missing)`
                    );
                    setStatus("คำซ้ำหลังจัดคำ — ส่ง Data Missing");
                    safeSetTextarea(runToken, ta, formatted, "formal → invalid (repetition)");
                    await runInvalidDataMissingAcceptFlow(
                        "Repetitive text after formalize / data missing",
                        runToken,
                        cycleStartAt,
                        pipelineTaskId
                    );
                    return;
                }
                safeSetTextarea(runToken, ta, formatted, "formal");
                setStatus(
                    fsp && fsp.spacingRefined
                        ? "จัดคำแล้ว (แก้เว้นวรรคถี่ด้วย Gemini)"
                        : "จัดคำแล้ว"
                );
            } else {
                setStatus("จัดคำแล้ว (ผลลัพธ์ว่าง)");
            }
        }
    } else {
        console.log("⚠️ ไม่พบ Text Area...");
        setStatus("ไม่พบ Text Area");
        return;
    }

    await delay(MOVE_DELAY_MS);
    if (!isRunActive(runToken)) return;

    await ensureMinElapsedBeforeAccept(runToken, cycleStartAt);
    if (!isRunActive(runToken)) return;

    const refocusMain = refocusClassification();
    if (refocusMain) {
        console.log("🖱️ ก่อนส่งงาน: refocus Classification (<em>) แล้ว");
    } else {
        console.warn("⚠️ ก่อนส่งงาน: ไม่พบ Classification value element");
    }

    if (blurAnyActiveElement()) {
        console.log(
            isQcMode()
                ? "👀 Valid flow (QC): blur active element ก่อนส่งงาน"
                : "👀 Valid flow: blur active element ก่อนเลือก Review radios"
        );
    }
    if (dispatchEscape()) {
        console.log(
            isQcMode()
                ? "⎋ Valid flow (QC): ส่ง Escape ก่อนส่งงาน"
                : "⎋ Valid flow: ส่ง Escape ก่อนเลือก Review radios"
        );
    }
    await delay(300);
    if (!isRunActive(runToken)) return;

    if (isQcMode()) {
        console.log("⏭️ Valid flow (QC): ข้าม Review Result (Optimized / Verified)");
        setStatus("QC: ข้าม Review Result — ส่งงาน");
    } else {
        setStatus("Valid: กด Optimized → Verified ก่อน Update");
        const optValidRes = await clickOptimizedRadio({ tries: 5, intervalMs: 300, runToken });
        if (!optValidRes.ok && optValidRes.reason === "stale") return;
        if (!optValidRes.ok) {
            console.warn("⚠️ Valid flow: ไม่พบ radio Optimized — ยังลอง Verified แล้ว Update ต่อ");
        } else {
            console.log("✅ Valid flow: เลือก Optimized แล้ว — รอก่อนกด Verified");
        }
        await delay(800);
        if (!isRunActive(runToken)) return;

        const verRadioRes = await clickVerifiedRadio({ tries: 5, intervalMs: 300, runToken });
        if (!verRadioRes.ok && verRadioRes.reason === "stale") return;
        if (!verRadioRes.ok) {
            console.warn("⚠️ Valid flow: ไม่พบ radio Verified — ยังลองกด Update");
        } else {
            console.log("✅ Valid flow: เลือก Verified (radio) แล้ว");
        }
        await delay(300);
        if (!isRunActive(runToken)) return;

        if (blurAnyActiveElement()) {
            console.log("👀 Valid flow: blur หลังเลือก radios ก่อนกด Update");
        }
        if (dispatchEscape()) {
            console.log("⎋ Valid flow: ส่ง Escape ก่อนกด Update");
        }
        await delay(200);
        if (!isRunActive(runToken)) return;
    }

    const validTaskChk = verifyExpectedTaskIdBeforeUpdate(pipelineTaskId, "Valid flow");
    if (!validTaskChk.ok) {
        setStatus("Valid: Task เปลี่ยนก่อน Update — ข้ามการกด Update");
        return;
    }

    console.log("🔍 กำลังเช็คปุ่ม Update (robustClick)...");
    const updMainRes = await clickUpdateWithEnabledCheck({
        runToken,
        maxTries: 3,
        retryDelayMs: 1000,
        useNudgeOnRetry: false,
        skipBlurBeforeCheck: true,
        pressEscBeforeClick: true,
        escBeforeClickDelayMs: 200,
    });
    if (!updMainRes.ok) {
        if (updMainRes.reason === "stale") return;
        console.log(
            isQcMode()
                ? "❌ 4. QC: ข้ามส่งงาน (ปุ่มยัง disabled)"
                : "❌ 4. ข้ามการกด Update (ปุ่มยัง disabled หลังลอง 3 ครั้ง) -> Shift+↓"
        );
        setStatus(
            isQcMode()
                ? "QC: ข้ามส่งงาน — รอ queue"
                : "ข้าม Update (ปุ่มยัง disabled) → ไป task ถัดไป"
        );
        await delay(500);
        if (!isRunActive(runToken)) return;
        if (!isQcMode() && (await goToNextTask({ runToken }))) {
            setStatus("ส่ง Shift+↓ ไป task ถัดไปแล้ว (ข้าม Update)");
            await delay(600);
        }
        return;
    }
    const submitLabel = isQcMode() ? "ส่งงาน (QC)" : "Update";
    console.log(`✅ 4. กดปุ่ม ${submitLabel} สำเร็จ! (robustClick)`);
    markTaskCommittedAfterSuccessfulUpdate(pipelineTaskId);
    setStatus(
        isQcMode()
            ? "QC: ส่งงานแล้ว — รอ queue ส่ง task ใหม่"
            : "Valid: ส่งงานแล้ว — รอให้ระบบบันทึก"
    );

    await delay(1500);
    if (!isRunActive(runToken)) return;

    console.log("🔍 ตรวจสอบป๊อปอัป Ignore & Submit...");
    const pop = await clickPopupAndVerify(["Ignore & Submit"], {
        tries: 8,
        intervalMs: 500,
        waitDisappearMs: 2200,
    });
    if (pop.ok) {
        if (pop.reason !== "not_found") console.log("✅ 5. Popup ถูกกดและหายไปแล้ว");
    } else {
        console.warn("⚠️ 5. Popup ยังอยู่/ค้าง (ไม่มั่นใจว่ากดติด):", pop.reason);
        setStatus("Popup ค้าง: Ignore & Submit");
    }

    const postUpdateDelayMs = 2000;
    if (isQcMode()) {
        console.log(
            `⏳ Valid flow (QC): รอ ${(postUpdateDelayMs / 1000).toFixed(1)} วิ — ไม่ส่ง Shift+↓ (รอ queue)`
        );
        setStatus("QC: รอ queue ส่ง task ใหม่");
    } else {
        console.log(
            `⏳ Valid flow: รอ ${(postUpdateDelayMs / 1000).toFixed(1)} วิ หลัง Update ก่อนส่ง Shift+↓`
        );
        setStatus(`Valid: รอ ${(postUpdateDelayMs / 1000).toFixed(1)} วิ ก่อนเลื่อนไป task ถัดไป`);
    }
    await delay(postUpdateDelayMs);
    if (!isRunActive(runToken)) return;
    await closeQualityCheckFailedIfPresent({ runToken });
    if (!isRunActive(runToken)) return;
    if (!isQcMode() && (await goToNextTask({ runToken }))) {
        setStatus("ส่ง Shift+↓ ไป task ถัดไปแล้ว");
        await delay(600);
    }
}

setInterval(() => {
    if (!isAutoLikeMode() || !isAutoPilotOn || isProcessing) return;
    if (location.href !== lastSeenUrl) {
        const oldUrl = lastSeenUrl;
        lastSeenUrl = location.href;
        resetTaskGate("url_changed");
        console.log("[DingTag] URL changed:", oldUrl, "->", lastSeenUrl);
    }

    try {
        const classState = getClassificationSidebarState();
        const classified = scanClassificationTarget();
        const targetEl = classified?.targetEl || null;
        const classificationValue = classified?.classificationValue || "";

        const skippedUi = isTaskWasSkipped() || !!findCancelSkipButton();
        if (wasSkippedControlsVisible && !skippedUi) {
            markPostCancelSkipWindow("ui_cancel_skip");
        }
        wasSkippedControlsVisible = skippedUi;

        const currentTaskId = getCurrentTaskId();

        const needsPrep = needsPrePipelineAnnotationSteps();

        if (skippedUi && !postCancelSkipKickInFlight && !activeRecoveryTaskId) {
            const tid = getCurrentTaskId();
            if (tid) {
                void kickPostCancelSkipHandling(tid).catch((e) => {
                    console.warn("[DingTag] kick post-cancel unhandled:", e?.name, e?.message);
                    postCancelSkipKickInFlight = false;
                    isProcessing = false;
                    if (isAutoPilotOn) setStatus("post-cancel error — ลองใหม่");
                });
            }
            return;
        }

        if (needsPrep && currentTaskId && autoSkipNoClassificationEnabled) {
            const nowPrep = Date.now();
            if (noClassificationTaskId !== currentTaskId) {
                noClassificationTaskId = currentTaskId;
                noClassificationStartedAt = nowPrep;
            }
            const prepWaited = nowPrep - noClassificationStartedAt;
            const prepDelayMs = getWaveformRecoveryDelayMs(classState);

            if (
                !isProcessing &&
                !postCancelSkipKickInFlight &&
                !activeRecoveryTaskId &&
                canRunRecoveryForTask(currentTaskId)
            ) {
                if (
                    prepWaited >= prepDelayMs ||
                    prepWaited >= stuckTaskTimeoutMs
                ) {
                    if (
                        scheduleNoClassificationRecoveryFromAutopilot(
                            currentTaskId,
                            classState,
                            "ลาก region + Valid"
                        )
                    ) {
                        return;
                    }
                }
            }

            if (prepWaited >= stuckTaskTimeoutMs && !isProcessing) {
                if (isQcMode()) {
                    if (nowPrep - lastNoTargetLogAt > 2000) {
                        lastNoTargetLogAt = nowPrep;
                        setStatus(
                            `QC: task ${currentTaskId} ไม่มี Classification — รอ queue ส่ง task ใหม่`
                        );
                    }
                    return;
                }
                console.warn(
                    `[DingTag] task ${currentTaskId} ค้างไม่มี Classification เกิน ${(stuckTaskTimeoutMs / 1000).toFixed(1)} วิ → Shift+↓`
                );
                setStatus(`task ${currentTaskId} ไม่มี Classification → Shift+↓`);
                isProcessing = true;
                (async () => {
                    try {
                        await fallbackSkipNoClassification(currentTaskId);
                    } finally {
                        noClassificationTaskId = "";
                        noClassificationStartedAt = 0;
                        isProcessing = false;
                    }
                })();
                return;
            }

            if (nowPrep - lastNoTargetLogAt > 2000) {
                lastNoTargetLogAt = nowPrep;
                setStatus(
                    `task ${currentTaskId}: ${getClassificationWaitStatusLabel(classState, {
                        waitedMs: prepWaited,
                        maxWaitMs: prepDelayMs,
                    })}...`
                );
            }
            return;
        }

        if (targetEl) {
            // เจอ Classification แล้ว — รีเซ็ตตัวจับเวลา auto-skip
            if (noClassificationTaskId) {
                noClassificationTaskId = "";
                noClassificationStartedAt = 0;
            }
            if (!currentTaskId) {
                const now = Date.now();
                if (now - lastNoTargetLogAt > 5000) {
                    lastNoTargetLogAt = now;
                    console.log("⏳ เจอ Classification แล้ว แต่ยังอ่าน Task ID ไม่ได้");
                    setStatus("เจอ Classification แล้ว แต่ยังอ่าน Task ID ไม่ได้");
                }
                return;
            }

            // เช็คว่า task นี้เคยส่ง Update สำเร็จแล้ว (processedTaskIds) หรือเป็น task เดิมที่ claim ไว้แต่ยังไม่ commit (lastProcessedTaskId)
            if (currentTaskId === lastProcessedTaskId || processedTaskIds.has(currentTaskId)) {
                const now = Date.now();

                if (isQcMode()) {
                    if (now - lastNoTargetLogAt > 5000) {
                        lastNoTargetLogAt = now;
                        setStatus(`QC: task ${currentTaskId} ส่งแล้ว — รอ queue ส่ง task ใหม่`);
                    }
                    return;
                }

                // ถ้าเด้งกลับมา task ที่เคยทำแล้ว (อยู่ใน Set) → Shift+↑ กลับขึ้นไปหา task ใหม่
                // (เปลี่ยนจาก Shift+↓ → Shift+↑ ตามคำขอ user: เจอ task ซ้ำให้กลับขึ้นไป
                //  แทนที่จะลงไปต่อ เพราะลงไปต่อก็เป็น task ที่เคยทำแล้วเช่นกัน)
                if (processedTaskIds.has(currentTaskId) && currentTaskId !== lastProcessedTaskId) {
                    // นับว่า task นี้เด้งกลับมาเป็นครั้งที่เท่าไหร่ในหน้าต่าง duplicateLoopWindowMs
                    const encounterCount = recordDuplicateEncounter(currentTaskId);
                    const windowSec = (duplicateLoopWindowMs / 1000).toFixed(0);

                    // ถ้าซ้ำเกิน threshold ภายใน window → loop จริง
                    // force clear task history ทั้งหมดเพื่อให้ bot เริ่มนับใหม่ แล้วกด Shift+↓ ทะลุออก
                    // (เปิด/ปิดได้จาก toggle "Auto-Reset History on Loop" ใน settings —
                    //  ถ้าปิด: จะ fall through ไปยัง Shift+↑ ปกติ ไม่ล้างประวัติ)
                    if (autoResetHistoryEnabled && encounterCount >= duplicateLoopThreshold) {
                        const clearedCount = processedTaskIds.size;
                        processedTaskIds.clear();
                        duplicateTaskEncounters.clear();
                        console.log(
                            `🔁 task ${currentTaskId} เด้งกลับซ้ำ ${encounterCount} รอบใน ${windowSec} วิ → force clear history (${clearedCount} tasks) + Shift+↓ break loop`
                        );
                        setStatus(
                            `ซ้ำ ${encounterCount}/${duplicateLoopThreshold} ใน ${windowSec} วิ → ล้างประวัติ ${clearedCount} tasks + Shift+↓`
                        );
                        lastProcessedTaskId = currentTaskId;
                        isProcessing = true;
                        (async () => {
                            try {
                                await delay(DUPLICATE_SKIP_DELAY_MS);
                                const sent = await goToNextTask({ runToken: null });
                                if (sent) {
                                    console.log(
                                        `⏭️ duplicate-loop break: ส่ง Shift+↓ จาก task ${currentTaskId} แล้ว (history cleared)`
                                    );
                                } else {
                                    console.warn(
                                        `⚠️ duplicate-loop break: ส่ง Shift+↓ ไม่สำเร็จ (task ${currentTaskId})`
                                    );
                                }
                                await delay(DUPLICATE_SKIP_DELAY_MS);
                            } catch (e) {
                                console.warn(
                                    "[DingTag] duplicate-loop break error:",
                                    e?.name,
                                    e?.message
                                );
                            } finally {
                                isProcessing = false;
                            }
                        })();
                        return;
                    }

                    console.log(
                        `⏮️ task ${currentTaskId} เคยทำแล้ว (เด้งกลับ, รอบ ${encounterCount}/${duplicateLoopThreshold} ใน ${windowSec} วิ) → Shift+↑ กลับขึ้น (delay ${DUPLICATE_SKIP_DELAY_MS}ms)`
                    );
                    setStatus(
                        `task ${currentTaskId} เคยทำแล้ว (${encounterCount}/${duplicateLoopThreshold}) → Shift+↑ กลับขึ้น`
                    );
                    lastProcessedTaskId = currentTaskId;
                    isProcessing = true;
                    (async () => {
                        try {
                            await delay(DUPLICATE_SKIP_DELAY_MS);
                            const sent = await goToPreviousTask({ runToken: null });
                            if (sent) {
                                console.log(`⏮️ duplicate-skip: ส่ง Shift+↑ จาก task ${currentTaskId} แล้ว`);
                            }
                            await delay(DUPLICATE_SKIP_DELAY_MS);
                        } catch (e) {
                            console.warn("[DingTag] duplicate-skip error:", e?.name, e?.message);
                        } finally {
                            isProcessing = false;
                        }
                    })();
                    return;
                }

                // เริ่มจับเวลา stuck
                if (stuckTaskId !== currentTaskId) {
                    stuckTaskId = currentTaskId;
                    stuckTaskDetectedAt = now;
                }

                const stuckDuration = now - stuckTaskDetectedAt;

                if (stuckDuration >= stuckTaskTimeoutMs) {
                    if (isQcMode()) {
                        if (now - lastNoTargetLogAt > 5000) {
                            lastNoTargetLogAt = now;
                            setStatus(`QC: task ${currentTaskId} ค้าง — รอ queue ส่ง task ใหม่`);
                        }
                        return;
                    }
                    // หมดเวลารอ → บังคับ Shift+↓ ไป task ถัดไป
                    console.log(
                        `⏭️ task ${currentTaskId} ค้างเกิน ${(stuckTaskTimeoutMs / 1000).toFixed(1)} วิ → บังคับ Shift+↓`
                    );
                    setStatus(`task ${currentTaskId} ค้าง → บังคับไป task ถัดไป`);
                    stuckTaskId = "";
                    stuckTaskDetectedAt = 0;
                    lastProcessedTaskId = "";
                    isProcessing = true;
                    (async () => {
                        try {
                            const sent = await goToNextTask({ runToken: null });
                            if (sent) {
                                console.log(`⏭️ stuck-skip: ส่ง Shift+↓ จาก task ${currentTaskId} แล้ว`);
                            } else {
                                console.warn(`⚠️ stuck-skip: ส่ง Shift+↓ ไม่สำเร็จ (task ${currentTaskId})`);
                            }
                            await delay(1000);
                        } catch (e) {
                            console.warn("[DingTag] stuck-skip error:", e?.name, e?.message);
                        } finally {
                            isProcessing = false;
                        }
                    })();
                    return;
                }

                if (now - lastNoTargetLogAt > 5000) {
                    lastNoTargetLogAt = now;
                    const remaining = Math.max(0, (stuckTaskTimeoutMs - stuckDuration) / 1000);
                    console.log(`⏳ ข้าม task เดิม: ${currentTaskId} (รอ task ใหม่ — timeout อีก ${remaining.toFixed(1)} วิ)`);
                    setStatus(`รอ task ใหม่ (${currentTaskId}) — timeout ${remaining.toFixed(1)} วิ`);
                }
                return;
            }

            // task เปลี่ยนแล้ว → reset stuck tracker
            if (stuckTaskId) {
                stuckTaskId = "";
                stuckTaskDetectedAt = 0;
            }

            isProcessing = true;
            // claim task — บันทึกว่า "ส่ง Update สำเร็จแล้ว" เฉพาะหลังกด Update ผ่าน (processedTaskIds)
            lastProcessedTaskId = currentTaskId;
            setStatus(`พบ target task ${currentTaskId} แล้ว กำลังทำงาน...`);
            scrollSidebarToActiveTask();

            (async () => {
                const pipelineTaskId = currentTaskId;
                try {
                    const runToken = ++runTokenCounter;
                    activeRunToken = runToken;
                    const cycleStartAt = Date.now();

                    await runTranscriptionPipeline(runToken, cycleStartAt, pipelineTaskId, {
                        classificationValue,
                        skipInitialClassificationClick: false,
                        forceTranscribeFromInvalid: false,
                    });
                } catch (e) {
                    console.error("Sequence Error:", e);
                    setStatus("เกิด error (ดู Console)");
                } finally {
                    releaseTaskClaimIfUncommitted(pipelineTaskId, "pipeline_end");
                    await delay(1500);
                    isProcessing = false;
                    activeRunToken = 0;
                    activeTimeouts = [];
                    console.log("🔄 จบวงจร เตรียมรอ task ใหม่...");
                    if (isAutoPilotOn) {
                        setStatus(
                            isQcMode() ? "QC: กำลังรอ task ใหม่จาก queue..." : "กำลังรอ task ใหม่..."
                        );
                    }
                }
            })();
        } else {
            const now = Date.now();
            const idleTaskId = getCurrentTaskId();
            if (noClassificationTaskId) {
                noClassificationTaskId = "";
                noClassificationStartedAt = 0;
            }
            if (now - lastNoTargetLogAt > 5000) {
                lastNoTargetLogAt = now;
                if (skippedUi) {
                    setStatus("Was skipped — bot กำลังกด Cancel skip...");
                } else if (!idleTaskId) {
                    setStatus("รอ Task ID บนหน้า Labeling...");
                } else if (
                    processedTaskIds.has(idleTaskId) &&
                    !needsPrePipelineAnnotationSteps()
                ) {
                    setStatus(
                        isQcMode()
                            ? `QC: task ${idleTaskId} ส่งแล้ว — รอ queue`
                            : `task ${idleTaskId} ส่ง Update แล้ว — รอ task ใหม่`
                    );
                } else if (needsPrePipelineAnnotationSteps()) {
                    const prepWaited = noClassificationStartedAt
                        ? now - noClassificationStartedAt
                        : 0;
                    setStatus(
                        `task ${idleTaskId}: ${getClassificationWaitStatusLabel(classState, {
                            waitedMs: prepWaited,
                            maxWaitMs: getWaveformRecoveryDelayMs(classState),
                        })}...`
                    );
                } else {
                    setStatus(`task ${idleTaskId}: รอเงื่อนไข pipeline · ${getNoTargetFilterStatusHint()}`);
                }
            }

                // ─────── Idle recovery: Auto → Filter | QC → QC All Tasks (Data Manager) ───────
                if (
                    extensionMode === "auto" &&
                    autoFilterEnabled &&
                    !filterApplyInFlight &&
                    isFilterButtonPresent()
                ) {
                    if (noTargetIdleSince === 0) {
                        noTargetIdleSince = now;
                    }
                    const idleFor = now - noTargetIdleSince;
                    const sinceLast = now - lastAutoFilterAt;
                    if (
                        idleFor >= NO_TARGET_AUTO_FILTER_AFTER_MS &&
                        sinceLast >= AUTO_FILTER_COOLDOWN_MS
                    ) {
                        lastAutoFilterAt = now;
                        noTargetIdleSince = 0;
                        isProcessing = true;
                        (async () => {
                            try {
                                await runAutoFilterRecovery();
                            } catch (e) {
                                console.warn("[DingTag] auto-filter recovery error:", e?.name, e?.message);
                            } finally {
                                isProcessing = false;
                            }
                        })();
                    }
                } else if (isQcMode() && !qcAllTasksInFlight && isQcAllTasksButtonPresent()) {
                    if (noTargetIdleSince === 0) {
                        noTargetIdleSince = now;
                    }
                    const idleFor = now - noTargetIdleSince;
                    const sinceLastQc = now - lastQcAllTasksAt;
                    if (
                        idleFor >= NO_TARGET_AUTO_FILTER_AFTER_MS &&
                        sinceLastQc >= QC_ALL_TASKS_COOLDOWN_MS
                    ) {
                        lastQcAllTasksAt = now;
                        noTargetIdleSince = 0;
                        isProcessing = true;
                        (async () => {
                            try {
                                await runQcAllTasksRecovery();
                            } catch (e) {
                                console.warn("[DingTag] QC All Tasks recovery error:", e?.name, e?.message);
                            } finally {
                                isProcessing = false;
                            }
                        })();
                    }
                } else {
                    noTargetIdleSince = 0;
                }
        }
    } catch (e) {
        console.warn("[DingTag] polling error:", e?.name, e?.message);
    }
}, 500);
