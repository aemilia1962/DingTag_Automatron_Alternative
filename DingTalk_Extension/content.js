console.log("🚀 DingTalk Auto-Pilot V21 (Local API) Loaded!");

const LOCAL_TRANSCRIBE_URL = "http://127.0.0.1:54321/api/transcribe";
const LOCAL_FORMALIZE_URL = "http://127.0.0.1:54321/api/formalize";

let isAutoPilotOn = false;
let isProcessing = false;
let readDelay = 1500;
let moveDelay = 8000;
let sensitiveFilterEnabled = localStorage.getItem("dingtag_sensitive_filter_enabled") !== "0";
let nonTargetAutoInvalidEnabled = localStorage.getItem("dingtag_non_target_auto_invalid") !== "0";
let activeTimeouts = [];
let lastNoTargetLogAt = 0;
let runTokenCounter = 0;
let activeRunToken = 0;

function clearAllTasks() {
    activeTimeouts.forEach(t => clearTimeout(t));
    activeTimeouts = [];
    isProcessing = false;
    activeRunToken = 0;
    console.log("🛑 Kill Switch: ยกเลิกการกระทำทั้งหมด!");
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
    console.log(
        "[DingTag] API ตอบกลับ:",
        data.status,
        "| isSensitive:",
        data.isSensitive,
        "| nonTarget:",
        qc.isNonTarget,
        "englishRatio:",
        qc.englishRatio,
        "source:",
        qc.nonTargetSource
    );
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

panel.appendChild(settingsContainer);
document.body.appendChild(panel);

function updateLabels() {
    readLabel.innerText = `⏱️ รอก่อนคลิกแรก: ${(readDelay / 1000).toFixed(1)} วิ`;
    moveLabel.innerText = `🖱️ ระยะห่างสองคลิก: ${(moveDelay / 1000).toFixed(1)} วิ`;
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
    { checkboxName, menuNeedles, logLabel = "reason" }
) {
    console.log(`🚩 ${reasonText}: Invalid -> ${logLabel} -> Accept/Fix + Accept`);

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
    console.log(`✅ ติ๊ก ${logLabel} สำเร็จ`);

    await delay(350);
    if (forceClickByText(["Fix + Accept", "Accept"]) || (await clickByContainsTextAndVerify(["fix + accept", "accept"], { tries: 10, intervalMs: 350 })).ok) {
        console.log("✅ กด Fix + Accept/Accept สำเร็จ");
        setStatus("Invalid flow: ส่งงานแล้ว");
    } else {
        console.warn("⚠️ ไม่พบปุ่ม Accept/Fix + Accept");
        setStatus("Invalid flow: ไม่พบปุ่ม Accept");
    }
}

async function runInvalidDataMissingAcceptFlow(reasonText = "invalid flow") {
    return runInvalidReasonAcceptFlow(reasonText, {
        checkboxName: "Data Missing",
        menuNeedles: ["data missing", "datamissing"],
        logLabel: "Data Missing",
    });
}

async function runInvalidNonTargetLanguageAcceptFlow(reasonText = "non-target language") {
    return runInvalidReasonAcceptFlow(reasonText, {
        checkboxName: "Non-Target Language",
        menuNeedles: ["non-target", "non target language", "nontarget language", "non target", "nontarget"],
        logLabel: "Non-Target Language",
    });
}

setInterval(() => {
    if (!isAutoPilotOn || isProcessing) return;

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

        if (targetEl) {
            isProcessing = true;
            setStatus("พบ target แล้ว กำลังทำงาน...");

            (async () => {
                try {
                    const runToken = ++runTokenCounter;
                    activeRunToken = runToken;

                    await delay(readDelay);
                    if (!isRunActive(runToken)) return;

                    targetEl.click();
                    console.log("🖱️ 1. กด Classification เรียบร้อย!");

                    await delay(1000);
                    if (!isRunActive(runToken)) return;

                    if (classificationValue === "invalid") {
                        setStatus("Invalid — ข้ามถอดเสียง");
                        console.log("⚡ Classification = Invalid -> ข้ามถอดเสียง");
                        await runInvalidDataMissingAcceptFlow("Classification invalid");
                        return;
                    }

                    let ta = await waitForSelector('textarea[name="Annotation Result"]', {
                        timeoutMs: 8000,
                        intervalMs: 250,
                    });
                    if (ta) {
                        ta.focus();
                        console.log("📝 2. โฟกัสกล่องแล้ว กำลังหาปุ่ม Delete Spaces...");

                        await delay(500);
                        if (!isRunActive(runToken)) return;
                        if (forceClickByText(["Delete Spaces"])) {
                            console.log("🧹 2.5 เจอแล้ว! กดลบ Spaces ให้เรียบร้อย!");
                            await delay(600);
                            if (!isRunActive(runToken)) return;
                            ta.focus();
                        } else {
                            console.log("⚠️ ไม่พบปุ่ม Delete Spaces...");
                        }

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
                            await runInvalidDataMissingAcceptFlow("Sensitive content");
                            return;
                        }

                        const qc = data.qc || {};
                        if (nonTargetAutoInvalidEnabled && qc.isNonTarget === true) {
                            console.warn(
                                "⚠️ QC Non-Target — englishRatio:",
                                qc.englishRatio,
                                "source:",
                                qc.nonTargetSource,
                                "— ข้ามการวางข้อความ และคงค่าเดิมไว้"
                            );
                            setStatus("Non-Target — ส่ง invalid flow");
                            await runInvalidNonTargetLanguageAcceptFlow("Non-target language (QC)");
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

                    console.log("🔍 กำลังหาปุ่ม Accept หรือ Fix + Accept...");
                    if (forceClickByText(["Fix + Accept", "Accept"])) {
                        console.log("✅ 4. กดปุ่มยืนยันงาน (Accept/Fix) สำเร็จ!");
                    } else {
                        console.log("❌ 4. หาปุ่ม Accept ไม่เจอครับ");
                        setStatus("หาปุ่ม Accept ไม่เจอ");
                        return;
                    }

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
                } catch (e) {
                    console.error("Sequence Error:", e);
                    setStatus("เกิด error (ดู Console)");
                } finally {
                    await delay(1500);
                    isProcessing = false;
                    activeRunToken = 0;
                    activeTimeouts = [];
                    console.log("🔄 จบวงจร เตรียมรับงานต่อไป...");
                    if (isAutoPilotOn) setStatus("กำลังค้นหา target...");
                }
            })();
        } else {
            const now = Date.now();
            if (now - lastNoTargetLogAt > 5000) {
                lastNoTargetLogAt = now;
                console.log(
                    "⏳ ON อยู่ แต่ยังไม่เจอ target (Classification: Valid/Invalid) — ตรวจหน้าเว็บ/DOM/สิทธิ์ Extension"
                );
                setStatus("ยังไม่เจอ target (รอ Classification Valid/Invalid...)");
            }
        }
    } catch (e) {
        isProcessing = false;
    }
}, 1000);
