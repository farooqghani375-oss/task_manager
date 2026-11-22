/* Navigation between the three pages (Tasks, Add task, Settings) and the phone menu.
   Page switching runs in the capture phase, so it happens before script.js handles the same click.
   script.js still does all the task and alarm work; it only needs its elements to exist. */

(function () {
    const $ = (id) => document.getElementById(id);

    const menuBtn = $("menuBtn");
    const headerActions = $("headerActions");
    const phoneQuery = window.matchMedia("(max-width: 640px)");

    const pages = {
        tasks: $("tasksPage"),
        add: $("addPage"),
        targets: $("targetsPage"),
        settings: $("settingsPanel"),
    };
    const pageButtons = document.querySelectorAll("button[data-page]");

    /* ---------- Pages ---------- */

    function showPage(name, { scroll = true } = {}) {
        if (!pages[name]) name = "tasks";

        for (const key of Object.keys(pages)) {
            pages[key].hidden = key !== name;
        }

        document.body.dataset.page = name;

        pageButtons.forEach((btn) => {
            const on = btn.dataset.page === name;
            btn.classList.toggle("active", on);
            if (on) btn.setAttribute("aria-current", "page");
            else btn.removeAttribute("aria-current");
        });

        $("settingsBtn").setAttribute("aria-expanded", String(name === "settings"));

        if (name === "targets" && window.renderTargetsPage) window.renderTargetsPage();

        if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
    }

    /* ---------- Phone menu ---------- */

    function setMenuOpen(open) {
        headerActions.classList.toggle("is-open", open);
        menuBtn.classList.toggle("is-open", open);
        menuBtn.setAttribute("aria-expanded", String(open));
        menuBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    }

    const menuIsOpen = () => headerActions.classList.contains("is-open");

    menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        setMenuOpen(!menuIsOpen());
    });

    document.addEventListener("click", (e) => {
        if (!menuIsOpen()) return;
        if (!headerActions.contains(e.target) && !menuBtn.contains(e.target)) setMenuOpen(false);
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && menuIsOpen()) {
            setMenuOpen(false);
            menuBtn.focus();
        }
    });

    phoneQuery.addEventListener("change", () => setMenuOpen(false));

    /* ---------- Clicks ---------- */

    document.addEventListener(
        "click",
        (e) => {
            // Page buttons. Settings works as a toggle: a second click returns to Tasks.
            const pageBtn = e.target.closest("button[data-page]");
            if (pageBtn) {
                e.stopImmediatePropagation();
                const target = pageBtn.dataset.page;
                const current = document.body.dataset.page;
                showPage(target === "settings" && current === "settings" ? "tasks" : target);
                if (phoneQuery.matches) setMenuOpen(false);
                return;
            }

            // Editing a task opens the Add task page, where the form lives
            const btn = e.target.closest("button");
            if (btn && btn.textContent.trim() === "Edit" && btn.closest("#taskContainer")) {
                showPage("add", { scroll: false });
            }
        },
        true
    );

    showPage("tasks", { scroll: false });
})();
