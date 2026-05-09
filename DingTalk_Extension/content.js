console.log("🚀 DingTalk Auto-Pilot V20 (Automatron) Loaded!");

let isAutoPilotOn = false;
let isProcessing = false;
let readDelay = 1500; 
let moveDelay = 8000; 
let activeTimeouts = []; 
let lastNoTargetLogAt = 0;
let pythonTranscribeWaitMs = 60000;
let pythonFormalWaitMs = 45000;

function clearAllTasks() {
    activeTimeouts.forEach(t => clearTimeout(t));
    activeTimeouts = [];
    isProcessing = false;
    console.log("🛑 Kill Switch: ยกเลิกการกระทำทั้งหมด!");
}

// ----------------------------------------------------
// ระบบดูดเสียง (Alt + S) - ใช้ร่วมกับ aibot_automatron.py
// ----------------------------------------------------
async function downloadAudio() {
    const mediaEl = document.querySelector('audio, video');
    if (!mediaEl || !mediaEl.src) {
        console.log("⚠️ ไม่เจอ audio/video element สำหรับดูดเสียง");
        return false;
    }

    try {
        const response = await fetch(mediaEl.src);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'dingtalk_temp.wav';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
        console.log("🎵 ดูดเสียงสำเร็จ: dingtalk_temp.wav");
        return true;
    } catch (e) {
        console.error("❌ downloadAudio error:", e);
        return false;
    }
}

window.addEventListener('keydown', (e) => {
    if (e.altKey && e.code === 'KeyS') {
        e.preventDefault();
        downloadAudio();
    }
});

// ----------------------------------------------------
// แผงควบคุม UI
// ----------------------------------------------------
const panel = document.createElement('div');
panel.style.position = 'fixed'; panel.style.bottom = '20px'; panel.style.right = '20px';
panel.style.zIndex = '999999'; panel.style.padding = '15px'; panel.style.backgroundColor = '#212529';
panel.style.color = 'white'; panel.style.borderRadius = '12px'; panel.style.width = '240px';
panel.style.fontFamily = 'Arial, sans-serif';

const headerRow = document.createElement('div');
headerRow.style.display = 'flex';
headerRow.style.alignItems = 'center';
headerRow.style.justifyContent = 'space-between';
headerRow.style.gap = '8px';
headerRow.style.marginBottom = '12px';

const title = document.createElement('div');
title.innerText = '🤖 DingTalk V20 (Automatron)';
title.style.fontWeight = 'bold';
title.style.fontSize = '13px';
title.style.lineHeight = '1.2';
title.style.flex = '1';

const settingsBtn = document.createElement('button');
settingsBtn.type = 'button';
settingsBtn.innerText = '⚙️';
settingsBtn.title = 'ตั้งค่า';
settingsBtn.style.width = '30px';
settingsBtn.style.height = '30px';
settingsBtn.style.padding = '0';
settingsBtn.style.border = 'none';
settingsBtn.style.borderRadius = '8px';
settingsBtn.style.cursor = 'pointer';
settingsBtn.style.backgroundColor = '#343a40';
settingsBtn.style.color = 'white';
settingsBtn.style.fontSize = '16px';
settingsBtn.style.display = 'flex';
settingsBtn.style.alignItems = 'center';
settingsBtn.style.justifyContent = 'center';

headerRow.appendChild(title);
headerRow.appendChild(settingsBtn);
panel.appendChild(headerRow);

const toggleBtn = document.createElement('button');
toggleBtn.innerText = 'OFF - คลิกเพื่อเปิด';
toggleBtn.style.width = '100%'; toggleBtn.style.padding = '10px';
toggleBtn.style.backgroundColor = '#dc3545'; toggleBtn.style.color = 'white';
toggleBtn.style.border = 'none'; toggleBtn.style.borderRadius = '6px';
toggleBtn.style.cursor = 'pointer';
panel.appendChild(toggleBtn);

const statusLabel = document.createElement('div');
statusLabel.style.fontSize = '12px';
statusLabel.style.marginTop = '10px';
statusLabel.style.padding = '8px';
statusLabel.style.borderRadius = '8px';
statusLabel.style.backgroundColor = '#343a40';
statusLabel.innerText = 'สถานะ: OFF';
panel.appendChild(statusLabel);

