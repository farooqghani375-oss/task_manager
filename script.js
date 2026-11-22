/* ===================== Task Manager v3 ===================== */

const STORAGE_KEY = "taskManager.v2";      // same key as v2, so your tasks carry over
const SETTINGS_KEY = "taskManager.settings";
const DB_NAME = "taskManagerDB";
const DB_STORE = "files";
const ALARM_CHECK_MS = 15 * 1000;
const STALE_ALARM_MS = 10 * 60 * 1000;     // alarms missed by more than 10 min are skipped silently
const MAX_RINGTONE_BYTES = 10 * 1024 * 1024;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const $ = (id) => document.getElementById(id);

const els = {
    notifyBtn: $("notifyBtn"),
    settingsBtn: $("settingsBtn"),
    settingsPanel: $("settingsPanel"),
    optNotify: $("optNotify"),
    optVoice: $("optVoice"),
    userName: $("userName"),
    soundSelect: $("soundSelect"),
    testSoundBtn: $("testSoundBtn"),
    alarmStyle: $("alarmStyle"),
    voiceTemplate: $("voiceTemplate"),
    reminderTemplate: $("reminderTemplate"),
    testVoiceBtn: $("testVoiceBtn"),
    exportIcsBtn: $("exportIcsBtn"),
    uploadBtn: $("uploadBtn"),
    removeRingtoneBtn: $("removeRingtoneBtn"),
    ringtoneFile: $("ringtoneFile"),
    ringtoneInfo: $("ringtoneInfo"),
    form: $("taskForm"),
    input: $("taskInput"),
    dateInput: $("dateInput"),
    timeInput: $("timeInput"),
    remindSelect: $("remindSelect"),
    alarmInput: $("alarmInput"),
    hoursInput: $("hoursInput"),
    alarmToggle: $("alarmToggle"),
    alarmFields: $("alarmFields"),
    submitBtn: $("taskBtn"),
    cancelBtn: $("cancelEditBtn"),
    prevBtn: $("prevBtn"),
    nextBtn: $("nextBtn"),
    todayBtn: $("todayBtn"),
    periodLabel: $("periodLabel"),
    tabs: document.querySelectorAll(".tab"),
    searchInput: $("searchInput"),
    allBtn: $("allBtn"),
    completedBtn: $("completedBtn"),
    pendingBtn: $("pendingBtn"),
    taskContainer: $("taskContainer"),
    totalTasks: $("totalTasks"),
    doneTasks: $("doneTasks"),
    alarmPanel: $("alarmPanel"),
    installBtn: $("installBtn"),
    offlineNote: $("offlineNote"),
};

let swRegistration = null;        // set once the service worker is ready
let deferredInstallPrompt = null; // Android/desktop install prompt, captured from the browser

const DEFAULT_SETTINGS = {
    notifications: false,   // desktop pop-up notifications (on/off switch)
    alarmStyle: "both",     // "both" (ringtone + spoken), "ringtone", or "voice"
    voiceTemplate: "{name}, it's time to do the {task}.",
    reminderTemplate: "{name}, in {minutes} minutes it's time to do the {task}.",
    sound: "classic",       // preset key, "custom", or "silent"
    userName: "Abubakkar",
};

// Older default messages, replaced automatically so your saved settings pick up the new wording
const OLD_VOICE_TEMPLATE = "{name}, it's time to {task}.";
const OLD_REMINDER_TEMPLATE = "{name}, in {minutes} minutes it's time to {task}.";

let settings = loadSettings();
let tasks = loadTasks();
let currentView = "day";          // day | week | month | year | all
let selectedDate = todayKey();    // "YYYY-MM-DD"
let currentFilter = "all";        // all | completed | pending
let editingId = null;
let activeAlarms = [];            // alarms currently ringing

let audioCtx = null;
let ringing = false;
let ringTimer = null;
let customRingtone = null;        // { name, type, blob } from IndexedDB
let customUrl = "";
let customAudio = null;


/* ---------- Date helpers (local time) ---------- */

function pad(n) {
    return String(n).padStart(2, "0");
}

function dateKey(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseKey(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
}

function todayKey() {
    return dateKey(new Date());
}

function addDays(key, n) {
    const d = parseKey(key);
    d.setDate(d.getDate() + n);
    return dateKey(d);
}

function weekStart(key) {
    const d = parseKey(key);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return dateKey(d);
}

function atMs(dayKey, hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    const d = parseKey(dayKey);
    d.setHours(h, m, 0, 0);
    return d.getTime();
}

function fmtTime(hhmm) {
    if (!hhmm) return "";
    const [h, m] = hhmm.split(":").map(Number);
    return `${h % 12 || 12}:${pad(m)} ${h >= 12 ? "PM" : "AM"}`;
}

function fmtDateLong(key) {
    return parseKey(key).toLocaleDateString(undefined, {
        weekday: "short", month: "short", day: "numeric", year: "numeric"
    });
}

function fmtShortDate(key) {
    return parseKey(key).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtMinutes(m) {
    if (m === 0) return "at start";
    if (m < 60) return `${m} min before`;
    return `${m / 60} ${m === 60 ? "hour" : "hours"} before`;
}


/* ---------- Small helpers ---------- */

function el(tag, attrs = {}) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (key === "class") node.className = value;
        else node.setAttribute(key, value);
    }
    return node;
}

