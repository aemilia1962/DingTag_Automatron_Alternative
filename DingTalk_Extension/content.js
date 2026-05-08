console.log("🚀 DingTalk Auto-Pilot V17 (Automatron) Loaded!");

let isAutoPilotOn = false;
let isProcessing = false;
let readDelay = 1500; 
let moveDelay = 8000; 
let activeTimeouts = []; 
let lastNoTargetLogAt = 0;
let isAutoSpacingOn = true;
let pythonWaitMs = 10000;

const LOCAL_STORAGE_KEYS = {
    brandDict: 'dingtag_brand_dict_v1',
};

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
title.innerText = '🤖 DingTalk V17 (Automatron)';
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

const pyWaitLabel = document.createElement('div'); pyWaitLabel.style.fontSize = '12px'; pyWaitLabel.style.marginTop = '10px'; settingsContainer.appendChild(pyWaitLabel);
const pyWaitSlider = document.createElement('input'); pyWaitSlider.type = 'range'; pyWaitSlider.min = '5000'; pyWaitSlider.max = '180000'; pyWaitSlider.step = '5000'; pyWaitSlider.value = pythonWaitMs; pyWaitSlider.style.width = '100%'; settingsContainer.appendChild(pyWaitSlider);

const spacingRow = document.createElement('label');
spacingRow.style.display = 'flex';
spacingRow.style.alignItems = 'center';
spacingRow.style.gap = '8px';
spacingRow.style.marginTop = '12px';
spacingRow.style.fontSize = '12px';
spacingRow.style.userSelect = 'none';
const spacingToggle = document.createElement('input');
spacingToggle.type = 'checkbox';
spacingToggle.checked = isAutoSpacingOn;
const spacingText = document.createElement('span');
spacingText.innerText = 'Auto spacing หลังดูดเสียง';
spacingRow.appendChild(spacingToggle);
spacingRow.appendChild(spacingText);
settingsContainer.appendChild(spacingRow);

const brandLabel = document.createElement('div');
brandLabel.style.fontSize = '12px';
brandLabel.style.marginTop = '12px';
brandLabel.innerText = '🅰️ Brand dictionary (บรรทัดละ from=to)';
settingsContainer.appendChild(brandLabel);

const brandTextarea = document.createElement('textarea');
brandTextarea.placeholder = "ตัวอย่าง:\niphone=iPhone\ndelivery=Delivery\n# comment lines allowed";
brandTextarea.style.width = '100%';
brandTextarea.style.height = '90px';
brandTextarea.style.resize = 'vertical';
brandTextarea.style.marginTop = '6px';
brandTextarea.style.borderRadius = '8px';
brandTextarea.style.border = '1px solid rgba(255,255,255,0.15)';
brandTextarea.style.background = '#1b1f24';
brandTextarea.style.color = 'white';
brandTextarea.style.padding = '8px';
brandTextarea.style.fontSize = '12px';
brandTextarea.style.fontFamily = 'Consolas, ui-monospace, SFMono-Regular, Menlo, Monaco, monospace';
try {
    brandTextarea.value = localStorage.getItem(LOCAL_STORAGE_KEYS.brandDict) || '';
} catch (_) {}
settingsContainer.appendChild(brandTextarea);

const brandSaveRow = document.createElement('div');
brandSaveRow.style.display = 'flex';
brandSaveRow.style.gap = '8px';
brandSaveRow.style.marginTop = '8px';

const brandSaveBtn = document.createElement('button');
brandSaveBtn.type = 'button';
brandSaveBtn.innerText = 'บันทึก';
brandSaveBtn.style.flex = '1';
brandSaveBtn.style.padding = '8px';
brandSaveBtn.style.border = 'none';
brandSaveBtn.style.borderRadius = '8px';
brandSaveBtn.style.cursor = 'pointer';
brandSaveBtn.style.backgroundColor = '#0d6efd';
brandSaveBtn.style.color = 'white';
brandSaveBtn.style.fontSize = '12px';

