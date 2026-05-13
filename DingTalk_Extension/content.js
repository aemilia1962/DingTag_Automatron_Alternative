console.log("🚀 DingTalk Auto-Pilot V21 (Local API) Loaded!");

const LOCAL_TRANSCRIBE_URL = "http://127.0.0.1:54321/api/transcribe";
const LOCAL_FORMALIZE_URL = "http://127.0.0.1:54321/api/formalize";
const LOCAL_PHYSICAL_CLICK_URL = "http://127.0.0.1:54321/api/physical_click";

let isAutoPilotOn = false;
let isProcessing = false;
let readDelay = 1500;
let moveDelay = 8000;
/** หน่วงอย่างน้อย (มิลลิวิ) จากจุดเริ่มงานจนถึงก่อนกด Accept — ถ้างานจบเร็วเกินจะรอให้ครบ; ถ้าเกินเวลานี้อยู่แล้วไม่รอเพิ่ม */
let minElapsedBeforeAcceptMs = Math.max(
    0,
    parseInt(localStorage.getItem("dingtag_min_elapsed_before_accept_ms") || "0", 10) || 0
);
// บังคับใช้เสมอ: กรอง Sensitive + Non-target auto invalid (ไม่มี toggle ใน Settings)
let autoSkipNoClassificationEnabled =
    localStorage.getItem("dingtag_auto_skip_no_classification") !== "0";
let noClassificationTimeoutMs = Math.max(
    1000,
    parseInt(localStorage.getItem("dingtag_no_classification_timeout_ms") || "8000", 10) || 8000
);
let activeTimeouts = [];
let lastNoTargetLogAt = 0;
let runTokenCounter = 0;
let activeRunToken = 0;
let lastProcessedTaskId = "";
const processedTaskIds = new Set();
let lastSeenUrl = location.href;
// ติดตาม task ใหม่ที่ยังไม่เจอ Classification — ใช้คำนวณว่าควร auto-skip เมื่อใด
let noClassificationTaskId = "";
let noClassificationStartedAt = 0;
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
// Duplicate skip delay: หน่วงก่อน Shift+↓ เมื่อเจอ task ที่เคยทำแล้ว
let duplicateSkipDelayMs = Math.max(
    0,
    parseInt(localStorage.getItem("dingtag_duplicate_skip_delay_ms") || "300", 10) || 300
);
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
    console.log("🛑 Kill Switch: ยกเลิกการกระทำทั้งหมด! (cleared processed history)");
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

async function fetchAudioAsBase64() {
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
    console.log(...logParts);
    return { ok: true, data };
}

