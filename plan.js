/* Targets page and course planner.
   - Weekly targets: an hour goal for a week, progress comes from completed tasks that have hours.
   - Planner: upload a course PDF, the server (api/plan.js) assigns topics to study dates,
     you review and edit the preview, then it saves tasks and weekly targets.
   Uses helpers from script.js: $, el, tasks, saveTasks, render, addDays, weekStart, todayKey, fmtShortDate. */

(function () {
    const TARGETS_KEY = "taskManager.targets.v1";
    const MAX_PDF_BYTES = 3 * 1024 * 1024;
    const MAX_WEEKS = 26;

    let targets = loadTargets();
    let planDraft = null;   // { course, granularity, items: [{ date, title, subject, hours, weekStart, include }] }

    /* ---------- Storage ---------- */

    function loadTargets() {
        try {
            const parsed = JSON.parse(localStorage.getItem(TARGETS_KEY) || "[]");
            return Array.isArray(parsed) ? parsed.filter((t) => t && t.weekStart).map(normalizeTarget) : [];
        } catch (err) {
            return [];
        }
    }

    function normalizeTarget(t) {
        return {
            id: t.id || String(Date.now() + Math.random()),
            title: String(t.title || "").slice(0, 60),
            weekStart: t.weekStart,
            goalHours: Number(t.goalHours) > 0 ? Number(t.goalHours) : 1,
        };
    }

    function saveTargets() {
        try {
            localStorage.setItem(TARGETS_KEY, JSON.stringify(targets));
        } catch (err) {
            // storage full or blocked; targets just won't persist
        }
    }

    /* ---------- Helpers ---------- */

    const fmtHours = (h) => String(Math.round(h * 10) / 10);

    function weekProgress(monday) {
        const sunday = addDays(monday, 6);
        let done = 0;
        let planned = 0;
        for (const t of tasks) {
            if (t.date < monday || t.date > sunday || !t.hours) continue;
            planned += t.hours;
            if (t.completed) done += t.hours;
        }
        return { done, planned };
    }

    function setStatus(text, isError = false) {
        const p = $("planStatus");
        p.textContent = text;
        p.style.color = isError ? "var(--danger)" : "";
    }

    /* ---------- Weekly targets ---------- */

    function renderTargetList() {
        const list = $("targetList");
        list.innerHTML = "";

        if (!targets.length) {
            const empty = el("p", { class: "empty" });
            empty.textContent = "No targets yet. Add a weekly goal below, or generate a plan from a course PDF.";
            list.append(empty);
            return;
        }

        const sorted = [...targets].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
        for (const t of sorted) {
            const end = addDays(t.weekStart, 6);
            const { done } = weekProgress(t.weekStart);
            const pct = Math.min(100, (done / t.goalHours) * 100);
            const met = done >= t.goalHours;

            const card = el("div", { class: "target-card" + (met ? " met" : "") });

            const head = el("div", { class: "target-head" });
            const titles = el("div");
            const name = el("strong", { class: "target-name" });
            name.textContent = t.title || "Weekly goal";
            const range = el("span", { class: "meta" });
            range.textContent = `${fmtShortDate(t.weekStart)} – ${fmtShortDate(end)}`;
            titles.append(name, range);

            const del = el("button", { type: "button", class: "small danger", "data-target-delete": t.id });
            del.textContent = "Delete";
            head.append(titles, del);

            const progress = el("p", { class: "target-progress" });
            progress.textContent = `${fmtHours(done)} of ${fmtHours(t.goalHours)} h${met ? "  ✅" : ""}`;

            const bar = el("div", { class: "bar" });
            const fill = el("div", { class: "bar-fill" });
            fill.style.width = `${pct}%`;
            bar.append(fill);

            card.append(head, progress, bar);
            list.append(card);
        }
    }

    function onTargetSubmit(e) {
        e.preventDefault();
        const week = $("tgWeek").value;
        const goal = Number($("tgGoal").value);
        const title = $("tgTitle").value.trim();
        if (!week) return alert("Pick a week");
        if (!(goal > 0)) return alert("Enter a goal greater than 0");

        targets.push({
            id: String(Date.now()),
            title,
            weekStart: weekStart(week),
            goalHours: goal,
        });
        saveTargets();
        e.target.reset();
        $("tgWeek").value = weekStart(todayKey());
        renderTargetList();
    }

    function onTargetListClick(e) {
        const btn = e.target.closest("[data-target-delete]");
        if (!btn) return;
        const target = targets.find((t) => t.id === btn.dataset.targetDelete);
        if (!target || !confirm("Delete this target?")) return;
        targets = targets.filter((t) => t.id !== target.id);
        saveTargets();
        renderTargetList();
    }

    /* ---------- Planner: calendar of study slots ---------- */

    // One slot per study day, or one per week (on its first study day, with the week's total hours)
    function buildSlots(startKey, weekdays, hoursPerDay, granularity) {
        const slots = [];
        const firstMonday = weekStart(startKey);

        for (let w = 0; w < MAX_WEEKS; w++) {
            const monday = addDays(firstMonday, w * 7);
            const dates = weekdays
                .map((i) => addDays(monday, i))
                .filter((d) => d >= startKey)
                .sort();
            if (!dates.length) continue;

            if (granularity === "days") {
                for (const d of dates) slots.push({ date: d, week: w + 1, weekStart: monday, hours: hoursPerDay });
            } else {
                slots.push({
                    date: dates[0],
                    week: w + 1,
                    weekStart: monday,
                    hours: Math.round(hoursPerDay * dates.length * 10) / 10,
                });
            }
        }
        return slots;
    }

    function readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
            reader.onerror = () => reject(new Error("Could not read the file"));
            reader.readAsDataURL(file);
        });
    }

    /* ---------- Planner: generate ---------- */

    async function onPlanSubmit(e) {
        e.preventDefault();

        const file = $("planFile").files[0];
        const start = $("planStart").value;
        const hoursPerDay = Number($("planHours").value);
        const weekdays = [...document.querySelectorAll('input[name="wd"]:checked')].map((i) => Number(i.value));
        const granularity = document.querySelector('input[name="gran"]:checked').value;

        if (!file) return setStatus("Choose a PDF first.", true);
        if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) return setStatus("That file is not a PDF.", true);
        if (file.size > MAX_PDF_BYTES) return setStatus("That PDF is over 3 MB. Use a smaller file.", true);
        if (!start) return setStatus("Pick a start date.", true);
        if (!(hoursPerDay >= 0.5 && hoursPerDay <= 12)) return setStatus("Hours per study day must be between 0.5 and 12.", true);
        if (!weekdays.length) return setStatus("Choose at least one study day.", true);

        const slots = buildSlots(start, weekdays, hoursPerDay, granularity);
        if (!slots.length) return setStatus("No study dates fall in the next 6 months from that start date.", true);

        const button = $("planBtn");
        button.disabled = true;
        setStatus("Reading your course and building the plan. This can take up to a minute…");
        planDraft = null;
        $("planPreview").hidden = true;

        try {
            const pdfBase64 = await readFileAsBase64(file);
            const response = await fetch("api/plan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    pdfBase64,
                    granularity,
                    slots: slots.map((s) => ({ date: s.date, week: s.week })),
                }),
            });

            let data = {};
            try { data = await response.json(); } catch (err) { /* not JSON */ }
            if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);

            const bySlot = new Map(slots.map((s) => [s.date, s]));
            const items = (data.sessions || [])
                .filter((s) => bySlot.has(s.date))
                .map((s) => {
                    const slot = bySlot.get(s.date);
                    return {
                        date: s.date,
                        title: s.title,
                        subject: s.subject || "",
                        hours: slot.hours,
                        weekStart: slot.weekStart,
                        include: true,
                    };
                });

            if (!items.length) throw new Error("The AI did not find any sessions. Try a different PDF.");

            planDraft = { course: data.course || file.name.replace(/\.pdf$/i, ""), granularity, items };
            renderPlanPreview();
            setStatus("");
        } catch (err) {
            setStatus(err.message || "Something went wrong. Try again.", true);
        } finally {
            button.disabled = false;
        }
    }

    /* ---------- Planner: preview ---------- */

    function renderPlanPreview() {
        const list = $("planList");
        list.innerHTML = "";

        const included = planDraft.items.filter((i) => i.include);
        const totalHours = included.reduce((sum, i) => sum + i.hours, 0);
        const unit = planDraft.granularity === "weeks" ? "weeks" : "study days";
        const summary = $("planSummary");
        summary.textContent = `${planDraft.course}: ${included.length} ${unit}, ${fmtHours(totalHours)} hours in total. Untick any you don't want, and edit titles before saving.`;

        planDraft.items.forEach((item, index) => {
            const row = el("li", { class: "plan-row" + (item.include ? "" : " off") });

            const check = el("input", { type: "checkbox", "aria-label": "Include this session" });
            check.checked = item.include;
            check.dataset.index = String(index);
            check.dataset.role = "include";

            const info = el("div", { class: "plan-info" });
            const when = el("span", { class: "meta" });
            const dayName = new Date(item.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" });
            when.textContent = `${dayName}, ${fmtShortDate(item.date)} · ${fmtHours(item.hours)} h`;

            const title = el("input", { type: "text", maxlength: "120", "aria-label": "Session title" });
            title.value = item.title;
            title.dataset.index = String(index);
            title.dataset.role = "title";

            info.append(when, title);
            row.append(check, info);
            list.append(row);
        });

        $("planPreview").hidden = false;
        $("planSaveBtn").disabled = included.length === 0;
    }

    function onPlanListChange(e) {
        const index = Number(e.target.dataset.index);
        const item = planDraft && planDraft.items[index];
        if (!item) return;
        if (e.target.dataset.role === "include") item.include = e.target.checked;
        if (e.target.dataset.role === "title") item.title = e.target.value.trim() || "Study session";
        renderPlanPreview();
    }

    /* ---------- Planner: save ---------- */

    function savePlan() {
        if (!planDraft) return;
        const included = planDraft.items.filter((i) => i.include);
        if (!included.length) return;

        const stamp = Date.now();
        included.forEach((item, i) => {
            tasks.push({
                id: stamp + i,
                text: item.subject ? `${item.title} (${item.subject})` : item.title,
                date: item.date,
                time: "",
                completed: false,
                hours: item.hours,
                remindBefore: null,
                alarmTime: "",
                fired: { before: false, custom: false },
            });
        });

        // One weekly target per week covered. If a target already exists for that week, add to its goal.
        const weeks = [...new Set(included.map((i) => i.weekStart))].sort();
        weeks.forEach((monday, n) => {
            const hours = included
                .filter((i) => i.weekStart === monday)
                .reduce((sum, i) => sum + i.hours, 0);
            const existing = targets.find((t) => t.weekStart === monday);
            if (existing) {
                existing.goalHours = Math.round((existing.goalHours + hours) * 10) / 10;
            } else {
                targets.push({
                    id: String(stamp + 1000 + n),
                    title: `${planDraft.course} · Week ${n + 1}`.slice(0, 60),
                    weekStart: monday,
                    goalHours: Math.round(hours * 10) / 10,
                });
            }
        });

        saveTasks();
        saveTargets();
        render();
        renderTargetList();

        const savedCount = included.length;
        planDraft = null;
        $("planPreview").hidden = true;
        $("planFile").value = "";
        setStatus(`Saved ${savedCount} tasks and ${weeks.length} weekly targets. Find them on the Tasks and Targets pages.`);
    }

    function discardPlan() {
        planDraft = null;
        $("planPreview").hidden = true;
        setStatus("");
    }

    /* ---------- Setup ---------- */

    function init() {
        $("tgWeek").value = weekStart(todayKey());
        $("planStart").value = todayKey();

        $("targetForm").addEventListener("submit", onTargetSubmit);
        $("targetList").addEventListener("click", onTargetListClick);
        $("planForm").addEventListener("submit", onPlanSubmit);
        $("planList").addEventListener("change", onPlanListChange);
        $("planSaveBtn").addEventListener("click", savePlan);
        $("planDiscardBtn").addEventListener("click", discardPlan);

        renderTargetList();
    }

    // Called by nav.js whenever the Targets page is opened, so progress is current
    window.renderTargetsPage = renderTargetList;

    init();
})();