const settingsContainer = document.createElement('div');
settingsContainer.style.marginTop = '10px';
settingsContainer.style.paddingTop = '10px';
settingsContainer.style.borderTop = '1px solid rgba(255,255,255,0.12)';
settingsContainer.style.display = 'none';

const readLabel = document.createElement('div'); readLabel.style.fontSize = '12px'; readLabel.style.marginTop = '8px'; settingsContainer.appendChild(readLabel);
const readSlider = document.createElement('input'); readSlider.type = 'range'; readSlider.min = '500'; readSlider.max = '5000'; readSlider.step = '100'; readSlider.value = readDelay; readSlider.style.width = '100%'; settingsContainer.appendChild(readSlider);

const moveLabel = document.createElement('div'); moveLabel.style.fontSize = '12px'; moveLabel.style.marginTop = '10px'; settingsContainer.appendChild(moveLabel);
const moveSlider = document.createElement('input'); moveSlider.type = 'range'; moveSlider.min = '300'; moveSlider.max = '15000'; moveSlider.step = '100'; moveSlider.value = moveDelay; moveSlider.style.width = '100%'; settingsContainer.appendChild(moveSlider);

const pyTranscribeLabel = document.createElement('div'); pyTranscribeLabel.style.fontSize = '12px'; pyTranscribeLabel.style.marginTop = '10px'; settingsContainer.appendChild(pyTranscribeLabel);
const pyTranscribeSlider = document.createElement('input'); pyTranscribeSlider.type = 'range'; pyTranscribeSlider.min = '5000'; pyTranscribeSlider.max = '180000'; pyTranscribeSlider.step = '5000'; pyTranscribeSlider.value = pythonTranscribeWaitMs; pyTranscribeSlider.style.width = '100%'; settingsContainer.appendChild(pyTranscribeSlider);

const pyFormalLabel = document.createElement('div'); pyFormalLabel.style.fontSize = '12px'; pyFormalLabel.style.marginTop = '10px'; settingsContainer.appendChild(pyFormalLabel);
const pyFormalSlider = document.createElement('input'); pyFormalSlider.type = 'range'; pyFormalSlider.min = '3000'; pyFormalSlider.max = '120000'; pyFormalSlider.step = '2000'; pyFormalSlider.value = pythonFormalWaitMs; pyFormalSlider.style.width = '100%'; settingsContainer.appendChild(pyFormalSlider);

panel.appendChild(settingsContainer);

document.body.appendChild(panel);

function updateLabels() {
    readLabel.innerText = `⏱️ รอก่อนคลิกแรก: ${(readDelay / 1000).toFixed(1)} วิ`;
    moveLabel.innerText = `🖱️ ระยะห่างสองคลิก: ${(moveDelay / 1000).toFixed(1)} วิ`;
    pyTranscribeLabel.innerText = `🎙️ Timeout รอวางถอดเสียง: ${(pythonTranscribeWaitMs / 1000).toFixed(1)} วิ`;
    pyFormalLabel.innerText = `✏️ Timeout รอ Formal วาง: ${(pythonFormalWaitMs / 1000).toFixed(1)} วิ`;
}
updateLabels();

function setStatus(text) {
    statusLabel.innerText = `สถานะ: ${text}`;
}

toggleBtn.addEventListener('click', () => {
    isAutoPilotOn = !isAutoPilotOn;
    if (isAutoPilotOn) {
        toggleBtn.innerText = 'ON - ระบบกำลังทำงาน';
        toggleBtn.style.backgroundColor = '#198754';
        setStatus('กำลังค้นหา target...');
    } else {
        toggleBtn.innerText = 'OFF - คลิกเพื่อเปิด';
        toggleBtn.style.backgroundColor = '#dc3545';
        clearAllTasks();
        setStatus('OFF');
    }
});

settingsBtn.addEventListener('click', () => {
    const isOpen = settingsContainer.style.display !== 'none';
    settingsContainer.style.display = isOpen ? 'none' : 'block';
});
readSlider.addEventListener('input', (e) => { readDelay = parseInt(e.target.value); updateLabels(); });
moveSlider.addEventListener('input', (e) => { moveDelay = parseInt(e.target.value); updateLabels(); });
pyTranscribeSlider.addEventListener('input', (e) => { pythonTranscribeWaitMs = parseInt(e.target.value); updateLabels(); });
pyFormalSlider.addEventListener('input', (e) => { pythonFormalWaitMs = parseInt(e.target.value); updateLabels(); });

