// Core State
let appData = JSON.parse(localStorage.getItem('defterdar_v2')) || {
    settings: { schoolStart: '2024-09-16' },
    plans: []
};

// Force fix if user has old bad default
if (!localStorage.getItem('defterdar_16sept_fix_v2')) {
    appData.settings.schoolStart = '2024-09-16';
    localStorage.setItem('defterdar_v2', JSON.stringify(appData));
    localStorage.setItem('defterdar_16sept_fix_v2', 'true');
}

let currentWeek = 1;
let rawData = [];
let selectedWeekCol = -1;
let selectedContentCol = -1;
let activeLessonIdx = -1;
let deferredPrompt; // PWA Install prompt
let scheduleZoom = 1;

// Library Workers
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById('install-pwa-btn');
    if (installBtn && !isStandalone()) installBtn.style.display = 'flex';
});

function isStandalone() {
    return !!(window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone);
}

function isIos() {
    return /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
}

// Initialization
window.onload = () => {
    updateDateDisplay();
    renderDashboard();
    loadSchedule();
    applyTheme(appData.settings.theme || 'premium');

    // Bind global detail buttons once
    document.getElementById('viewFullBtn').onclick = () => viewFullPlan(activeLessonIdx);
    document.getElementById('deleteBtn').onclick = () => deletePlan(activeLessonIdx);
    document.getElementById('editLessonNameBtn').onclick = editLessonName;

    // Check iOS PWA Install Button Visibility
    const installBtn = document.getElementById('install-pwa-btn');
    if (installBtn && isIos() && !isStandalone()) {
        installBtn.style.display = 'flex';
    }

    // Schedule Touch Zoom Logic
    let touchStartDist = 0;
    let initialScale = 1;
    const schedImg = document.getElementById('scheduleImg');

    document.getElementById('scheduleImageContainer').addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            touchStartDist = Math.hypot(
                e.touches[0].pageX - e.touches[1].pageX,
                e.touches[0].pageY - e.touches[1].pageY
            );
            initialScale = scheduleZoom;
        }
    }, { passive: false });

    document.getElementById('scheduleImageContainer').addEventListener('touchmove', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            const dist = Math.hypot(
                e.touches[0].pageX - e.touches[1].pageX,
                e.touches[0].pageY - e.touches[1].pageY
            );
            const delta = dist / touchStartDist;
            scheduleZoom = Math.min(Math.max(0.5, initialScale * delta), 4);
            schedImg.style.transform = `scale(${scheduleZoom})`;
        }
    }, { passive: false });
};

function getMonday(d) {
    var day = d.getDay(),
        diff = d.getDate() - day + (day == 0 ? -6 : 1);
    return new Date(d.getFullYear(), d.getMonth(), diff);
}

function saveAll() {
    localStorage.setItem('defterdar_v2', JSON.stringify(appData));
}