const brandResetBtn = document.createElement('button');
brandResetBtn.type = 'button';
brandResetBtn.innerText = 'ล้าง';
brandResetBtn.style.width = '72px';
brandResetBtn.style.padding = '8px';
brandResetBtn.style.border = 'none';
brandResetBtn.style.borderRadius = '8px';
brandResetBtn.style.cursor = 'pointer';
brandResetBtn.style.backgroundColor = '#343a40';
brandResetBtn.style.color = 'white';
brandResetBtn.style.fontSize = '12px';

brandSaveRow.appendChild(brandSaveBtn);
brandSaveRow.appendChild(brandResetBtn);
settingsContainer.appendChild(brandSaveRow);

panel.appendChild(settingsContainer);

document.body.appendChild(panel);

function updateLabels() {
    readLabel.innerText = `⏱️ รอก่อนคลิกแรก: ${(readDelay / 1000).toFixed(1)} วิ`;
    moveLabel.innerText = `🖱️ ระยะห่างสองคลิก: ${(moveDelay / 1000).toFixed(1)} วิ`;
    pyWaitLabel.innerText = `🐍 รอ Python วางข้อความ: ${(pythonWaitMs / 1000).toFixed(1)} วิ`;
}
updateLabels();

function setStatus(text) {
    statusLabel.innerText = `สถานะ: ${text}`;
}