function emptyBox(message) {
    const box = el("div", { class: "empty" });
    box.textContent = message;
    return box;
}

function makePanel(title, extraClass = "") {
    const panel = el("section", { class: ("panel " + extraClass).trim() });
    const heading = el("h2", { class: "panel-title" });
    heading.textContent = title;
    panel.append(heading);
    return panel;
}

function sortTasks(list) {
    return [...list].sort((a, b) =>
        a.date.localeCompare(b.date) ||
        (a.time || "99:99").localeCompare(b.time || "99:99") ||
        a.id - b.id
    );
}

function applyFilters(list) {
    let out = list;
    if (currentFilter === "completed") out = out.filter((t) => t.completed);
    if (currentFilter === "pending") out = out.filter((t) => !t.completed);

    const query = els.searchInput.value.trim().toLowerCase();
    if (query) out = out.filter((t) => t.text.toLowerCase().includes(query));

    return out;
}


/* ---------- Settings & task storage ---------- */

function loadSettings() {
    try {
        const saved = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
        if (saved.voiceTemplate === OLD_VOICE_TEMPLATE) saved.voiceTemplate = DEFAULT_SETTINGS.voiceTemplate;
        if (saved.reminderTemplate === OLD_REMINDER_TEMPLATE) saved.reminderTemplate = DEFAULT_SETTINGS.reminderTemplate;
        return saved;
    } catch (err) {
        return { ...DEFAULT_SETTINGS };
    }
}

function saveSettings() {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (err) {
        // storage full or blocked; settings just won't persist
    }
}

function normalizeTask(t) {
    return {
        id: t.id,
        text: String(t.text || ""),
        date: t.date || todayKey(),
        time: t.time || "",
        completed: Boolean(t.completed),
        hours: typeof t.hours === "number" ? t.hours : null,
        remindBefore: typeof t.remindBefore === "number" ? t.remindBefore : null,
        alarmTime: t.alarmTime || "",
        fired: {
            before: Boolean(t.fired && t.fired.before),
            custom: Boolean(t.fired && t.fired.custom),
        },
    };
}

function loadTasks() {
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
        return Array.isArray(parsed) ? parsed.map(normalizeTask) : [];
    } catch (err) {
        return [];
    }
}

function saveTasks() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch (err) {
        alert("Could not save your tasks in this browser.");
    }
}


/* ---------- Custom ringtone storage (IndexedDB holds the audio file) ---------- */

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function dbPut(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function dbGet(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const request = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function dbDelete(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function loadCustomRingtone() {
    try {
        const record = await dbGet("ringtone");
        if (customUrl) URL.revokeObjectURL(customUrl);
        customRingtone = record || null;
        customUrl = record ? URL.createObjectURL(record.blob) : "";
        customAudio = null;
    } catch (err) {
        customRingtone = null;
        customUrl = "";
    }
}


/* ---------- Ringtones (built-in, generated with Web Audio) ---------- */

const note = (t, f, d = 0.25, w = "triangle", v = 0.3) => ({ t, f, d, w, v });
// Bell sound: a fundamental plus a softer overtone that gives it a metallic ring
const bell = (t, f, d = 1.0) => [note(t, f, d, "sine", 0.3), note(t, f * 2.76, d * 0.5, "sine", 0.08)];

const PRESETS = {
    classic: {
        label: "Classic bell",
        cycle: 2.6,
        notes: [note(0, 880), note(0.3, 880), note(0.6, 1100), note(1.3, 880), note(1.6, 880), note(1.9, 1100)],
    },
    chime: {
        label: "Soft chime",
        cycle: 2.8,
        notes: [...bell(0, 784), ...bell(0.25, 1047), ...bell(0.5, 1319), ...bell(0.75, 1568, 1.6)],
    },
    melody: {
        label: "Melody",
        cycle: 3.0,
        notes: [[0, 523], [0.25, 659], [0.5, 784], [0.75, 1047], [1.1, 784], [1.35, 659], [1.6, 523]]
            .map(([t, f]) => note(t, f, 0.22, "triangle", 0.3)),
    },
    pulse: {
        label: "Fast pulse",
        cycle: 2.0,
        notes: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => note(i * 0.18, 1000, 0.1, "square", 0.12)),
    },
    silent: {
        label: "Silent (no sound)",
        cycle: 2.0,
        notes: [],
    },
};

function getAudioCtx() {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === "suspended") audioCtx.resume();
        return audioCtx;
    } catch (err) {
        return null;
    }
}

function playTone(ctx, when, n) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = n.w;
    osc.frequency.setValueAtTime(n.f, when);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(n.v, when + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + n.d);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(when);
    osc.stop(when + n.d + 0.05);
}

function presetKey() {
    return PRESETS[settings.sound] ? settings.sound : "classic";
}

function playPreset(key) {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const base = ctx.currentTime + 0.05;
    try {
        PRESETS[key].notes.forEach((n) => playTone(ctx, base + n.t, n));
    } catch (err) {
        // audio not available
    }
}

function startPresetLoop() {
    stopPresetLoop();
    const key = presetKey();
    playPreset(key);
    ringTimer = setInterval(() => playPreset(key), PRESETS[key].cycle * 1000);
}

function stopPresetLoop() {
    clearInterval(ringTimer);
    ringTimer = null;
}