// 📅 Date & Week Calculation
function updateDateDisplay() {
    const today = new Date();
    document.getElementById('currentDateDisplay').innerText = today.toLocaleDateString('tr-TR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    let week = 1;
    if (appData.settings && appData.settings.schoolStart) {
        const [y, m, d] = appData.settings.schoolStart.split('-');
        const start = new Date(y, m - 1, d);
        const startMonday = getMonday(start);
        const todayMonday = getMonday(today);
        startMonday.setHours(0, 0, 0, 0);
        todayMonday.setHours(0, 0, 0, 0);
        week = Math.floor((todayMonday - startMonday) / (7 * 24 * 60 * 60 * 1000)) + 1;
    }

    currentWeek = isNaN(week) ? 1 : Math.max(1, week);

    const weekEl = document.getElementById('currentWeekDisplay');
    if (weekEl) weekEl.innerText = `${currentWeek}. HAFTA`;
}

function changeGlobalWeek(val) {
    currentWeek = Math.max(1, currentWeek + val);

    if (!document.getElementById('view-lesson-detail').classList.contains('hidden')) {
        updateLessonDetailContent();
    } else {
        updateDateDisplay(); // This normally resets but we want in-memory nav too
        // Actually if we are in dashboard we just need to render
        renderDashboard();
    }
}

function resetToToday() {
    updateDateDisplay(); // Resets currentWeek to real date
    if (activeLessonIdx !== -1 && !document.getElementById('view-lesson-detail').classList.contains('hidden')) {
        updateLessonDetailContent();
    } else {
        renderDashboard();
    }
    alert("Gerçek tarihe dönüldü! 📅");
}

// 🎨 Render Functions
function renderDashboard() {
    const list = document.getElementById('activePlansList');
    const empty = document.getElementById('dashboardEmpty');
    list.innerHTML = '';

    if (appData.plans.length === 0) {
        empty.classList.remove('hidden');
        return;
    } else {
        empty.classList.add('hidden');
    }

    appData.plans.forEach((plan, idx) => {
        const card = document.createElement('div');
        card.className = 'lesson-card card';
        card.onclick = () => openLessonDetail(idx);
        card.innerHTML = `
            <div style="display:flex; align-items:center; gap:16px;">
                <div style="width:50px; height:50px; background:var(--primary-glow); border-radius:15px; display:flex; align-items:center; justify-content:center; font-size:24px;">📚</div>
                <div>
                    <div style="font-weight:700; font-size:17px; color:var(--text-main);">${plan.name}</div>
                    <div style="font-size:13px; color:var(--text-sub);">${plan.data.length} kazanım yüklü</div>
                </div>
            </div>
            <div style="color:var(--text-sub); font-size:24px; font-weight:300;">›</div>
        `;
        list.appendChild(card);
    });
}

function openLessonDetail(idx) {
    updateDateDisplay(); // Reset to real 'today' week before entering
    activeLessonIdx = idx;
    const plan = appData.plans[idx];
    document.getElementById('detailLessonName').innerText = plan.name;
    updateLessonDetailContent();
    switchView('lesson-detail');
}

function updateLessonDetailContent() {
    const plan = appData.plans[activeLessonIdx];
    if (!plan) return;

    const dates = getWeekDates(currentWeek);
    document.getElementById('detailWeekNum').innerText = currentWeek;
    document.getElementById('detailWeekDate').innerText = dates;

    const item = plan.data.find(d => {
        const weekVal = String(d.w).trim();
        const numMatch = weekVal.match(/\d+/);
        if (numMatch) return parseInt(numMatch[0]) === currentWeek;
        return false;
    });

    document.getElementById('detailOutcomeText').innerText = item ? item.c : 'Bu hafta için planlanmış bir kazanım bulunamadı.';

    const weekEl = document.getElementById('currentWeekDisplay');
    if (weekEl) weekEl.innerText = `${currentWeek}. HAFTA`;
}

function getWeekDates(weekNum) {
    if (!appData.settings.schoolStart) return "-";

    // Y-m-d format parsing correctly in local timezone
    const [y, m, d] = appData.settings.schoolStart.split('-');
    const start = new Date(y, m - 1, d);

    // Move to the beginning of the selected week (Mon)
    const mon = getMonday(start);
    mon.setDate(mon.getDate() + (weekNum - 1) * 7);

    // Find Friday of that week
    const fri = new Date(mon);
    fri.setDate(mon.getDate() + 4);

    const opt = { day: 'numeric', month: 'long' };
    return `${mon.toLocaleDateString('tr-TR', opt)} - ${fri.toLocaleDateString('tr-TR', opt)}`;
}

function editLessonName() {
    if (activeLessonIdx === -1) return;
    const plan = appData.plans[activeLessonIdx];
    const newName = prompt("Hocam, dersin yeni adını yazınız:", plan.name);
    if (newName !== null && newName.trim() !== "") {
        plan.name = newName.trim();
        saveAll();
        document.getElementById('detailLessonName').innerText = plan.name;
        renderDashboard();
    }
}

function deletePlan(idx) {
    if (confirm("Hocam, bu dersi ve tüm planını silmek istediğinize emin misiniz?")) {
        appData.plans.splice(idx, 1);
        saveAll();
        switchView('dashboard');
        renderDashboard();
    }
}

// 📂 Wizard Flow (Upload & Parsing)
function openWizard() {
    document.getElementById('wizardModal').classList.remove('hidden');
    resetWizard();
}

function closeWizard() {
    document.getElementById('wizardModal').classList.add('hidden');
}

function resetWizard() {
    document.getElementById('wizard-step-1').classList.remove('hidden');
    document.getElementById('wizard-step-2').classList.add('hidden');
    document.getElementById('file-input').value = '';
    document.getElementById('lesson-name').value = '';
    document.getElementById('file-label').innerText = 'Dosya Seçin';
    document.getElementById('next-to-step-2').style.display = 'none';
    document.getElementById('wizardGuideText').innerText = "👉 Lütfen önce HAFTA sütununa tıklayın.";
    selectedWeekCol = -1;
    selectedContentCol = -1;
    rawData = [];
}

document.getElementById('file-input').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Dosya ismini uzantısız al ve Ders Adı kutusuna yaz
    const fileName = file.name.replace(/\.[^/.]+$/, "");
    document.getElementById('lesson-name').value = fileName;

    document.getElementById('file-label').innerText = `Seçildi: ${file.name}`;
    document.getElementById('next-to-step-2').style.display = 'block';
    currentFile = file;
};