function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getDefaultBrandMap() {
    return {
        // Apple / common tech
        apple: 'Apple',
        iphone: 'iPhone',
        ipad: 'iPad',
        ios: 'iOS',
        ipados: 'iPadOS',
        macos: 'macOS',
        mac: 'Mac',
        macbook: 'MacBook',
        macbookair: 'MacBook Air',
        'macbook air': 'MacBook Air',
        macbookpro: 'MacBook Pro',
        'macbook pro': 'MacBook Pro',
        imac: 'iMac',
        ipadpro: 'iPad Pro',
        'ipad pro': 'iPad Pro',
        ipadair: 'iPad Air',
        'ipad air': 'iPad Air',
        ipadmini: 'iPad mini',
        'ipad mini': 'iPad mini',
        airpods: 'AirPods',
        airpodspro: 'AirPods Pro',
        'airpods pro': 'AirPods Pro',
        airpodsmax: 'AirPods Max',
        'airpods max': 'AirPods Max',
        'apple watch': 'Apple Watch',
        watchos: 'watchOS',
        applepay: 'Apple Pay',
        'apple pay': 'Apple Pay',
        appstore: 'App Store',
        'app store': 'App Store',
        itunes: 'iTunes',
        safari: 'Safari',
        imessage: 'iMessage',
        facetime: 'FaceTime',
        icloud: 'iCloud',
        'face id': 'Face ID',
        'touch id': 'Touch ID',
        magsafe: 'MagSafe',
        lightning: 'Lightning',
        usbc: 'USB-C',
        'usb-c': 'USB-C',
        usb: 'USB',
        usba: 'USB-A',
        'usb-a': 'USB-A',
        hdmi: 'HDMI',
        wifi: 'Wi‑Fi',
        'wi-fi': 'Wi‑Fi',
        bluetooth: 'Bluetooth',
        nfc: 'NFC',

        // Social / comms / platforms
        line: 'LINE',
        wechat: 'WeChat',
        whatsapp: 'WhatsApp',
        messenger: 'Messenger',
        telegram: 'Telegram',
        discord: 'Discord',
        slack: 'Slack',
        zoom: 'Zoom',
        'google meet': 'Google Meet',
        meet: 'Meet',
        skype: 'Skype',
        kakao: 'Kakao',
        kakaotalk: 'KakaoTalk',
        tiktok: 'TikTok',
        bytedance: 'ByteDance',
        facebook: 'Facebook',
        instagram: 'Instagram',
        meta: 'Meta',
        twitter: 'Twitter',
        x: 'X',
        netflix: 'Netflix',
        spotify: 'Spotify',

        // Google / Android ecosystem
        google: 'Google',
        android: 'Android',
        chrome: 'Chrome',
        chromecast: 'Chromecast',
        gmail: 'Gmail',
        gdrive: 'Google Drive',
        'google drive': 'Google Drive',
        gmaps: 'Google Maps',
        'google maps': 'Google Maps',
        'google play': 'Google Play',
        playstore: 'Play Store',
        'play store': 'Play Store',
        pixel: 'Pixel',
        firebase: 'Firebase',

        // Microsoft
        microsoft: 'Microsoft',
        windows: 'Windows',
        onedrive: 'OneDrive',
        'one drive': 'OneDrive',
        office: 'Office',
        m365: 'Microsoft 365',
        'microsoft 365': 'Microsoft 365',
        teams: 'Teams',
        outlook: 'Outlook',
        edge: 'Edge',
        xbox: 'Xbox',
        surface: 'Surface',

        // Samsung
        samsung: 'Samsung',
        galaxy: 'Galaxy',
        'one ui': 'One UI',
        oneui: 'One UI',

        // Chinese OEMs
        huawei: 'Huawei',
        honor: 'HONOR',
        xiaomi: 'Xiaomi',
        redmi: 'Redmi',
        poco: 'POCO',
        oppo: 'OPPO',
        vivo: 'vivo',
        realme: 'realme',
        oneplus: 'OnePlus',
        'one plus': 'OnePlus',

        // Gaming / hardware brands
        sony: 'Sony',
        playstation: 'PlayStation',
        ps5: 'PS5',
        ps4: 'PS4',
        nintendo: 'Nintendo',
        switch: 'Switch',
        steam: 'Steam',
        epic: 'Epic',
        epicgames: 'Epic Games',
        'epic games': 'Epic Games',

        // AI / dev / cloud
        openai: 'OpenAI',
        chatgpt: 'ChatGPT',
        gpt: 'GPT',
        gemini: 'Gemini',
        claude: 'Claude',
        copilot: 'Copilot',
        github: 'GitHub',
        gitlab: 'GitLab',
        bitbucket: 'Bitbucket',
        aws: 'AWS',
        'amazon web services': 'AWS',
        azure: 'Azure',
        gcp: 'GCP',
        'google cloud': 'Google Cloud',
        cloudflare: 'Cloudflare',
        vercel: 'Vercel',
        netlify: 'Netlify',
        docker: 'Docker',
        kubernetes: 'Kubernetes',
        k8s: 'Kubernetes',
        postgres: 'Postgres',
        postgresql: 'PostgreSQL',
        mysql: 'MySQL',
        mongodb: 'MongoDB',

        // Chips / OEM / components
        intel: 'Intel',
        amd: 'AMD',
        nvidia: 'NVIDIA',
        qualcomm: 'Qualcomm',
        snapdragon: 'Snapdragon',
        mediatek: 'MediaTek',
        exynos: 'Exynos',
        tsmc: 'TSMC',

        // Common acronyms / automotive-ish terms often seen in QC
        ev: 'EV',
        hev: 'HEV',
        phev: 'PHEV',
        bev: 'BEV',
        ice: 'ICE',
        suv: 'SUV',
        mpv: 'MPV',
        adas: 'ADAS',
        gps: 'GPS',
        abs: 'ABS',
        esp: 'ESP',
        lkas: 'LKAS',
        acc: 'ACC',
        aeb: 'AEB',
        tpms: 'TPMS',
        obd: 'OBD',
        obd2: 'OBD-II',
        'obd-ii': 'OBD-II',
        cvt: 'CVT',
        dct: 'DCT',
        rpm: 'RPM',

        // Charging / power / display / media
        ac: 'AC',
        dc: 'DC',
        kw: 'kW',
        kwh: 'kWh',
        wh: 'Wh',
        mah: 'mAh',
        w: 'W',
        v: 'V',
        a: 'A',
        hz: 'Hz',
        fps: 'FPS',
        hdr: 'HDR',
        oled: 'OLED',
        amoled: 'AMOLED',
        lcd: 'LCD',
        led: 'LED',
        '4k': '4K',
        '8k': '8K',
        ui: 'UI',
        ux: 'UX',

        // Words you mentioned / common QC
        delivery: 'Delivery',
    };
}

