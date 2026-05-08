console.log("🚀 DingTalk Auto-Pilot V17 (Automatron) Loaded!");

let isAutoPilotOn = false;
let isProcessing = false;
let readDelay = 1500; 
let moveDelay = 1000; 
let activeTimeouts = []; 

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

toggleBtn.addEventListener('click', () => {
    isAutoPilotOn = !isAutoPilotOn;
    if (isAutoPilotOn) { toggleBtn.innerText = 'ON - ระบบกำลังทำงาน'; toggleBtn.style.backgroundColor = '#198754'; } 
    else { toggleBtn.innerText = 'OFF - คลิกเพื่อเปิด'; toggleBtn.style.backgroundColor = '#dc3545'; clearAllTasks(); }
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

setInterval(() => {
    if (!isAutoPilotOn || isProcessing) return;

    try {
        let targetEm = null;
        const emTags = document.querySelectorAll('em');
        for (let em of emTags) {
            const container = em.closest('.lsf-annotation-items__result-item');
            if (container && container.textContent.includes('Classification:')) {
                const text = em.textContent.trim().toLowerCase();
                if (text === 'invalid' || text === 'valid') { targetEm = em; break; }
            }
        }

        if (targetEm) {
            isProcessing = true;
            
            (async () => {
                try {
                    // รออ่านงานตาม Slider
                    await delay(readDelay);
                    if (!isAutoPilotOn) return;
                    
                    // --- สเต็ป 1: กด Classification ---
                    targetEm.click(); 
                    console.log(`🖱️ 1. กด Classification เรียบร้อย!`);

                    // --- สเต็ป 2: โฟกัสกล่อง และลบ Spaces ---
                    await delay(1000); 
                    if (!isAutoPilotOn) return;
                    
                    let ta = document.querySelector('textarea[name="Annotation Result"]');
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
                        const beforeValue = ta.value;
                        const triggerName = `dingtalk_bridge_trigger_${Date.now()}.txt`;
                        const l = document.createElement('a');
                        l.href = 'data:text/plain;charset=utf-8,mode=dingtalk_voice_after_delete_spaces';
                        l.download = triggerName;
                        document.body.appendChild(l); l.click(); document.body.removeChild(l);

                        // รอ Python วางข้อความ (สูงสุด 10 วินาที)
                        console.log(`⏳ รอ Python ประมวลผล... (Max 10s)`);
                        let aiDone = false;
                        for(let i=0; i<20; i++) { // 20 รอบ * 500ms = 10 วิ
                            if (!isAutoPilotOn) return;
                            if (ta.value.trim() && ta.value !== beforeValue) {
                                aiDone = true;
                                console.log(`✨ Python วางข้อความเสร็จแล้ว!`);
                                break;
                            }
                            await delay(500);
                        }
                        
                        if (!aiDone) {
                            console.log("⚠️ Python ตอบสนองช้าเกินไป! ฝืนเดินหน้าต่อ...");
                        }
                    } else {
                        console.log("⚠️ ไม่พบ Text Area...");
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
                } finally {
                    await delay(1500);
                    isProcessing = false;
                    activeTimeouts = [];
                    console.log("🔄 จบวงจร เตรียมรับงานต่อไป...");
                }
            })();
        }
    } catch (e) { isProcessing = false; }
}, 1000);