document.getElementById('next-to-step-2').onclick = async () => {
    if (!document.getElementById('lesson-name').value) {
        alert("Lütfen ders adını girin.");
        return;
    }

    const status = document.getElementById('parseStatus');
    if (status) { status.innerText = "⏳ Dosya işleniyor, lütfen bekleyin..."; status.style.display = "block"; }

    const ext = currentFile.name.split('.').pop().toLowerCase();
    if (ext === 'xlsx' || ext === 'xls') await parseExcel(currentFile);
    else if (ext === 'pdf') await parsePDF(currentFile);
    else if (ext === 'docx') await parseWord(currentFile);

    if (status) status.style.display = "none";

    if (rawData.length > 0) {
        document.getElementById('wizard-step-1').classList.add('hidden');
        document.getElementById('wizard-step-2').classList.remove('hidden');
        renderPreview();
    }
}

async function parseExcel(file) {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data);
    rawData = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
}

function openSchedule() {
    document.getElementById('scheduleModal').classList.remove('hidden');
}

function closeSchedule() {
    document.getElementById('scheduleModal').classList.add('hidden');
}

function uploadSchedule(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const base64 = e.target.result;
        appData.scheduleImg = base64;
        saveAll();
        loadSchedule();
    };
    reader.readAsDataURL(file);
}

function loadSchedule() {
    const img = document.getElementById('scheduleImg');
    const placeholder = document.getElementById('schedulePlaceholder');
    const container = document.getElementById('scheduleImageContainer');
    const controls = document.getElementById('scheduleZoomControls');
    const changeBtn = document.getElementById('scheduleChangeBtn');

    if (appData.scheduleImg) {
        img.src = appData.scheduleImg;
        placeholder.classList.add('hidden');
        container.classList.remove('hidden');
        controls.classList.remove('hidden');
        changeBtn.classList.remove('hidden');
    } else {
        placeholder.classList.remove('hidden');
        container.classList.add('hidden');
        controls.classList.add('hidden');
        changeBtn.classList.add('hidden');
    }
}

function zoomSchedule(delta) {
    scheduleZoom = Math.min(Math.max(0.5, scheduleZoom + delta), 3);
    document.getElementById('scheduleImg').style.transform = `scale(${scheduleZoom})`;
}

