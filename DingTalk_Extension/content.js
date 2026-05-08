console.log("🚀 DingTalk Auto-Pilot V17 (Automatron) Loaded!");

let isAutoPilotOn = false;
let isProcessing = false;
let readDelay = 1500; 
let moveDelay = 8000; 
let activeTimeouts = []; 
let lastNoTargetLogAt = 0;

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

const title = document.createElement('div');
title.innerText = '🤖 DingTalk V17 (Automatron)';
title.style.textAlign = 'center'; title.style.marginBottom = '15px'; title.style.fontWeight = 'bold';
panel.appendChild(title);

const toggleBtn = document.createElement('button');
toggleBtn.innerText = 'OFF - คลิกเพื่อเปิด';
toggleBtn.style.width = '100%'; toggleBtn.style.padding = '10px';
toggleBtn.style.backgroundColor = '#dc3545'; toggleBtn.style.color = 'white';
toggleBtn.style.border = 'none'; toggleBtn.style.borderRadius = '6px';
toggleBtn.style.cursor = 'pointer'; title.style.marginBottom = '15px';
panel.appendChild(toggleBtn);

const statusLabel = document.createElement('div');
statusLabel.style.fontSize = '12px';
statusLabel.style.marginTop = '10px';
statusLabel.style.padding = '8px';
statusLabel.style.borderRadius = '8px';
statusLabel.style.backgroundColor = '#343a40';
statusLabel.innerText = 'สถานะ: OFF';
panel.appendChild(statusLabel);

const readLabel = document.createElement('div'); readLabel.style.fontSize = '12px'; readLabel.style.marginTop = '15px'; panel.appendChild(readLabel);
const readSlider = document.createElement('input'); readSlider.type = 'range'; readSlider.min = '500'; readSlider.max = '5000'; readSlider.step = '100'; readSlider.value = readDelay; readSlider.style.width = '100%'; panel.appendChild(readSlider);
const moveLabel = document.createElement('div'); moveLabel.style.fontSize = '12px'; moveLabel.style.marginTop = '10px'; panel.appendChild(moveLabel);
const moveSlider = document.createElement('input'); moveSlider.type = 'range'; moveSlider.min = '300'; moveSlider.max = '15000'; moveSlider.step = '100'; moveSlider.value = moveDelay; moveSlider.style.width = '100%'; panel.appendChild(moveSlider);
document.body.appendChild(panel);

function updateLabels() {
    readLabel.innerText = `⏱️ รอก่อนคลิกแรก: ${(readDelay / 1000).toFixed(1)} วิ`;
    moveLabel.innerText = `🖱️ ระยะห่างสองคลิก: ${(moveDelay / 1000).toFixed(1)} วิ`;
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
readSlider.addEventListener('input', (e) => { readDelay = parseInt(e.target.value); updateLabels(); });
moveSlider.addEventListener('input', (e) => { moveDelay = parseInt(e.target.value); updateLabels(); });

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

                        // รอ Python วางข้อความ (สูงสุด 10 วินาที)
                        console.log(`⏳ รอ Python ประมวลผล... (Max 10s)`);
                        setStatus('รอ Python ประมวลผล...');
                        let aiDone = false;
                        for(let i=0; i<20; i++) { // 20 รอบ * 500ms = 10 วิ
                            if (!isAutoPilotOn) return;
                            if (ta.value.trim() && ta.value !== beforeValue) {
                                aiDone = true;
                                console.log(`✨ Python วางข้อความเสร็จแล้ว!`);
                                setStatus('Python วางข้อความเสร็จแล้ว');
                                break;
                            }
                            await delay(500);
                        }
                        
                        if (!aiDone) {
                            console.log("⚠️ Python ตอบสนองช้าเกินไป! ฝืนเดินหน้าต่อ...");
                            setStatus('Python ไม่ตอบสนอง/ช้าเกินไป');
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