function playCustom() {
    if (!customUrl) return startPresetLoop();
    if (!customAudio) {
        customAudio = new Audio(customUrl);
        customAudio.loop = true;
    }
    customAudio.currentTime = 0;
    const attempt = customAudio.play();
    if (attempt && attempt.catch) {
        // Browser blocked autoplay: fall back to the built-in tone while alarms are still ringing
        attempt.catch(() => { if (ringing) startPresetLoop(); });
    }
}

function startRinging() {
    if (ringing) return;
    ringing = true;
    if (settings.sound === "custom" && customRingtone) playCustom();
    else startPresetLoop();
}

function stopRinging() {
    ringing = false;
    stopPresetLoop();
    if (customAudio) {
        customAudio.pause();
        customAudio.currentTime = 0;
    }
}

function previewSound() {
    if (settings.sound === "custom" && customUrl) {
        const preview = new Audio(customUrl);
        preview.play().catch(() => {});
        setTimeout(() => preview.pause(), 4000);
        return;
    }
    playPreset(presetKey());
}


/* ---------- Voice announcement ---------- */

// Replaces {name}, {task} and {minutes} in a message template
function fillTemplate(template, vars) {
    return template.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}

let voiceTimer = null;
let lastSpoken = "";

// The message keeps repeating in every spoken style until the alarm is dismissed
const VOICE_REPEAT_MS = 6000;

function startVoiceLoop(text) {
    lastSpoken = text;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    speak(text);
    if (!voiceTimer) {
        voiceTimer = setInterval(() => {
            if ("speechSynthesis" in window) window.speechSynthesis.cancel(); // never let two messages overlap
            speak(lastSpoken);
        }, VOICE_REPEAT_MS);
    }
}

function stopVoiceLoop() {
    clearInterval(voiceTimer);
    voiceTimer = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

function speak(text) {
    if (!("speechSynthesis" in window)) return;
    try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "en-US";
        utterance.rate = 0.95;
        window.speechSynthesis.speak(utterance);
    } catch (err) {
        // speech not available in this browser
    }
}


/* ---------- Form ---------- */

// Alarm fields only show when "Set an alarm" is switched on,
// and the reminder dropdown also needs a start time.
function syncRemindField() {
    const alarmOn = els.alarmToggle.checked;
    els.alarmFields.hidden = !alarmOn;
    els.remindSelect.disabled = !els.timeInput.value;
}

function resetForm() {
    editingId = null;
    els.input.value = "";
    els.dateInput.value = selectedDate;
    els.timeInput.value = "";
    els.alarmToggle.checked = false;
    els.hoursInput.value = "";
    els.alarmInput.value = "";
    els.remindSelect.value = "10";
    els.submitBtn.textContent = "Add Task";
    els.cancelBtn.hidden = true;
    syncRemindField();
}

function startEdit(id) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;

    editingId = id;
    els.input.value = task.text;
    els.dateInput.value = task.date;
    els.timeInput.value = task.time;
    els.remindSelect.value = task.remindBefore === null ? "none" : String(task.remindBefore);
    els.alarmInput.value = task.alarmTime;
    els.alarmToggle.checked = task.remindBefore !== null || !!task.alarmTime;
    els.hoursInput.value = task.hours ?? "";
    els.submitBtn.textContent = "Save Changes";
    els.cancelBtn.hidden = false;
    syncRemindField();

    els.input.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function onSubmit(e) {
    e.preventDefault();

    const text = els.input.value.trim();
    const date = els.dateInput.value;
    const time = els.timeInput.value;
    const hours = els.hoursInput.value ? Math.min(24, Math.max(0, Number(els.hoursInput.value))) : null;
    // Alarms are optional: when the switch is off, nothing is stored for them
    const alarmOn = els.alarmToggle.checked;
    const alarmTime = alarmOn ? els.alarmInput.value : "";
    const remindBefore = (!alarmOn || !time || els.remindSelect.value === "none")
        ? null
        : Number(els.remindSelect.value);

    if (!text) return alert("Please enter a task");
    if (!date) return alert("Please pick a date");

    if (editingId !== null) {
        const task = tasks.find((t) => t.id === editingId);
        if (task) {
            Object.assign(task, {
                text, date, time, hours, remindBefore, alarmTime,
                fired: { before: false, custom: false },
            });
        }
    } else {
        tasks.push({
            id: Date.now(),
            text,
            date,
            time,
            completed: false,
            hours,
            remindBefore,
            alarmTime,
            fired: { before: false, custom: false },
        });
    }

    selectedDate = date;
    resetForm();
    saveTasks();
    render();
    checkAlarms();
}

function deleteTask(id) {
    const task = tasks.find((t) => t.id === id);
    if (!task || !confirm(`Delete "${task.text}"?`)) return;

    tasks = tasks.filter((t) => t.id !== id);
    activeAlarms = activeAlarms.filter((a) => !a.id.startsWith(`${id}-`));
    if (editingId === id) resetForm();

    saveTasks();
    renderAlarms();
    render();
}


/* ---------- Navigation ---------- */

function setView(view) {
    currentView = view;
    render();
}

function setFilter(filter) {
    currentFilter = filter;
    render();
}

function openDay(key) {
    selectedDate = key;
    currentView = "day";
    if (!editingId) els.dateInput.value = key;
    render();
}