// ----------------------------------------------------
// 🔥 ฟังก์ชันเจาะเกราะ: ค้นหาและคลิกปุ่มขั้นเด็ดขาด
// ----------------------------------------------------
function forceClickByText(keywords) {
    let allElements = document.querySelectorAll('*');
    for (let el of allElements) {
        // หาเฉพาะ Element ที่ไม่มีลูก (เช่น <span> ข้อความเพียวๆ) เพื่อความแม่นยำ
        if (el.children.length === 0 && el.textContent) {
            let text = el.textContent.trim();
            if (keywords.includes(text)) {
                el.click(); // คลิกที่ตัวหนังสือตรงๆ
                let parentBtn = el.closest('button, [role="button"]');
                if (parentBtn) parentBtn.click(); // คลิกที่กล่องปุ่มแม่มันด้วย (กันพลาด)
                return true;
            }
        }
    }
    return false;
}

// ----------------------------------------------------
// ระบบสมองกล
// ----------------------------------------------------
const delay = (ms) => new Promise(resolve => {
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

setInterval(() => {
    if (!isAutoPilotOn || isProcessing) return;

    try {
        // รองรับ Element 2 แบบ:
        // - เก่า: ... <div class="lsf-annotation-items__result-value"><em ...>Valid</em></div>
        // - ใหม่: ... <div class="lsf-annotation-items__result-value">Valid</div>
        let targetEl = null;
        const items = document.querySelectorAll('.lsf-annotation-items__result-item');
        for (let item of items) {
            const label = item.querySelector('.lsf-annotation-items__result-label');
            if (!label) continue;
            if (!label.textContent || !label.textContent.includes('Classification')) continue;

            const valueEl = item.querySelector('.lsf-annotation-items__result-value');
            if (!valueEl) continue;

            const valueText = valueEl.textContent ? valueEl.textContent.trim().toLowerCase() : '';
            if (valueText === 'valid' || valueText === 'invalid') {
                // คลิกที่ value element เป็นหลัก (แม่นยำสุดทั้ง 2 แบบ)
                targetEl = valueEl.querySelector('em') || valueEl;
                break;
            }
        }

        if (targetEl) {
            isProcessing = true;
            setStatus('พบ target แล้ว กำลังทำงาน...');
            
            (async () => {
                try {
                    // รออ่านงานตาม Slider
                    await delay(readDelay);
                    if (!isAutoPilotOn) return;
                    
                    // --- สเต็ป 1: กด Classification ---
                    targetEl.click(); 
                    console.log(`🖱️ 1. กด Classification เรียบร้อย!`);

                    // --- สเต็ป 2: โฟกัสกล่อง และลบ Spaces ---
                    await delay(1000); 
                    if (!isAutoPilotOn) return;

                    // รอ Text Area โผล่มา (กันกรณี UI โหลดช้า/DOM เปลี่ยน)
                    let ta = await waitForSelector('textarea[name="Annotation Result"]', { timeoutMs: 8000, intervalMs: 250 });
                    if (ta) {
                        ta.focus();
                        console.log(`📝 2. โฟกัสกล่องแล้ว กำลังหาปุ่ม Delete Spaces...`);
                        
                        await delay(500); 
                        if (forceClickByText(['Delete Spaces'])) {
                            console.log(`🧹 2.5 เจอแล้ว! กดลบ Spaces ให้เรียบร้อย!`);
                            await delay(600); 
                            ta.focus(); // โฟกัสกล่องกลับ
                        } else {
                            console.log(`⚠️ ไม่พบปุ่ม Delete Spaces...`);
                        }

                        // --- สเต็ป 3: เรียก Python Bridge (หลัง Delete Spaces) ---
                        console.log(`📡 3. ส่งสัญญาณให้ Python ทำ "ดูดเสียงและวางข้อความ"...`);
                        setStatus('ส่ง trigger ให้ Python...');
                        const beforeValue = ta.value;
                        const triggerName = `dingtalk_bridge_trigger_${Date.now()}.txt`;
                        const l = document.createElement('a');
                        l.href = 'data:text/plain;charset=utf-8,mode=dingtalk_voice_after_delete_spaces';
                        l.download = triggerName;
                        document.body.appendChild(l); l.click(); document.body.removeChild(l);

                        // รอ Python แยก timeout: (1) วางถอดเสียง (2) วาง Formal
                        console.log(`⏳ รอวางถอดเสียง (สูงสุด ${(pythonTranscribeWaitMs / 1000).toFixed(1)}s) แล้วรอ Formal (${(pythonFormalWaitMs / 1000).toFixed(1)}s)`);
                        setStatus('รอวางถอดเสียง...');
                        const transcribeStart = Date.now();
                        let rawValue = null;
                        while (Date.now() - transcribeStart < pythonTranscribeWaitMs) {
                            if (!isAutoPilotOn) return;
                            if (ta.value.trim() && ta.value !== beforeValue) {
                                rawValue = ta.value;
                                console.log(`✨ วางถอดเสียงแล้ว — รอ Formal...`);
                                setStatus('รอ Formal วางข้อความ...');
                                break;
                            }
                            await delay(250);
                        }

                        let aiDone = !!rawValue;
                        if (rawValue) {
                            let formalChanged = false;
                            const formalStart = Date.now();
                            while (Date.now() - formalStart < pythonFormalWaitMs) {
                                if (!isAutoPilotOn) return;
                                if (ta.value !== rawValue) {
                                    formalChanged = true;
                                    console.log(`✨ Formal วางข้อความแล้ว!`);
                                    setStatus('Formal เสร็จแล้ว');
                                    break;
                                }
                                await delay(250);
                            }
                            if (!formalChanged) {
                                console.log('⚠️ ข้อความไม่เปลี่ยนหลัง Formal (ผลเหมือนดิบหรือหมดเวลา Formal) — ไป Accept ด้วยข้อความดิบ');
                                setStatus('Formal ไม่เปลี่ยนข้อความ/หมดเวลา — ใช้ข้อความที่มี');
                            }
                            await delay(350);
                        }

                        if (!aiDone) {
                            console.log("⚠️ ไม่เห็นข้อความถอดเสียงภายในเวลา — ฝืนเดินหน้าต่อ...");
                            setStatus('หมดเวลารอถอดเสียง');
                        }
                    } else {
                        console.log("⚠️ ไม่พบ Text Area...");
                        setStatus('ไม่พบ Text Area');
                        // สำคัญ: ถ้าไม่มี Text Area ให้ยกเลิกรอบนี้ ไม่ไปกด Accept มั่ว
                        return;
                    }

                    // รอเลื่อนเมาส์
                    await delay(moveDelay);
                    if (!isAutoPilotOn) return;

                    // --- สเต็ป 4: กดปุ่ม Fix + Accept หรือ Accept ---
                    console.log("🔍 กำลังหาปุ่ม Accept หรือ Fix + Accept...");
                    if (forceClickByText(['Fix + Accept', 'Accept'])) {
                        console.log(`✅ 4. กดปุ่มยืนยันงาน (Accept/Fix) สำเร็จ!`);
                    } else {
                        console.log(`❌ 4. หาปุ่ม Accept ไม่เจอครับ`);
                        setStatus('หาปุ่ม Accept ไม่เจอ');
                        return;
                    }

                    // --- สเต็ป 5: รอเช็ค Quality Check Failed ---
                    await delay(1500); 
                    if (!isAutoPilotOn) return;

                    console.log("🔍 ตรวจสอบป๊อปอัป Ignore & Submit...");
                    if (forceClickByText(['Ignore & Submit'])) {
                        console.log(`⚠️ 5. เจอป๊อปอัป! กด Ignore ให้แล้ว!`);
                    }

                } catch (e) {
                    console.error("Sequence Error:", e);
                    setStatus('เกิด error (ดู Console)');
                } finally {
                    await delay(1500);
                    isProcessing = false;
                    activeTimeouts = [];
                    console.log("🔄 จบวงจร เตรียมรับงานต่อไป...");
                    if (isAutoPilotOn) setStatus('กำลังค้นหา target...');
                }
            })();
        } else {
            const now = Date.now();
            if (now - lastNoTargetLogAt > 5000) {
                lastNoTargetLogAt = now;
                console.log("⏳ ON อยู่ แต่ยังไม่เจอ target (Classification: valid/invalid) — ตรวจหน้าเว็บ/DOM/สิทธิ์ Extension");
                setStatus('ยังไม่เจอ target (รอ Classification...)');
            }
        }
    } catch (e) { isProcessing = false; }
}, 1000);