/** สั่ง formal จัดคำจากข้อความที่มีอยู่แล้ว */
async function postFormalize(text) {
    const payload = JSON.stringify({ text });
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

const title = document.createElement("div");
title.innerText = "🤖 DingTalk V21 (Local API)";
title.style.fontWeight = "bold";
title.style.fontSize = "13px";
title.style.lineHeight = "1.2";
title.style.flex = "1";

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

const toggleBtn = document.createElement("button");
toggleBtn.innerText = "OFF - คลิกเพื่อเปิด";
toggleBtn.style.width = "100%";
toggleBtn.style.padding = "10px";
toggleBtn.style.backgroundColor = "#dc3545";
toggleBtn.style.color = "white";
toggleBtn.style.border = "none";
toggleBtn.style.borderRadius = "6px";
toggleBtn.style.cursor = "pointer";
panel.appendChild(toggleBtn);

const statusLabel = document.createElement("div");
statusLabel.style.fontSize = "12px";
statusLabel.style.marginTop = "10px";
statusLabel.style.padding = "8px";
statusLabel.style.borderRadius = "8px";
statusLabel.style.backgroundColor = "#343a40";
statusLabel.innerText = "สถานะ: OFF";
panel.appendChild(statusLabel);

const settingsContainer = document.createElement("div");
settingsContainer.style.marginTop = "10px";
settingsContainer.style.paddingTop = "10px";
settingsContainer.style.borderTop = "1px solid rgba(255,255,255,0.12)";
settingsContainer.style.display = "none";

const readLabel = document.createElement("div");
readLabel.style.fontSize = "12px";
readLabel.style.marginTop = "8px";
settingsContainer.appendChild(readLabel);
const readSlider = document.createElement("input");
readSlider.type = "range";
readSlider.min = "500";
readSlider.max = "5000";
readSlider.step = "100";
readSlider.value = readDelay;
readSlider.style.width = "100%";
settingsContainer.appendChild(readSlider);

const moveLabel = document.createElement("div");
moveLabel.style.fontSize = "12px";
moveLabel.style.marginTop = "10px";
settingsContainer.appendChild(moveLabel);
const moveSlider = document.createElement("input");
moveSlider.type = "range";
moveSlider.min = "300";
moveSlider.max = "15000";
moveSlider.step = "100";
moveSlider.value = moveDelay;
moveSlider.style.width = "100%";
settingsContainer.appendChild(moveSlider);

const minAcceptLabel = document.createElement("div");
minAcceptLabel.style.fontSize = "12px";
minAcceptLabel.style.marginTop = "10px";
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
autoSkipLabel.innerText = "⏭️ Auto-Skip (ไม่มี Classification)";
autoSkipLabel.style.fontSize = "12px";
autoSkipLabel.style.cursor = "pointer";
autoSkipRow.appendChild(autoSkipLabel);

const autoSkipToggle = document.createElement("input");
autoSkipToggle.type = "checkbox";
autoSkipToggle.checked = autoSkipNoClassificationEnabled;
autoSkipToggle.style.cursor = "pointer";
autoSkipToggle.title = "ถ้า task ใหม่ไม่มี Classification ภายในเวลาที่ตั้ง → Shift+↓ ข้าม";
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
    console.log("[DingTag] Auto-skip (no Classification):", autoSkipNoClassificationEnabled ? "ON" : "OFF");
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
autoSkipTimeoutSlider.title = "รอ Classification นานสุดเท่านี้ ก่อน Shift+↓ ข้าม";
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

const dupSkipLabel = document.createElement("div");
dupSkipLabel.style.color = "#ccc";
dupSkipLabel.style.fontSize = "12px";
dupSkipLabel.style.marginTop = "8px";
settingsContainer.appendChild(dupSkipLabel);
const dupSkipSlider = document.createElement("input");
dupSkipSlider.type = "range";
dupSkipSlider.min = "0";
dupSkipSlider.max = "3000";
dupSkipSlider.step = "100";
dupSkipSlider.value = String(duplicateSkipDelayMs);
dupSkipSlider.style.width = "100%";
dupSkipSlider.title = "หน่วงก่อน Shift+↓ เมื่อเจอ task ซ้ำ (เด้งกลับ)";
settingsContainer.appendChild(dupSkipSlider);

dupSkipSlider.addEventListener("input", (e) => {
    duplicateSkipDelayMs = Math.max(0, parseInt(e.target.value, 10) || 300);
    localStorage.setItem("dingtag_duplicate_skip_delay_ms", String(duplicateSkipDelayMs));
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
// Toggle: เปิด/ปิด ฟีเจอร์ทั้งหมด
const filterToggleRow = document.createElement("div");
filterToggleRow.style.display = "flex";
filterToggleRow.style.alignItems = "center";
filterToggleRow.style.justifyContent = "space-between";
filterToggleRow.style.gap = "8px";
filterToggleRow.style.marginTop = "12px";
settingsContainer.appendChild(filterToggleRow);

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
settingsContainer.appendChild(filterUserLabel);

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
settingsContainer.appendChild(filterUserInput);

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
settingsContainer.appendChild(applyFilterBtn);

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

// ปุ่ม Clear History (ล้างประวัติ task ที่เคยทำ)
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
    console.log(`🧹 ล้างประวัติ task ที่เคยทำ (${count} รายการ) — สามารถทำซ้ำได้อีก`);
    setStatus(`ล้างประวัติแล้ว (${count} tasks) — พร้อมทำงานใหม่`);
});
settingsContainer.appendChild(clearHistoryBtn);

panel.appendChild(settingsContainer);
document.body.appendChild(panel);

function updateLabels() {
    readLabel.innerText = `⏱️ รอก่อนคลิกแรก: ${(readDelay / 1000).toFixed(1)} วิ`;
    moveLabel.innerText = `🖱️ ระยะห่างสองคลิก: ${(moveDelay / 1000).toFixed(1)} วิ`;
    minAcceptLabel.innerText =
        minElapsedBeforeAcceptMs <= 0
            ? `🛡️ ก่อนกด Accept อย่างน้อย: ปิด (ไม่บังคับ)`
            : `🛡️ ก่อนกด Accept อย่างน้อย: ${(minElapsedBeforeAcceptMs / 1000).toFixed(0)} วิ (งานเร็วเกินจะรอให้ครบ)`;
    autoSkipTimeoutLabel.innerText = `⏭️ Auto-Skip timeout: ${(noClassificationTimeoutMs / 1000).toFixed(1)} วิ`;
    stuckTaskLabel.innerText = `🔄 Stuck Task timeout: ${(stuckTaskTimeoutMs / 1000).toFixed(0)} วิ`;
    dupSkipLabel.innerText = `⏩ Duplicate Skip delay: ${duplicateSkipDelayMs} ms`;
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
readSlider.addEventListener("input", (e) => {
    readDelay = parseInt(e.target.value);
    updateLabels();
});
moveSlider.addEventListener("input", (e) => {
    moveDelay = parseInt(e.target.value);
    updateLabels();
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
    for (let i = 1; i <= maxTries; i++) {
        if (runToken != null && !isRunActive(runToken)) {
            return { ok: false, reason: "stale" };
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
        setStatus("Invalid flow: ส่งงานแล้ว — รอ 2 วิ ก่อน Shift+↓");
        // หน่วง 2 วิ หลัง Update เหมือน Valid/Verified flows
        await delay(2000);
        if (runToken != null && !isRunActive(runToken)) return;
        // เช็ค + ปิด Quality Check Failed popup (ถ้ามี) ก่อนเลื่อนไป task ถัดไป
        await closeQualityCheckFailedIfPresent({ runToken });
        if (runToken != null && !isRunActive(runToken)) return;
        if (await goToNextTask({ runToken })) {
            setStatus("Invalid flow: ส่ง Shift+↓ ไป task ถัดไปแล้ว");
            await delay(600);
        }
    } else if (updRes.reason === "stale") {
        return;
    } else {
        console.log("❌ Invalid flow: ปุ่ม Update ยัง disabled หลังลอง 2 ครั้ง -> Shift+↓");
        setStatus("Invalid flow: ข้าม Update (ปุ่มยัง disabled) → ไป task ถัดไป");
        await delay(500);
        if (runToken != null && !isRunActive(runToken)) return;
        if (await goToNextTask({ runToken })) {
            setStatus("Invalid flow: ส่ง Shift+↓ ไป task ถัดไปแล้ว (ข้าม Update)");
            await delay(600);
        }
    }
}

async function runInvalidDataMissingAcceptFlow(reasonText = "invalid flow", runToken, cycleStartAt) {
    return runInvalidReasonAcceptFlow(reasonText, {
        checkboxName: "Data Missing",
        menuNeedles: ["data missing", "datamissing"],
        logLabel: "Data Missing",
        runToken,
        cycleStartAt,
    });
}

async function runInvalidNonTargetLanguageAcceptFlow(reasonText = "non-target language", runToken, cycleStartAt) {
    return runInvalidReasonAcceptFlow(reasonText, {
        checkboxName: "Non-Target Language",
        menuNeedles: ["non-target", "non target language", "nontarget language", "non target", "nontarget"],
        logLabel: "Non-Target Language",
        runToken,
        cycleStartAt,
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
 * Flow ใหม่: เจอ Classification = Invalid → กด Esc → Optimized → Has Errors → กด Update
 * (แทนพฤติกรรมเดิมที่ Shift+↓ ข้ามทั้งงาน)
 *
 * ขั้นตอน:
 *  1) ส่ง Escape เพื่อปิด popup/dropdown ที่อาจค้างอยู่
 *  2) คลิก radio "Optimized" — รอ 1 วิ
 *  3) คลิก radio "Has Errors"
 *  4) รอเวลาขั้นต่ำก่อน Accept ตามที่ตั้งไว้ (ถ้ามี)
 *  5) blur active element + Esc อีกครั้ง ก่อนกด Update
 *  6) Physical click ปุ่ม Update (เลื่อนเมาส์จริงผ่าน Python pyautogui)
 *  7) ตรวจ popup "Ignore & Submit" ถ้าโผล่ก็ปิดให้
 *  8) Shift+↓ ไป task ถัดไป
 */