function parseBrandDict(text) {
    // Format: one mapping per line -> from=to
    // Example: iphone=iPhone
    // Lines starting with # are ignored.
    const map = {};
    const raw = typeof text === 'string' ? text : '';
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
        const s = line.trim();
        if (!s || s.startsWith('#')) continue;
        const idx = s.indexOf('=');
        if (idx <= 0) continue;
        const from = s.slice(0, idx).trim();
        const to = s.slice(idx + 1).trim();
        if (!from || !to) continue;
        map[from.toLowerCase()] = to;
    }
    return map;
}

function loadBrandMap() {
    try {
        const raw = localStorage.getItem(LOCAL_STORAGE_KEYS.brandDict);
        const userMap = parseBrandDict(raw || '');
        return { ...getDefaultBrandMap(), ...userMap };
    } catch (_) {
        return getDefaultBrandMap();
    }
}

function saveBrandDictRaw(rawText) {
    try {
        localStorage.setItem(LOCAL_STORAGE_KEYS.brandDict, String(rawText ?? ''));
        return true;
    } catch (_) {
        return false;
    }
}

function formatSpacing(text) {
    if (typeof text !== 'string') return '';

    let t = text
        .replace(/\u00A0/g, ' ')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');

    // Thai-aware cleanup:
    // - Remove spaces before common Thai particles (ราคา นะ -> ราคานะ)
    // - Ensure a space after particles if they stick to the next Thai word (นะที่ -> นะ ที่)
    // Remove whitespace before particles when preceded by Thai char.
    t = t
        .replace(/([ก-๙])\s+(นะครับ|นะคะ)(?=[\s\n.,!?;:)"'\]]|$)/g, '$1$2')
        .replace(/([ก-๙])\s+(นะ|น่ะ|ครับ|ค่ะ|คะ)(?=[\s\n.,!?;:)"'\]]|$)/g, '$1$2');

    // If particle is immediately followed by Thai character, add one space.
    t = t
        .replace(/(นะครับ|นะคะ)([ก-๙])/g, '$1 $2')
        .replace(/(นะ|น่ะ|ครับ|ค่ะ|คะ)([ก-๙])/g, '$1 $2');

    // Brand / proper-noun dictionary (user editable; persisted in localStorage)
    const capMap = loadBrandMap();
    const keys = Object.keys(capMap);
    if (keys.length) {
        // Prefer longer matches first (e.g., "face id" before "id")
        keys.sort((a, b) => b.length - a.length);
        for (const k of keys) {
            const to = capMap[k];
            if (!to) continue;
            // Word-ish boundaries: avoid altering inside Thai words.
            // For keys with spaces/hyphens, still do a best-effort boundary match.
            const re = new RegExp(`(^|[^A-Za-z0-9_])(${escapeRegExp(k)})(?=[^A-Za-z0-9_]|$)`, 'gi');
            t = t.replace(re, (m, lead, hit) => `${lead}${to}`);
        }
    }

    // General capitalization:
    // - Pronoun "I" and its common contractions.
    t = t
        .replace(/\bi\b/g, 'I')
        .replace(/\bi(['’])(m|ve|ll|d|re)\b/gi, (_, apos, tail) => `I${apos}${String(tail).toLowerCase()}`);

    // - Sentence case for English words at the start of text / after punctuation / newline.
    //   Example: "... . delivery is ..." -> "... . Delivery is ..."
    t = t.replace(/(^|[.!?]\s+|\n\s+)([a-z])([a-z][A-Za-z0-9_-]*)/g, (m, lead, c1, rest) => {
        return `${lead}${c1.toUpperCase()}${rest}`;
    });

    // Insert spaces for common "stuck" patterns (English-centric; safe for mixed text).
    t = t
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Za-z])(\d)/g, '$1 $2')
        .replace(/(\d)([A-Za-z])/g, '$1 $2')
        .replace(/([.,!?;:])([^\s\n])/g, '$1 $2');

    // Normalize whitespace (keep newlines).
    t = t
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    return t;
}

function setTextareaValueAndNotify(ta, nextValue) {
    if (!ta) return;

    // Use native setter to support "controlled" inputs (React/etc.).
    try {
        const proto = ta instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        const setter = desc && desc.set;
        if (setter) {
            setter.call(ta, nextValue);
        } else {
            ta.value = nextValue;
        }
    } catch (_) {
        ta.value = nextValue;
    }

    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
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
pyWaitSlider.addEventListener('input', (e) => { pythonWaitMs = parseInt(e.target.value); updateLabels(); });
spacingToggle.addEventListener('change', (e) => { isAutoSpacingOn = !!e.target.checked; });
brandSaveBtn.addEventListener('click', () => {
    const ok = saveBrandDictRaw(brandTextarea.value || '');
    if (ok) {
        setStatus('บันทึก Brand dictionary แล้ว');
        setTimeout(() => {
            if (isAutoPilotOn) setStatus('กำลังค้นหา target...');
            else setStatus('OFF');
        }, 1200);
    } else {
        setStatus('บันทึกไม่ได้ (storage)');
    }
});
brandResetBtn.addEventListener('click', () => {
    brandTextarea.value = '';
    saveBrandDictRaw('');
    setStatus('ล้าง Brand dictionary แล้ว');
    setTimeout(() => {
        if (isAutoPilotOn) setStatus('กำลังค้นหา target...');
        else setStatus('OFF');
    }, 1200);
});

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

                        // รอ Python วางข้อความ (ปรับได้จาก Settings)
                        console.log(`⏳ รอ Python ประมวลผล... (Max ${(pythonWaitMs / 1000).toFixed(1)}s)`);
                        setStatus('รอ Python ประมวลผล...');
                        let aiDone = false;
                        const pyStart = Date.now();
                        while (Date.now() - pyStart < pythonWaitMs) {
                            if (!isAutoPilotOn) return;
                            if (ta.value.trim() && ta.value !== beforeValue) {
                                aiDone = true;
                                console.log(`✨ Python วางข้อความเสร็จแล้ว!`);
                                setStatus('Python วางข้อความเสร็จแล้ว');
                                break;
                            }
                            await delay(250);
                        }
                        
                        if (!aiDone) {
                            console.log("⚠️ Python ตอบสนองช้าเกินไป! ฝืนเดินหน้าต่อ...");
                            setStatus('Python ไม่ตอบสนอง/ช้าเกินไป');
                        } else if (isAutoSpacingOn) {
                            try {
                                const formatted = formatSpacing(ta.value);
                                if (formatted && formatted !== ta.value) {
                                    setTextareaValueAndNotify(ta, formatted);
                                    console.log("🧩 จัดเว้นวรรค/จัดรูปแบบข้อความแล้ว");

                                    // Some UIs may re-apply their own value after our first input event.
                                    // Apply once more on the next tick to make it stick.
                                    setTimeout(() => {
                                        try {
                                            if (ta && ta.value !== formatted) {
                                                setTextareaValueAndNotify(ta, formatted);
                                            }
                                        } catch (_) {}
                                    }, 0);
                                }
                            } catch (e) {
                                console.log("⚠️ Auto spacing error:", e);
                            }
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