function shiftPeriod(dir) {
    if (currentView === "day") {
        selectedDate = addDays(selectedDate, dir);
    } else if (currentView === "week") {
        selectedDate = addDays(selectedDate, 7 * dir);
    } else if (currentView === "month") {
        const d = parseKey(selectedDate);
        d.setDate(1);
        d.setMonth(d.getMonth() + dir);
        selectedDate = dateKey(d);
    } else if (currentView === "year") {
        const year = Number(selectedDate.slice(0, 4)) + dir;
        selectedDate = `${year}-${selectedDate.slice(5, 10)}`;
    } else {
        return;
    }
    if (!editingId) els.dateInput.value = selectedDate;
    render();
}


/* ---------- Rendering ---------- */

function render() {
    renderTabs();
    renderPeriodLabel();
    renderView();
    updateStats();
}

function renderTabs() {
    els.tabs.forEach((tab) => {
        tab.classList.toggle("active", tab.dataset.view === currentView);
    });

    const navDisabled = currentView === "all";
    els.prevBtn.disabled = navDisabled;
    els.nextBtn.disabled = navDisabled;

    els.allBtn.classList.toggle("active", currentFilter === "all");
    els.completedBtn.classList.toggle("active", currentFilter === "completed");
    els.pendingBtn.classList.toggle("active", currentFilter === "pending");
}

function renderPeriodLabel() {
    let label;

    if (currentView === "day") {
        label = parseKey(selectedDate).toLocaleDateString(undefined, {
            weekday: "long", month: "long", day: "numeric", year: "numeric"
        });
    } else if (currentView === "week") {
        const start = weekStart(selectedDate);
        const end = addDays(start, 6);
        label = `${fmtShortDate(start)} – ${fmtShortDate(end)}, ${parseKey(end).getFullYear()}`;
    } else if (currentView === "month") {
        label = parseKey(selectedDate).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    } else if (currentView === "year") {
        label = selectedDate.slice(0, 4);
    } else {
        label = "All tasks";
    }

    els.periodLabel.textContent = label;
}

function renderView() {
    els.taskContainer.innerHTML = "";

    if (currentView === "day") renderDay();
    else if (currentView === "week") renderWeek();
    else if (currentView === "month") renderMonth();
    else if (currentView === "year") renderYear();
    else renderAll();
}

// Day view: each time of day gets its own panel
const DAY_GROUPS = [
    { label: "🌅 Morning", match: (t) => t !== "" && t < "12:00" },
    { label: "☀️ Afternoon", match: (t) => t >= "12:00" && t < "17:00" },
    { label: "🌙 Evening", match: (t) => t >= "17:00" },
    { label: "📌 Anytime", match: (t) => t === "" },
];

function renderDay() {
    const list = applyFilters(sortTasks(tasks.filter((t) => t.date === selectedDate)));

    if (!list.length) {
        els.taskContainer.append(emptyBox("No tasks for this day yet. Tap “Add task” to create one."));
        return;
    }

    DAY_GROUPS.forEach((group) => {
        const items = list.filter((t) => group.match(t.time));
        if (!items.length) return;

        const panel = makePanel(group.label, "time-group");
        items.forEach((task) => panel.append(buildCard(task)));
        els.taskContainer.append(panel);
    });
}

// Week view: a panel with one section per day
function renderWeek() {
    const start = weekStart(selectedDate);
    const panel = makePanel(`Week of ${fmtShortDate(start)}`);

    for (let i = 0; i < 7; i++) {
        const key = addDays(start, i);
        const dayCount = tasks.filter((t) => t.date === key).length;

        const section = el("div", { class: "day-section" + (key === todayKey() ? " today" : "") });

        const head = el("button", { type: "button", class: "day-head" });
        const label = el("span");
        label.textContent = parseKey(key).toLocaleDateString(undefined, {
            weekday: "long", month: "short", day: "numeric"
        });
        const count = el("span", { class: "meta" });
        count.textContent = `${dayCount} task${dayCount === 1 ? "" : "s"}`;
        head.append(label, count);
        head.addEventListener("click", () => openDay(key));
        section.append(head);

        const list = applyFilters(sortTasks(tasks.filter((t) => t.date === key)));
        if (list.length) list.forEach((task) => section.append(buildCard(task)));
        else section.append(emptyBox("Nothing scheduled"));

        panel.append(section);
    }

    els.taskContainer.append(panel);
}

// Month view: calendar grid
function renderMonth() {
    const monthStart = selectedDate.slice(0, 8) + "01";
    const month = parseKey(monthStart).getMonth();
    const gridStart = weekStart(monthStart);

    const panel = makePanel(parseKey(monthStart).toLocaleDateString(undefined, { month: "long", year: "numeric" }));
    const grid = el("div", { class: "month-grid" });

    WEEKDAYS.forEach((name) => {
        const head = el("div", { class: "month-head" });
        head.textContent = name;
        grid.append(head);
    });

    for (let i = 0; i < 42; i++) {
        grid.append(buildMonthCell(addDays(gridStart, i), month));
    }

    panel.append(grid);
    els.taskContainer.append(panel);
}