async function runInvalidToVerifiedFlow(runToken, cycleStartAt) {
    console.log("🚩 Invalid flow: Esc → Optimized → Has Errors → Physical click Update");
    setStatus("Invalid — กด Esc แล้วเปลี่ยนเป็น Optimized → Has Errors");

    if (dispatchEscape()) {
        console.log("⎋ Invalid flow: ส่ง Escape ก่อนคลิก Optimized");
    }
    blurAnyActiveElement();
    await delay(400);
    if (!isRunActive(runToken)) return;

    // กด Optimized ก่อน
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

    // กด Has Errors
    const errRes = await clickHasErrorsRadio({ tries: 8, intervalMs: 400, runToken });
    if (errRes.reason === "stale") return;
    if (!errRes.ok) {
        console.warn("⚠️ Invalid flow: ไม่พบ radio Has Errors → Shift+↓ ข้าม");
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

    if (cycleStartAt != null) {
        await ensureMinElapsedBeforeAccept(runToken, cycleStartAt);
        if (!isRunActive(runToken)) return;
    }

    if (blurAnyActiveElement()) {
        console.log("👀 Invalid flow: blur active element ก่อนกด Update");
    }
    if (dispatchEscape()) {
        console.log("⎋ Invalid flow: ส่ง Escape ก่อนกด Update");
    }
    await delay(300);
    if (!isRunActive(runToken)) return;

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
        setStatus("Invalid flow: ส่งงานแล้ว — รอให้ระบบบันทึก");
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
        console.log(
            `⏳ Invalid flow: รอ ${(postUpdateDelayMs / 1000).toFixed(1)} วิ หลัง Update ก่อนส่ง Shift+↓`
        );
        setStatus(
            `Invalid flow: รอ ${(postUpdateDelayMs / 1000).toFixed(1)} วิ ก่อนเลื่อนไป task ถัดไป`
        );
        await delay(postUpdateDelayMs);
        if (!isRunActive(runToken)) return;
        // เช็ค + ปิด Quality Check Failed popup (ถ้ามี) ก่อนเลื่อนไป task ถัดไป
        await closeQualityCheckFailedIfPresent({ runToken });
        if (!isRunActive(runToken)) return;
        if (await goToNextTask({ runToken })) {
            setStatus("Invalid flow: ส่ง Shift+↓ ไป task ถัดไปแล้ว");
            await delay(600);
        }
    } else {
        console.log("❌ Invalid flow: ปุ่ม Update ยัง disabled → Shift+↓");
        setStatus("Invalid flow: ข้าม Update (disabled) → ไป task ถัดไป");
        await delay(500);
        if (!isRunActive(runToken)) return;
        if (await goToNextTask({ runToken })) {
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

// Hotkey: Shift+ArrowUp → applyMyAnnotatorFilter
// - ทำงานก็ต่อเมื่อ Auto-Filter toggle ON และเจอปุ่ม Filters บนหน้านี้
// - ไม่ทำงานถ้ากำลังพิมพ์ในช่อง input/textarea/contenteditable (ปล่อยให้ event ผ่านไป)
// - capture phase + preventDefault เพื่อกัน LSF/Browser หยิบ event ไปก่อน
document.addEventListener(
    "keydown",
    (e) => {
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

setInterval(() => {
    if (!isAutoPilotOn || isProcessing) return;
    if (location.href !== lastSeenUrl) {
        const oldUrl = lastSeenUrl;
        lastSeenUrl = location.href;
        resetTaskGate("url_changed");
        console.log("[DingTag] URL changed:", oldUrl, "->", lastSeenUrl);
    }

    try {
        let targetEl = null;
        let classificationValue = "";
        const items = document.querySelectorAll(".lsf-annotation-items__result-item");
        for (let item of items) {
            const label = item.querySelector(".lsf-annotation-items__result-label");
            if (!label) continue;
            if (!label.textContent || !label.textContent.includes("Classification")) continue;

            const valueEl = item.querySelector(".lsf-annotation-items__result-value");
            if (!valueEl) continue;

            const valueText = valueEl.textContent ? valueEl.textContent.trim().toLowerCase() : "";
            if (valueText === "valid" || valueText === "invalid") {
                targetEl = valueEl.querySelector("em") || valueEl;
                classificationValue = valueText;
                break;
            }
        }

        const currentTaskId = getCurrentTaskId();
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

            // เช็คว่า task นี้เคยทำแล้ว (ทั้ง lastProcessedTaskId และ Set ทั้งหมด)
            if (currentTaskId === lastProcessedTaskId || processedTaskIds.has(currentTaskId)) {
                const now = Date.now();

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
                                await delay(duplicateSkipDelayMs);
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
                                await delay(duplicateSkipDelayMs);
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
                        `⏮️ task ${currentTaskId} เคยทำแล้ว (เด้งกลับ, รอบ ${encounterCount}/${duplicateLoopThreshold} ใน ${windowSec} วิ) → Shift+↑ กลับขึ้น (delay ${duplicateSkipDelayMs}ms)`
                    );
                    setStatus(
                        `task ${currentTaskId} เคยทำแล้ว (${encounterCount}/${duplicateLoopThreshold}) → Shift+↑ กลับขึ้น`
                    );
                    lastProcessedTaskId = currentTaskId;
                    isProcessing = true;
                    (async () => {
                        try {
                            await delay(duplicateSkipDelayMs);
                            const sent = await goToPreviousTask({ runToken: null });
                            if (sent) {
                                console.log(`⏮️ duplicate-skip: ส่ง Shift+↑ จาก task ${currentTaskId} แล้ว`);
                            }
                            await delay(duplicateSkipDelayMs);
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
            lastProcessedTaskId = currentTaskId;
            processedTaskIds.add(currentTaskId);
            setStatus(`พบ target task ${currentTaskId} แล้ว กำลังทำงาน...`);
            scrollSidebarToActiveTask();

            (async () => {
                try {
                    const runToken = ++runTokenCounter;
                    activeRunToken = runToken;
                    const cycleStartAt = Date.now();

                    await delay(readDelay);
                    if (!isRunActive(runToken)) return;

                    targetEl.click();
                    console.log("🖱️ 1. กด Classification เรียบร้อย!");

                    await delay(1000);
                    if (!isRunActive(runToken)) return;

                    if (classificationValue === "invalid") {
                        console.log("⚡ Classification = Invalid -> Esc → Optimized → Has Errors → Update");
                        await runInvalidToVerifiedFlow(runToken, cycleStartAt);
                        return;
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

                        if (data.isSensitive === true) {
                            console.warn("⚠️ เนื้อหาอ่อนไหว (Politics/War/Monarchy) — ข้ามการวางข้อความ และคงค่าเดิมไว้");
                            setStatus("Sensitive — ส่ง invalid flow");
                            await runInvalidDataMissingAcceptFlow("Sensitive content", runToken, cycleStartAt);
                            return;
                        }

                        const qc = data.qc || {};

                        // Hallucination guard log — ถ้า Python server ลอง fallback model มา ให้ผู้ใช้เห็นใน log/status
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
                            warnParts.push("— ข้ามการวางข้อความ และคงค่าเดิมไว้");
                            console.warn(...warnParts);
                            const statusSuffix = qc.foreignScript
                                ? ` (${qc.foreignScript})`
                                : "";
                            setStatus(`Non-Target${statusSuffix} — ส่ง invalid flow`);
                            await runInvalidNonTargetLanguageAcceptFlow(
                                qc.foreignScript
                                    ? `Non-target language (foreign script: ${qc.foreignScript})`
                                    : "Non-target language (QC)",
                                runToken,
                                cycleStartAt
                            );
                            return;
                        }
                        // Step A: วาง raw transcript ก่อน เพื่อให้มั่นใจว่า "ดูดเสียงมาจริง"
                        safeSetTextarea(runToken, ta, data.text || "", "raw");
                        setStatus("วางข้อความดิบแล้ว (กำลังจัดคำ)...");

                        // Step B: สั่ง formal จัดคำ แล้ววางทับ
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

                    await delay(moveDelay);
                    if (!isRunActive(runToken)) return;

                    await ensureMinElapsedBeforeAccept(runToken, cycleStartAt);
                    if (!isRunActive(runToken)) return;

                    const refocusMain = refocusClassification();
                    if (refocusMain) {
                        console.log("🖱️ ก่อนส่งงาน: refocus Classification (<em>) แล้ว");
                    } else {
                        console.warn("⚠️ ก่อนส่งงาน: ไม่พบ Classification value element");
                    }

                    // Valid flow: ก่อนกด Update → blur active element + กด Escape
                    // จากนั้นใช้ Physical click (Python pyautogui) เลื่อนเมาส์จริง ๆ ไปกดปุ่ม Update
                    // เหมือนกับ Invalid → Verified flow เพื่อให้ Label Studio รับ click แน่นอน
                    if (blurAnyActiveElement()) {
                        console.log("👀 Valid flow: blur active element ก่อนกด Update");
                    }
                    if (dispatchEscape()) {
                        console.log("⎋ Valid flow: ส่ง Escape ก่อนกด Update");
                    }
                    await delay(300);
                    if (!isRunActive(runToken)) return;

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
                        console.log("❌ 4. ข้ามการกด Update (ปุ่มยัง disabled หลังลอง 3 ครั้ง) -> Shift+↓");
                        setStatus("ข้าม Update (ปุ่มยัง disabled) → ไป task ถัดไป");
                        await delay(500);
                        if (!isRunActive(runToken)) return;
                        if (await goToNextTask({ runToken })) {
                            setStatus("ส่ง Shift+↓ ไป task ถัดไปแล้ว (ข้าม Update)");
                            await delay(600);
                        }
                        return;
                    }
                    console.log("✅ 4. กดปุ่ม Update สำเร็จ! (robustClick)");
                    setStatus("Valid: ส่งงานแล้ว — รอให้ระบบบันทึก");

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

                    // หน่วงเพิ่มก่อนส่ง Shift+↓ ตามคำสั่งผู้ใช้ — "หลังจากกด Update ดีเล 2 วิ"
                    const postUpdateDelayMs = 2000;
                    console.log(
                        `⏳ Valid flow: รอ ${(postUpdateDelayMs / 1000).toFixed(1)} วิ หลัง Update ก่อนส่ง Shift+↓`
                    );
                    setStatus(
                        `Valid: รอ ${(postUpdateDelayMs / 1000).toFixed(1)} วิ ก่อนเลื่อนไป task ถัดไป`
                    );
                    await delay(postUpdateDelayMs);
                    if (!isRunActive(runToken)) return;
                    // เช็ค + ปิด Quality Check Failed popup (ถ้ามี) ก่อนเลื่อนไป task ถัดไป
                    await closeQualityCheckFailedIfPresent({ runToken });
                    if (!isRunActive(runToken)) return;
                    if (await goToNextTask({ runToken })) {
                        setStatus("ส่ง Shift+↓ ไป task ถัดไปแล้ว");
                        await delay(600);
                    }
                } catch (e) {
                    console.error("Sequence Error:", e);
                    setStatus("เกิด error (ดู Console)");
                } finally {
                    await delay(1500);
                    isProcessing = false;
                    activeRunToken = 0;
                    activeTimeouts = [];
                    console.log("🔄 จบวงจร เตรียมรอ task ใหม่...");
                    if (isAutoPilotOn) setStatus("กำลังรอ task ใหม่...");
                }
            })();
        } else {
            const now = Date.now();
            const currentTaskId = getCurrentTaskId();

            if (
                autoSkipNoClassificationEnabled &&
                currentTaskId &&
                currentTaskId !== lastProcessedTaskId
            ) {
                if (noClassificationTaskId !== currentTaskId) {
                    // เริ่มต้นการรอ task ใหม่
                    noClassificationTaskId = currentTaskId;
                    noClassificationStartedAt = now;
                    console.log(
                        `⏳ task ใหม่ (${currentTaskId}) ยังไม่เจอ Classification — รอสูงสุด ${(noClassificationTimeoutMs / 1000).toFixed(1)} วิ ก่อน Shift+↓`
                    );
                    setStatus(`task ${currentTaskId}: รอ Classification...`);
                } else {
                    const waited = now - noClassificationStartedAt;
                    if (waited >= noClassificationTimeoutMs) {
                        // หมดเวลารอ → Shift+↓ ข้าม
                        console.log(
                            `⏭️ task ${currentTaskId}: ไม่มี Classification เกิน ${noClassificationTimeoutMs}ms → Shift+↓ ข้าม`
                        );
                        setStatus(`task ${currentTaskId}: ไม่มี Classification → Shift+↓`);
                        const skipTaskId = currentTaskId;
                        lastProcessedTaskId = skipTaskId;
                        noClassificationTaskId = "";
                        noClassificationStartedAt = 0;
                        isProcessing = true;
                        (async () => {
                            try {
                                const sent = await goToNextTask({ runToken: null });
                                if (sent) {
                                    console.log(`⏭️ auto-skip: ส่ง Shift+↓ จาก task ${skipTaskId} แล้ว`);
                                } else {
                                    console.warn(`⚠️ auto-skip: ส่ง Shift+↓ ไม่สำเร็จ (task ${skipTaskId})`);
                                }
                                await delay(800);
                            } catch (e) {
                                console.warn("[DingTag] auto-skip error:", e?.name, e?.message);
                            } finally {
                                isProcessing = false;
                            }
                        })();
                        return;
                    }
                    if (now - lastNoTargetLogAt > 5000) {
                        lastNoTargetLogAt = now;
                        const remaining = Math.max(0, (noClassificationTimeoutMs - waited) / 1000);
                        console.log(
                            `⏳ รอ Classification ใน task ${currentTaskId} อีก ~${remaining.toFixed(1)} วิ ก่อน Shift+↓`
                        );
                        setStatus(
                            `task ${currentTaskId}: รอ Classification (${remaining.toFixed(1)} วิ)`
                        );
                    }
                }
            } else {
                // ไม่ครบเงื่อนไข auto-skip — รีเซ็ตการติดตามถ้ามี
                if (noClassificationTaskId) {
                    noClassificationTaskId = "";
                    noClassificationStartedAt = 0;
                }
                if (now - lastNoTargetLogAt > 5000) {
                    lastNoTargetLogAt = now;
                    console.log(
                        "⏳ ON อยู่ แต่ยังไม่เจอ target (Classification: Valid/Invalid) — ตรวจหน้าเว็บ/DOM/สิทธิ์ Extension"
                    );
                    setStatus("ยังไม่เจอ target (รอ Classification Valid/Invalid...)");
                }

                // ─────── Auto-Filter recovery: ถ้า bot ไม่เจอ target นาน → apply filter อัตโนมัติ ───────
                // เงื่อนไข:
                //   - bot ON อยู่ (อยู่ใน polling loop แล้ว = isAutoPilotOn = true)
                //   - autoFilterEnabled toggle ON
                //   - เจอปุ่ม Filters บนหน้านี้
                //   - filter ไม่ได้กำลังทำงาน
                //   - "ไม่เจอ target" ติดต่อกัน ≥ NO_TARGET_AUTO_FILTER_AFTER_MS
                //   - cooldown ผ่านแล้ว (กัน loop)
                if (autoFilterEnabled && !filterApplyInFlight && isFilterButtonPresent()) {
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
                                console.warn(
                                    "[DingTag] Auto-Filter recovery error:",
                                    e?.name,
                                    e?.message
                                );
                            } finally {
                                await delay(1500);
                                isProcessing = false;
                            }
                        })();
                    }
                } else if (noTargetIdleSince !== 0) {
                    // เงื่อนไขใดเงื่อนไขหนึ่งหายไป → รีเซ็ตตัวจับเวลา
                    noTargetIdleSince = 0;
                }
            }
        }
    } catch (e) {
        isProcessing = false;
    }
}, 1000);
