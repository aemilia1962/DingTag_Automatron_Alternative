console.log("🚀 DingTalk Auto-Pilot V21 (Local API) Loaded!");

const LOCAL_TRANSCRIBE_URL = "http://127.0.0.1:54321/api/transcribe";

let isAutoPilotOn = false;
let isProcessing = false;
let readDelay = 1500;
let moveDelay = 8000;
let sensitiveFilterEnabled = localStorage.getItem("dingtag_sensitive_filter_enabled") !== "0";
let activeTimeouts = [];
let lastNoTargetLogAt = 0;

function clearAllTasks() {
    activeTimeouts.forEach(t => clearTimeout(t));
    activeTimeouts = [];
    isProcessing = false;
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

    console.log("[DingTag] API ตอบกลับ:", data.status, "| isSensitive:", data.isSensitive);
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

async function runInvalidDataMissingAcceptFlow(reasonText = "invalid flow") {
    console.log(`🚩 ${reasonText}: พยายามกด Invalid -> Data Missing -> Accept/Fix + Accept`);

    if (forceClickByText(["Invalid"])) {
        console.log("✅ กด Invalid สำเร็จ");
    } else {
        console.warn("⚠️ ไม่พบปุ่ม Invalid");
        setStatus("ไม่พบปุ่ม Invalid");
        return;
    }

    await delay(250);
    if (forceClickByText(["Data Missing"])) {
        console.log("✅ กด Data Missing สำเร็จ");
    } else {
        console.warn("⚠️ ไม่พบปุ่ม Data Missing");
    }

    await delay(250);
    if (forceClickByText(["Fix + Accept", "Accept"])) {
        console.log("✅ กด Fix + Accept/Accept สำเร็จ");
        setStatus("Invalid flow: ส่งงานแล้ว");
    } else {
        console.warn("⚠️ ไม่พบปุ่ม Accept/Fix + Accept");
        setStatus("Invalid flow: ไม่พบปุ่ม Accept");
    }
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
                    await delay(readDelay);
                    if (!isAutoPilotOn) return;

                    targetEl.click();
                    console.log("🖱️ 1. กด Classification เรียบร้อย!");

                    await delay(1000);
                    if (!isAutoPilotOn) return;

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
                        if (forceClickByText(["Delete Spaces"])) {
                            console.log("🧹 2.5 เจอแล้ว! กดลบ Spaces ให้เรียบร้อย!");
                            await delay(600);
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
                        setTextareaValueAndNotify(ta, data.text || "");
                        setStatus("ถอดเสียงแล้ว");
                    } else {
                        console.log("⚠️ ไม่พบ Text Area...");
                        setStatus("ไม่พบ Text Area");
                        return;
                    }

                    await delay(moveDelay);
                    if (!isAutoPilotOn) return;

                    console.log("🔍 กำลังหาปุ่ม Accept หรือ Fix + Accept...");
                    if (forceClickByText(["Fix + Accept", "Accept"])) {
                        console.log("✅ 4. กดปุ่มยืนยันงาน (Accept/Fix) สำเร็จ!");
                    } else {
                        console.log("❌ 4. หาปุ่ม Accept ไม่เจอครับ");
                        setStatus("หาปุ่ม Accept ไม่เจอ");
                        return;
                    }

                    await delay(1500);
                    if (!isAutoPilotOn) return;

                    console.log("🔍 ตรวจสอบป๊อปอัป Ignore & Submit...");
                    if (forceClickByText(["Ignore & Submit"])) {
                        console.log("⚠️ 5. เจอป๊อปอัป! กด Ignore ให้แล้ว!");
                    }
                } catch (e) {
                    console.error("Sequence Error:", e);
                    setStatus("เกิด error (ดู Console)");
                } finally {
                    await delay(1500);
                    isProcessing = false;
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