function buildMonthCell(key, month) {
    const date = parseKey(key);
    const dayTasks = applyFilters(sortTasks(tasks.filter((t) => t.date === key)));

    const classes = ["month-cell"];
    if (date.getMonth() !== month) classes.push("other");
    if (key === todayKey()) classes.push("today");
    if (key === selectedDate) classes.push("selected");

    const cell = el("button", { type: "button", class: classes.join(" ") });
    cell.addEventListener("click", () => openDay(key));

    const num = el("span", { class: "num" });
    num.textContent = date.getDate();
    cell.append(num);

    dayTasks.slice(0, 3).forEach((task) => {
        const chip = el("span", { class: "chip" + (task.completed ? " done" : "") });
        chip.textContent = (task.time ? fmtTime(task.time) + " " : "") + task.text;
        cell.append(chip);
    });

    if (dayTasks.length > 3) {
        const more = el("span", { class: "more" });
        more.textContent = `+${dayTasks.length - 3} more`;
        cell.append(more);
    }

    if (dayTasks.length) {
        const pill = el("span", { class: "count-pill" });
        pill.textContent = dayTasks.length;
        cell.append(pill);
    }

    return cell;
}

// Year view: one box per month, click to open that month
function renderYear() {
    const year = selectedDate.slice(0, 4);
    const panel = makePanel(`${year} overview`);
    const grid = el("div", { class: "year-grid" });

    for (let m = 1; m <= 12; m++) {
        const prefix = `${year}-${pad(m)}`;
        const list = applyFilters(tasks.filter((t) => t.date.startsWith(prefix)));
        const done = list.filter((t) => t.completed).length;

        const cell = el("button", {
            type: "button",
            class: "year-cell" + (prefix === selectedDate.slice(0, 7) ? " current" : "")
        });

        const name = el("span", { class: "year-name" });
        name.textContent = parseKey(`${prefix}-01`).toLocaleDateString(undefined, { month: "long" });

        const count = el("span", { class: "meta" });
        count.textContent = list.length
            ? `${list.length} task${list.length === 1 ? "" : "s"} · ${done} done`
            : "No tasks";

        const bar = el("span", { class: "bar" });
        const fill = el("span", { class: "bar-fill" });
        fill.style.width = list.length ? `${Math.round((done / list.length) * 100)}%` : "0%";
        bar.append(fill);

        cell.append(name, count, bar);
        cell.addEventListener("click", () => {
            selectedDate = `${prefix}-01`;
            currentView = "month";
            if (!editingId) els.dateInput.value = selectedDate;
            render();
        });
        grid.append(cell);
    }

    panel.append(grid);
    els.taskContainer.append(panel);
}

// All view: every task, grouped by date
function renderAll() {
    const list = applyFilters(sortTasks(tasks));

    if (!list.length) {
        els.taskContainer.append(emptyBox("No tasks yet. Tap “Add task” to create your first one."));
        return;
    }

    const panel = makePanel("All tasks");
    let lastDate = null;

    list.forEach((task) => {
        if (task.date !== lastDate) {
            const head = el("h4", { class: "date-head" });
            head.textContent = fmtDateLong(task.date) + (task.date === todayKey() ? "  · Today" : "");
            panel.append(head);
            lastDate = task.date;
        }
        panel.append(buildCard(task));
    });

    els.taskContainer.append(panel);
}

function metaText(task) {
    const parts = [];
    if (task.hours) parts.push(`⏱ ${task.hours} h`);
    if (task.time) parts.push(fmtTime(task.time));
    if (task.time && task.remindBefore !== null) parts.push(`🔔 ${fmtMinutes(task.remindBefore)}`);
    if (task.alarmTime) parts.push(`⏰ alarm ${fmtTime(task.alarmTime)}`);
    return parts.length ? parts.join(" · ") : "No start time";
}

function buildCard(task) {
    const card = el("div", { class: "card" + (task.completed ? " done" : "") });

    const check = el("input", { type: "checkbox", "aria-label": "Mark as completed" });
    check.checked = task.completed;
    check.addEventListener("change", () => {
        task.completed = check.checked;
        saveTasks();
        render();
    });

    const body = el("div", { class: "card-body" });

    const title = el("p", { class: "card-title" });
    title.textContent = task.text;
    if (task.completed) title.classList.add("completed");

    const meta = el("small", { class: "meta" });
    meta.textContent = metaText(task);
    body.append(title, meta);

    const actions = el("div", { class: "actions" });

    const editBtn = el("button", { type: "button", class: "small" });
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => startEdit(task.id));

    const delBtn = el("button", { type: "button", class: "small danger" });
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => deleteTask(task.id));

    actions.append(editBtn, delBtn);
    card.append(check, body, actions);
    return card;
}

function updateStats() {
    els.totalTasks.textContent = tasks.length;
    els.doneTasks.textContent = tasks.filter((t) => t.completed).length;
}


/* ---------- Alarms ---------- */

function checkAlarms() {
    const now = Date.now();
    let changed = false;

    tasks.forEach((task) => {
        if (task.completed) return;

        if (task.time && task.remindBefore !== null) {
            const startAt = atMs(task.date, task.time);
            const fireAt = startAt - task.remindBefore * 60000;
            // A reminder still counts as valid until the task itself starts
            changed = handleDue(task, "before", fireAt, now, Math.max(startAt, fireAt + STALE_ALARM_MS)) || changed;
        }

        if (task.alarmTime) {
            const fireAt = atMs(task.date, task.alarmTime);
            changed = handleDue(task, "custom", fireAt, now, fireAt + STALE_ALARM_MS) || changed;
        }
    });

    if (changed) saveTasks();
}