function resetZoomSchedule() {
    scheduleZoom = 1;
    document.getElementById('scheduleImg').style.transform = `scale(1)`;
}

// 🎨 Theme System
function applyTheme(themeName) {
    document.body.setAttribute('data-theme', themeName);
    appData.settings.theme = themeName;
    saveAll();

    // Update theme selectors in UI
    document.querySelectorAll('.theme-opt').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.theme === themeName);
    });
}

// 📲 PWA Installation
async function installPWA() {
    if (isIos()) {
        alert("Hocam, uygulamayı cihazınıza eklemek için:\n\n1. Safari tarayıcınızın alt (veya üst) kısmında bulunan 'Paylaş' (Kare içinden yukarı ok) ikonuna dokunun.\n\n2. Çıkan menüde aşağı kaydırıp 'Ana Ekrana Ekle' (Add to Home Screen) seçeneğini seçin.\n\nYüklendikten sonra bu buton görünmeyecektir.");
        return;
    }

    if (!deferredPrompt) {
        alert("Hocam, cihazınız veya tarayıcınızda otomatik yükleme algılanamadı. Genellikle tarayıcı menüsünün sağ üst köşesinde (Üç nokta) 'Ana Ekrana Ekle' veya 'Uygulamayı Yükle' seçeneğinden bunu yapabilirsiniz.");
        return;
    }

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
        const installBtn = document.getElementById('install-pwa-btn');
        if (installBtn) installBtn.style.display = 'none';
    }
    deferredPrompt = null;
}
async function parsePDF(file) {
    const data = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    let combined = [];

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();

        let lines = {};
        textContent.items.forEach(item => {
            const y = Math.round(item.transform[5] / 10);
            if (!lines[y]) lines[y] = [];
            lines[y].push(item);
        });

        const sortedYs = Object.keys(lines).sort((a, b) => b - a);
        sortedYs.forEach(y => {
            const sortedItems = lines[y].sort((a, b) => a.transform[4] - b.transform[4]);

            // Refine row: Merge items that are part of the same cell
            let refinedRow = [];
            if (sortedItems.length > 0) {
                let currentStr = "";
                let lastX = -999;

                sortedItems.forEach(item => {
                    if (item.transform[4] - lastX > 50) { // New cell gap
                        if (currentStr) refinedRow.push(currentStr.trim());
                        currentStr = item.str;
                    } else {
                        currentStr += " " + item.str;
                    }
                    lastX = item.transform[4] + item.width;
                });
                if (currentStr) refinedRow.push(currentStr.trim());
            }

            if (refinedRow.length > 0) combined.push(refinedRow);
        });
    }
    rawData = combined;
}

async function parseWord(file) {
    const data = await file.arrayBuffer();
    const res = await mammoth.convertToHtml({ arrayBuffer: data });
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = res.value;

    const table = tempDiv.querySelector('table');
    if (table) {
        let items = [];
        Array.from(table.rows).forEach(row => {
            items.push(Array.from(row.cells).map(c => c.innerText.trim()));
        });
        rawData = items;
    } else {
        alert("Word dosyasında tablo bulunamadı. Lütfen planın tablo formatında olduğundan emin olun.");
    }
}

function renderPreview() {
    let html = '<table>';
    // Show only first 6 rows for selection to keep it compact
    rawData.slice(0, 6).forEach((row, rIdx) => {
        html += '<tr>';
        row.forEach((cell, cIdx) => {
            // Truncate long text for preview
            const cleanCell = String(cell || '').substring(0, 30) + (String(cell || '').length > 30 ? '...' : '');
            html += `<td onclick="pickCol(${cIdx})" id="td-col-${cIdx}">${cleanCell}</td>`;
        });
        html += '</tr>';
    });
    document.getElementById('table-preview').innerHTML = html + '</table>';
}

