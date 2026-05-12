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
let sensitiveFilterEnabled = localStorage.getItem("dingtag_sensitive_filter_enabled") !== "0";
let nonTargetAutoInvalidEnabled = localStorage.getItem("dingtag_non_target_auto_invalid") !== "0";
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

function clearAllTasks() {
    activeTimeouts.forEach(t => clearTimeout(t));
    activeTimeouts = [];
    isProcessing = false;
    activeRunToken = 0;
    resetTaskGate("manual_stop");
    processedTaskIds.clear();
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

const sensitiveRow = document.createElement("div");
sensitiveRow.style.display = "flex";
sensitiveRow.style.alignItems = "center";
sensitiveRow.style.justifyContent = "space-between";
sensitiveRow.style.gap = "8px";
sensitiveRow.style.marginTop = "12px";
settingsContainer.appendChild(sensitiveRow);

const sensitiveLabel = document.createElement("label");
sensitiveLabel.innerText = "🛡️ กรองเนื้อหา Sensitive";
sensitiveLabel.style.fontSize = "12px";
sensitiveLabel.style.cursor = "pointer";
sensitiveRow.appendChild(sensitiveLabel);

const sensitiveToggle = document.createElement("input");
sensitiveToggle.type = "checkbox";
sensitiveToggle.checked = sensitiveFilterEnabled;
sensitiveToggle.style.cursor = "pointer";
sensitiveToggle.title = "เปิด/ปิด การกันข้อความอ่อนไหว";
sensitiveRow.appendChild(sensitiveToggle);

sensitiveLabel.addEventListener("click", () => {
    sensitiveToggle.checked = !sensitiveToggle.checked;
    sensitiveToggle.dispatchEvent(new Event("change"));
});

sensitiveToggle.addEventListener("change", () => {
    sensitiveFilterEnabled = sensitiveToggle.checked;
    localStorage.setItem("dingtag_sensitive_filter_enabled", sensitiveFilterEnabled ? "1" : "0");
    console.log(
        "[DingTag] Sensitive filter:",
        sensitiveFilterEnabled ? "ON (บล็อกข้อความ sensitive)" : "OFF (อนุญาตข้อความแม้ isSensitive=true)"
    );
});

const nonTargetRow = document.createElement("div");
nonTargetRow.style.display = "flex";
nonTargetRow.style.alignItems = "center";
nonTargetRow.style.justifyContent = "space-between";
nonTargetRow.style.gap = "8px";
nonTargetRow.style.marginTop = "10px";
settingsContainer.appendChild(nonTargetRow);

const nonTargetLabel = document.createElement("label");
nonTargetLabel.innerText = "🌐 Auto Invalid (Non-Target)";
nonTargetLabel.style.fontSize = "12px";
nonTargetLabel.style.cursor = "pointer";
nonTargetRow.appendChild(nonTargetLabel);

const nonTargetToggle = document.createElement("input");
nonTargetToggle.type = "checkbox";
nonTargetToggle.checked = nonTargetAutoInvalidEnabled;
nonTargetToggle.style.cursor = "pointer";
nonTargetToggle.title = "เมื่อ API ตรวจว่า Non-Target → กด Invalid + Non-Target Language";
nonTargetRow.appendChild(nonTargetToggle);

nonTargetLabel.addEventListener("click", () => {
    nonTargetToggle.checked = !nonTargetToggle.checked;
    nonTargetToggle.dispatchEvent(new Event("change"));
});

nonTargetToggle.addEventListener("change", () => {
    nonTargetAutoInvalidEnabled = nonTargetToggle.checked;
    localStorage.setItem("dingtag_non_target_auto_invalid", nonTargetAutoInvalidEnabled ? "1" : "0");
    console.log(
        "[DingTag] Non-target auto-invalid:",
        nonTargetAutoInvalidEnabled ? "ON" : "OFF"
    );
});

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

                // ถ้าเด้งกลับมา task ที่เคยทำแล้ว (อยู่ใน Set) → Shift+↓ ข้ามทันที
                if (processedTaskIds.has(currentTaskId) && currentTaskId !== lastProcessedTaskId) {
                    console.log(`⏭️ task ${currentTaskId} เคยทำแล้ว (เด้งกลับ) → Shift+↓ ข้าม (delay ${duplicateSkipDelayMs}ms)`);
                    setStatus(`task ${currentTaskId} เคยทำแล้ว → ข้ามไป task ถัดไป`);
                    lastProcessedTaskId = currentTaskId;
                    isProcessing = true;
                    (async () => {
                        try {
                            await delay(duplicateSkipDelayMs);
                            const sent = await goToNextTask({ runToken: null });
                            if (sent) {
                                console.log(`⏭️ duplicate-skip: ส่ง Shift+↓ จาก task ${currentTaskId} แล้ว`);
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

                        if (sensitiveFilterEnabled && data.isSensitive === true) {
                            console.warn("⚠️ เนื้อหาอ่อนไหว (Politics/War/Monarchy) — ข้ามการวางข้อความ และคงค่าเดิมไว้");
                            setStatus("Sensitive — ส่ง invalid flow");
                            await runInvalidDataMissingAcceptFlow("Sensitive content", runToken, cycleStartAt);
                            return;
                        }

                        const qc = data.qc || {};
                        if (nonTargetAutoInvalidEnabled && qc.isNonTarget === true) {
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
                            if (formatted && formatted.trim()) {
                                safeSetTextarea(runToken, ta, formatted, "formal");
                                setStatus("จัดคำแล้ว");
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
            }
        }
    } catch (e) {
        isProcessing = false;
    }
}, 1000);