// Marks a reminder as fired. It only rings if it's still within its valid window,
// so an alarm missed while the app was closed for days stays silent.
function handleDue(task, kind, fireAt, now, validUntil) {
    if (task.fired[kind] || now < fireAt) return false;

    task.fired[kind] = true;
    if (now <= validUntil) raiseAlarm(task, kind);
    return true;
}

function raiseAlarm(task, kind) {
    const id = `${task.id}-${kind}`;
    if (activeAlarms.some((a) => a.id === id)) return;

    const name = settings.userName || DEFAULT_SETTINGS.userName;
    const vars = { name, task: task.text };
    let heading;
    let detail;
    let spoken;

    if (kind === "before") {
        heading = `🔔 ${task.text}`;
        if (task.remindBefore === 0) {
            detail = `Starts now · ${fmtTime(task.time)}`;
            spoken = fillTemplate(settings.voiceTemplate, vars);
        } else {
            detail = `Starts in ${task.remindBefore} min · ${fmtTime(task.time)}`;
            // Say the minutes actually left, which can be less than the reminder setting
            const minutesLeft = Math.max(1, Math.round((atMs(task.date, task.time) - Date.now()) / 60000));
            spoken = fillTemplate(settings.reminderTemplate, { ...vars, minutes: minutesLeft });
        }
    } else {
        heading = `⏰ ${task.text}`;
        detail = `Alarm · ${fmtTime(task.alarmTime)}`;
        spoken = fillTemplate(settings.voiceTemplate, vars);
    }

    activeAlarms.push({ id, heading, detail });
    renderAlarms();

    if (settings.alarmStyle !== "voice") startRinging();
    if (settings.alarmStyle !== "ringtone") startVoiceLoop(spoken);

    showBrowserNotification(heading, detail, id);
}

function renderAlarms() {
    els.alarmPanel.innerHTML = "";

    activeAlarms.forEach((alarm) => {
        const box = el("div", { class: "alarm" });

        const text = el("div", { class: "alarm-text" });
        const title = el("div", { class: "alarm-title" });
        title.textContent = alarm.heading;
        const sub = el("div", { class: "alarm-sub" });
        sub.textContent = alarm.detail;
        text.append(title, sub);

        const dismiss = el("button", { type: "button", class: "small" });
        dismiss.textContent = "Dismiss";
        dismiss.addEventListener("click", () => dismissAlarm(alarm.id));

        box.append(text, dismiss);
        els.alarmPanel.append(box);
    });

    if (!activeAlarms.length) {
        stopRinging();
        stopVoiceLoop();
    }
}

function dismissAlarm(id) {
    activeAlarms = activeAlarms.filter((a) => a.id !== id);
    renderAlarms();
}

function showBrowserNotification(title, body, tag) {
    if (!settings.notifications) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;

    // On phones, notifications must go through the service worker
    const options = {
        body,
        tag,
        icon: "icons/icon-192.png",
        badge: "icons/icon-192.png",
        vibrate: [300, 150, 300, 150, 300],
        renotify: true,
    };

    if (swRegistration && swRegistration.showNotification) {
        swRegistration.showNotification(title, options).catch(() => showDesktopNotification(title, options));
        return;
    }
    showDesktopNotification(title, options);
}

function showDesktopNotification(title, options) {
    try {
        new Notification(title, { body: options.body, tag: options.tag, icon: options.icon });
    } catch (err) {
        // notifications not available here
    }
}


/* ---------- PWA: service worker, install and offline status ---------- */

async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    try {
        swRegistration = await navigator.serviceWorker.register("service-worker.js");
    } catch (err) {
        // Only works when the site is served over http(s), not when the file is opened directly
    }
}

function isInstalled() {
    return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

function setupInstallButton() {
    // Chrome/Edge fire this only when the install conditions are met (HTTPS, service worker, icons)
    window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
    });

    window.addEventListener("appinstalled", () => {
        deferredInstallPrompt = null;
        els.installBtn.hidden = true;
    });

    // Always show the button when the app isn't installed yet, so it's never missing
    els.installBtn.hidden = isInstalled();

    els.installBtn.addEventListener("click", async () => {
        if (deferredInstallPrompt) {
            deferredInstallPrompt.prompt();
            try {
                await deferredInstallPrompt.userChoice;
            } catch (err) {
                // user dismissed the prompt
            }
            deferredInstallPrompt = null;
            return;
        }

        const ua = navigator.userAgent;
        if (/iphone|ipad|ipod/i.test(ua)) {
            alert("To install on iPhone:\n1. Open this page in Safari.\n2. Tap the Share button.\n3. Choose \"Add to Home Screen\".");
        } else if (/android/i.test(ua)) {
            alert("To install on Android:\n1. Tap the ⋮ menu in Chrome (top right).\n2. Tap \"Install app\" or \"Add to Home screen\".\n\nIf you don't see it, make sure you opened the app from its https:// web address, not a file on your phone.");
        } else {
            alert("To install on a computer:\nClick the install icon (⊕ or a monitor with an arrow) at the right end of the address bar, or open the ⋮ menu and choose \"Install Task Manager\".\n\nIf you don't see it, open the app from its https:// web address.");
        }
    });
}