function pickCol(idx) {
    if (selectedWeekCol === -1) {
        selectedWeekCol = idx;
        document.querySelectorAll(`#td-col-${idx}`).forEach(el => el.classList.add('selected-week'));
        document.getElementById('wizardGuideText').innerText = "✅ HAFTA seçildi. Şimdi KAZANIM sütununa tıklayın.";
    } else if (selectedContentCol === -1) {
        if (idx === selectedWeekCol) {
            alert("Hocam, kazanım sütunu hafta sütunuyla aynı olamaz. Lütfen başka bir sütun seçin.");
            return;
        }
        selectedContentCol = idx;
        document.querySelectorAll(`#td-col-${idx}`).forEach(el => el.classList.add('selected-content'));
        document.getElementById('wizardGuideText').innerText = "🚀 Harika! İki sütun da hazır. Kaydet butonuna basabilirsin.";
    }
}

document.getElementById('save-final-plan').onclick = () => {
    if (selectedWeekCol === -1 || selectedContentCol === -1) {
        alert("Hocam, önce sütunları seçmelisiniz. Lütfen sırasıyla Hafta ve Kazanım sütunlarına tıklayın.");
        return;
    }

    const cleanData = rawData
        .map(r => ({ w: r[selectedWeekCol], c: r[selectedContentCol] }))
        .filter(item => item.w && item.c);

    appData.plans.push({
        id: Date.now(),
        name: document.getElementById('lesson-name').value,
        data: cleanData
    });

    saveAll();
    closeWizard();
    renderDashboard();
    alert("Ders başarıyla kaydedildi! 🚀");
}

// ⚙️ Navigation & Settings
function switchView(view, btn) {
    document.querySelectorAll('.content-view').forEach(v => v.classList.add('hidden'));
    document.getElementById(`view-${view}`).classList.remove('hidden');

    if (btn) {
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        btn.classList.add('active');
    }
}

function openInfo() {
    document.getElementById('infoModal').classList.remove('hidden');
}

function closeInfo() {
    document.getElementById('infoModal').classList.add('hidden');
}

function openSettings() {
    document.getElementById('settingsModal').classList.remove('hidden');
    document.getElementById('school-start-date').value = appData.settings.schoolStart;
}

function closeSettings() {
    document.getElementById('settingsModal').classList.add('hidden');
}

function saveGlobalSettings() {
    appData.settings.schoolStart = document.getElementById('school-start-date').value;
    saveAll();
    updateDateDisplay();
    if (activeLessonIdx !== -1) updateLessonDetailContent();
    renderDashboard();
    closeSettings();
}

function viewFullPlan(idx) {
    if (idx === -1) idx = activeLessonIdx;
    const plan = appData.plans[idx];
    if (!plan) return;
    const titleEl = document.getElementById('viewPlanTitle');
    if (titleEl) titleEl.innerText = plan.name;
    let html = '<table><thead><tr style="background:var(--primary); color:white;"><th>Hafta</th><th>Tarih</th><th>Kazanım</th></tr></thead><tbody>';

    plan.data.forEach(d => {
        const weekVal = String(d.w).trim();
        const numMatch = weekVal.match(/\d+/);
        const weekNum = numMatch ? parseInt(numMatch[0]) : null;

        const dateStr = weekNum ? getWeekDates(weekNum) : "-";

        // Highlight current week
        const isCurrent = weekNum === currentWeek ? 'style="background:var(--primary-glow); font-weight:800;"' : '';

        html += `<tr ${isCurrent}>
            <td style="text-align:center;"><b>${d.w}</b></td>
            <td style="white-space:nowrap; font-size:10px;">${dateStr}</td>
            <td>${d.c}</td>
        </tr>`;
    });
    document.getElementById('viewPlanContent').innerHTML = html + '</tbody></table>';
    document.getElementById('viewPlanModal').classList.remove('hidden');
}

function closePlanView() {
    document.getElementById('viewPlanModal').classList.add('hidden');
}