// Shows whether the app can work offline (the service worker has saved the app files)
function updateOfflineStatus() {
    const status = document.getElementById("offlineStatus");
    if (!status) return;

    if (!("serviceWorker" in navigator)) {
        status.textContent = "⚠️ This browser can't save the app for offline use.";
    } else if (location.protocol === "file:") {
        status.textContent = "⚠️ Not offline-ready. Open the app from its https:// web address, not as a file.";
    } else if (navigator.serviceWorker.controller) {
        status.textContent = "✅ Works offline: the app is saved on this device.";
    } else {
        status.textContent = "⏳ Reload once while online to enable offline use.";
    }
}

function updateOnlineNote() {
    els.offlineNote.hidden = navigator.onLine;
}


/* ---------- Notification on/off ---------- */

function refreshNotifyUI() {
    const on = settings.notifications;
    els.notifyBtn.textContent = `🔔 Notifications: ${on ? "On" : "Off"}`;
    els.notifyBtn.setAttribute("aria-pressed", String(on));
    els.optNotify.checked = on;
}

async function setNotifications(on) {
    if (on) {
        if (!("Notification" in window)) {
            alert("This browser doesn't support notifications. Voice and sound alerts will still work.");
            on = false;
        } else {
            let permission = Notification.permission;
            if (permission === "default") {
                try {
                    permission = await Notification.requestPermission();
                } catch (err) {
                    permission = "default";
                }
            }
            if (permission !== "granted") {
                alert("Notifications are blocked for this site. Allow them in your browser's site settings, then turn this on again.");
                on = false;
            }
        }
    }

    settings.notifications = on;
    saveSettings();
    refreshNotifyUI();
}


/* ---------- Sound settings UI ---------- */

function refreshSoundUI() {
    const hasCustom = Boolean(customRingtone);
    if (settings.sound === "custom" && !hasCustom) settings.sound = "classic";

    els.soundSelect.innerHTML = "";
    Object.entries(PRESETS).forEach(([key, preset]) => {
        const option = el("option", { value: key });
        option.textContent = preset.label;
        els.soundSelect.append(option);
    });
    if (hasCustom) {
        const option = el("option", { value: "custom" });
        option.textContent = `Custom: ${customRingtone.name}`;
        els.soundSelect.append(option);
    }
    els.soundSelect.value = settings.sound;

    els.removeRingtoneBtn.hidden = !hasCustom;
    els.ringtoneInfo.textContent = hasCustom
        ? `Using your uploaded file "${customRingtone.name}" as the alarm.`
        : "Upload an MP3, WAV, OGG or M4A file up to 10 MB to use as your alarm.";
}


/* ---------- Calendar export (.ics) ----------
   Your phone's calendar app rings for each reminder even when this app is closed.
   The alarm shows the sentence as its title and plays the calendar's own sound. */

function icsEscape(text) {
    return String(text)
        .replace(/\\/g, "\\\\")
        .replace(/;/g, "\\;")
        .replace(/,/g, "\\,")
        .replace(/\r?\n/g, "\\n");
}

// Calendar files allow at most 75 characters per line
function foldLines(lines) {
    const out = [];
    lines.forEach((line) => {
        let rest = line;
        while (rest.length > 75) {
            out.push(rest.slice(0, 75));
            rest = " " + rest.slice(75);
        }
        out.push(rest);
    });
    return out;
}

function toMinutes(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
}

function buildEventLines(task, name) {
    const dayPart = task.date.replace(/-/g, "");
    const start = dayPart + "T" + task.time.replace(":", "") + "00";   // floating local time
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const sentence = fillTemplate(settings.voiceTemplate, { name, task: task.text });
    const reminderSentence = fillTemplate(settings.reminderTemplate, {
        name, task: task.text, minutes: task.remindBefore,
    });

    const lines = [
        "BEGIN:VEVENT",
        `UID:task-${task.id}@task-manager`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${start}`,
        "DURATION:PT30M",
        `SUMMARY:${icsEscape(sentence)}`,
        `DESCRIPTION:${icsEscape(task.text)}`,
    ];

    if (task.remindBefore !== null) {
        lines.push(
            "BEGIN:VALARM",
            "ACTION:DISPLAY",
            `DESCRIPTION:${icsEscape(task.remindBefore === 0 ? sentence : reminderSentence)}`,
            `TRIGGER:-PT${task.remindBefore}M`,
            "END:VALARM"
        );
    }

    if (task.alarmTime) {
        const diff = toMinutes(task.alarmTime) - toMinutes(task.time);   // minutes after start (negative = before)
        const trigger = diff < 0 ? `-PT${-diff}M` : `PT${diff}M`;
        lines.push(
            "BEGIN:VALARM",
            "ACTION:DISPLAY",
            `DESCRIPTION:${icsEscape(sentence)}`,
            `TRIGGER:${trigger}`,
            "END:VALARM"
        );
    }

    lines.push("END:VEVENT");
    return lines;
}

function exportCalendar() {
    const name = settings.userName || DEFAULT_SETTINGS.userName;
    const timed = tasks.filter((t) => t.time && !t.completed);

    if (!timed.length) {
        alert("Add a task with a start time first, then export.");
        return;
    }

    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Task Manager//EN", "CALSCALE:GREGORIAN"];
    timed.forEach((task) => lines.push(...buildEventLines(task, name)));
    lines.push("END:VCALENDAR");

    const ics = foldLines(lines).join("\r\n") + "\r\n";
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const link = el("a", { href: url, download: "task-manager.ics" });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}


/* ---------- Events & start-up ---------- */

function bindEvents() {
    els.form.addEventListener("submit", onSubmit);
    els.cancelBtn.addEventListener("click", () => {
        resetForm();
        render();
    });

    els.timeInput.addEventListener("input", syncRemindField);
    els.timeInput.addEventListener("change", syncRemindField);
    els.alarmToggle.addEventListener("change", syncRemindField);

    els.prevBtn.addEventListener("click", () => shiftPeriod(-1));
    els.nextBtn.addEventListener("click", () => shiftPeriod(1));
    els.todayBtn.addEventListener("click", () => openDay(todayKey()));

    els.tabs.forEach((tab) => {
        tab.addEventListener("click", () => setView(tab.dataset.view));
    });

    els.searchInput.addEventListener("input", render);
    els.allBtn.addEventListener("click", () => setFilter("all"));
    els.completedBtn.addEventListener("click", () => setFilter("completed"));
    els.pendingBtn.addEventListener("click", () => setFilter("pending"));

    // Notification switch (header) and checkbox (settings) control the same setting
    els.notifyBtn.addEventListener("click", () => setNotifications(!settings.notifications));
    els.optNotify.addEventListener("change", () => setNotifications(els.optNotify.checked));

    els.settingsBtn.addEventListener("click", () => {
        const open = els.settingsPanel.hidden;
        els.settingsPanel.hidden = !open;
        els.settingsBtn.setAttribute("aria-expanded", String(open));
    });

    els.alarmStyle.addEventListener("change", () => {
        settings.alarmStyle = els.alarmStyle.value;
        saveSettings();
        if (settings.alarmStyle === "ringtone") stopVoiceLoop();
    });

    els.userName.addEventListener("change", () => {
        settings.userName = els.userName.value.trim() || DEFAULT_SETTINGS.userName;
        els.userName.value = settings.userName;
        saveSettings();
    });

    els.voiceTemplate.addEventListener("change", () => {
        settings.voiceTemplate = els.voiceTemplate.value.trim() || DEFAULT_SETTINGS.voiceTemplate;
        els.voiceTemplate.value = settings.voiceTemplate;
        saveSettings();
    });

    els.reminderTemplate.addEventListener("change", () => {
        settings.reminderTemplate = els.reminderTemplate.value.trim() || DEFAULT_SETTINGS.reminderTemplate;
        els.reminderTemplate.value = settings.reminderTemplate;
        saveSettings();
    });

    els.testVoiceBtn.addEventListener("click", () => {
        getAudioCtx();
        speak(fillTemplate(settings.voiceTemplate, { name: settings.userName, task: "go for a walk" }));
    });

    els.soundSelect.addEventListener("change", () => {
        settings.sound = els.soundSelect.value;
        saveSettings();
    });

    els.testSoundBtn.addEventListener("click", () => {
        getAudioCtx();
        previewSound();
        speak(`${settings.userName}, this is a test of your alarm voice.`);
    });

    els.exportIcsBtn.addEventListener("click", exportCalendar);

    els.uploadBtn.addEventListener("click", () => els.ringtoneFile.click());

    els.ringtoneFile.addEventListener("change", async () => {
        const file = els.ringtoneFile.files[0];
        els.ringtoneFile.value = "";
        if (!file) return;

        const isAudio = file.type.startsWith("audio/") || /\.(mp3|wav|ogg|m4a)$/i.test(file.name);
        if (!isAudio) return alert("Please choose an audio file (MP3, WAV, OGG or M4A).");
        if (file.size > MAX_RINGTONE_BYTES) return alert("That file is over 10 MB. Please choose a smaller file.");

        try {
            await dbPut("ringtone", { name: file.name, type: file.type, blob: file });
            await loadCustomRingtone();
            settings.sound = "custom";
            saveSettings();
            refreshSoundUI();
        } catch (err) {
            alert("Could not save this ringtone in your browser.");
        }
    });

    els.removeRingtoneBtn.addEventListener("click", async () => {
        try {
            await dbDelete("ringtone");
        } catch (err) {
            // nothing stored or storage unavailable
        }
        await loadCustomRingtone();
        settings.sound = "classic";
        saveSettings();
        refreshSoundUI();
    });

    // Browsers only allow sound after a click, so start audio on the first click
    document.addEventListener("click", getAudioCtx);

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) checkAlarms();
    });
}

async function init() {
    // If the browser permission was removed, don't leave the switch showing "On"
    if (settings.notifications && (!("Notification" in window) || Notification.permission !== "granted")) {
        settings.notifications = false;
        saveSettings();
    }

    els.alarmStyle.value = settings.alarmStyle;
    els.userName.value = settings.userName;
    els.voiceTemplate.value = settings.voiceTemplate;
    els.reminderTemplate.value = settings.reminderTemplate;

    bindEvents();
    resetForm();
    refreshNotifyUI();

    setupInstallButton();
    updateOnlineNote();
    window.addEventListener("online", updateOnlineNote);
    window.addEventListener("offline", updateOnlineNote);
    await registerServiceWorker();
    updateOfflineStatus();
    navigator.serviceWorker && navigator.serviceWorker.addEventListener("controllerchange", updateOfflineStatus);

    await loadCustomRingtone();
    refreshSoundUI();

    render();
    checkAlarms();
    setInterval(checkAlarms, ALARM_CHECK_MS);
}

init();
