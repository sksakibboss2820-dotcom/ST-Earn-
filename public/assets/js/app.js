/* =========================================================
   ST EARN MINI APP - SAFE FRONTEND
   ========================================================= */

"use strict";

const API = "/api";

const state = {
    initData: "",
    user: null,
    isAdmin: false,
    config: null,
    settings: null,
    tasks: [],
    withdrawals: [],
    referrals: [],
    selectedTask: null
};


/* =========================================================
   HELPERS
========================================================= */

function $(id) {
    return document.getElementById(id);
}

function on(id, event, callback) {
    const el = $(id);

    if (!el) {
        console.warn("ST Earn: Missing element #" + id);
        return;
    }

    el.addEventListener(event, callback);
}

function qs(selector) {
    return document.querySelector(selector);
}

function qsa(selector) {
    return document.querySelectorAll(selector);
}

function money(value) {
    const n = Number(value || 0);

    return n.toFixed(2);
}

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function showToast(message) {

    let toast = $("toast");

    if (!toast) {

        toast = document.createElement("div");

        toast.id = "toast";

        toast.style.position = "fixed";
        toast.style.left = "50%";
        toast.style.bottom = "25px";
        toast.style.transform = "translateX(-50%)";
        toast.style.zIndex = "99999";
        toast.style.padding = "12px 18px";
        toast.style.borderRadius = "14px";
        toast.style.background = "#15181d";
        toast.style.color = "#fff";
        toast.style.boxShadow =
            "0 10px 30px rgba(0,0,0,.35)";
        toast.style.fontSize = "14px";
        toast.style.maxWidth = "85%";
        toast.style.textAlign = "center";

        document.body.appendChild(toast);
    }

    toast.textContent = message;

    toast.style.display = "block";

    clearTimeout(window.__toastTimer);

    window.__toastTimer = setTimeout(() => {
        toast.style.display = "none";
    }, 2500);
}


/* =========================================================
   TELEGRAM
========================================================= */

function telegram() {

    if (
        window.Telegram &&
        window.Telegram.WebApp
    ) {
        return window.Telegram.WebApp;
    }

    return null;
}


function initTelegram() {

    const tg = telegram();

    if (!tg) {
        console.warn(
            "Telegram WebApp SDK not detected."
        );
        return;
    }

    try {
        tg.ready();
        tg.expand();
    } catch (e) {
        console.warn(e);
    }

    state.initData = tg.initData || "";

    if (tg.initDataUnsafe?.user) {

        state.telegramUser =
            tg.initDataUnsafe.user;
    }
}


/* =========================================================
   API
========================================================= */

async function api(
    endpoint,
    options = {}
) {

    const headers = {
        "Content-Type":
            "application/json",
        ...(options.headers || {})
    };

    if (state.initData) {

        headers[
            "X-Telegram-Init-Data"
        ] = state.initData;
    }

    const response = await fetch(
        API + endpoint,
        {
            ...options,
            headers
        }
    );

    let data = {};

    try {
        data = await response.json();
    } catch {
        data = {};
    }

    if (!response.ok) {

        throw new Error(
            data.error ||
            "Something went wrong."
        );
    }

    return data;
}


/* =========================================================
   CONFIG
========================================================= */

async function loadConfig() {

    try {

        state.config =
            await api("/config");

        applyConfig();

    } catch (e) {

        console.error(e);

        showToast(
            "Unable to load app configuration."
        );
    }
}


function applyConfig() {

    const c = state.config;

    if (!c) return;

    document.title =
        c.appName || "ST Earn";

    const nameElements = [
        "appName",
        "brandName",
        "logoName"
    ];

    nameElements.forEach(id => {

        const el = $(id);

        if (el) {
            el.textContent =
                c.appName || "ST Earn";
        }
    });

    const logoElements = [
        "appLogo",
        "logo",
        "brandLogo"
    ];

    logoElements.forEach(id => {

        const el = $(id);

        if (!el) return;

        if (c.logoUrl) {

            if (
                el.tagName === "IMG"
            ) {
                el.src = c.logoUrl;
            }
        }
    });

    const announcement =
        $("announcement");

    if (
        announcement &&
        c.announcement
    ) {
        announcement.textContent =
            c.announcement;
    }

    if (c.maintenance) {

        showToast(
            "Maintenance mode is active."
        );
    }
}


/* =========================================================
   USER
========================================================= */

async function loadMe() {

    try {

        const data =
            await api("/me");

        state.user =
            data.user || null;

        state.isAdmin =
            Boolean(data.isAdmin);

        if (data.themeData) {
            applyThemeData(
                data.themeData
            );
        }

        renderUser();

        updateAdminVisibility();

    } catch (e) {

        console.error(e);

        showToast(
            e.message ||
            "Unable to load account."
        );
    }
}


function renderUser() {

    const u = state.user;

    if (!u) return;

    const balance =
        money(u.balance);

    const values = {
        balance,
        userBalance: balance,
        totalBalance: balance,
        totalEarned:
            money(u.totalEarned),
        tasksDone:
            String(u.tasksDone || 0),
        referrals:
            String(u.referrals || 0),
        username:
            u.username
                ? "@" + u.username
                : "",
        firstName:
            u.firstName || "User"
    };

    Object.entries(values)
        .forEach(([id, value]) => {

            const el = $(id);

            if (el) {
                el.textContent = value;
            }
        });

    const welcome =
        $("welcomeName");

    if (welcome) {
        welcome.textContent =
            u.firstName || "User";
    }

    const avatar =
        $("userAvatar");

    if (
        avatar &&
        state.telegramUser
    ) {

        const letter =
            (
                state.telegramUser.first_name ||
                "U"
            )
                .charAt(0)
                .toUpperCase();

        avatar.textContent =
            letter;
    }
}


/* =========================================================
   THEME
========================================================= */

function applyThemeData(data) {

    if (!data) return;

    const root =
        document.documentElement;

    const vars = {
        "--primary":
            data.primary,
        "--secondary":
            data.secondary,
        "--background":
            data.background,
        "--card":
            data.card,
        "--text":
            data.text,
        "--muted":
            data.muted
    };

    Object.entries(vars)
        .forEach(([name, value]) => {

            if (value) {
                root.style.setProperty(
                    name,
                    value
                );
            }
        });

    if (data.primary) {

        document.body.style.setProperty(
            "--primary",
            data.primary
        );
    }
}


async function changeTheme(theme) {

    try {

        await api(
            "/theme",
            {
                method: "POST",
                body: JSON.stringify({
                    theme
                })
            }
        );

        await loadMe();

        closeThemeSheet();

        showToast(
            "Theme updated."
        );

    } catch (e) {

        showToast(e.message);
    }
}


function openThemeSheet() {

    const sheet =
        $("themeSheet");

    const overlay =
        $("themeOverlay");

    if (sheet) {
        sheet.classList.add("active");
    }

    if (overlay) {
        overlay.classList.add("active");
    }

    renderThemes();
}


function closeThemeSheet() {

    const sheet =
        $("themeSheet");

    const overlay =
        $("themeOverlay");

    if (sheet) {
        sheet.classList.remove("active");
    }

    if (overlay) {
        overlay.classList.remove("active");
    }
}


function renderThemes() {

    const container =
        $("themeList");

    if (!container) return;

    const themes =
        state.config?.themes || {};

    container.innerHTML = "";

    Object.entries(themes)
        .forEach(([key, theme]) => {

            const button =
                document.createElement("button");

            button.type = "button";

            button.className =
                "theme-option";

            button.innerHTML = `
                <span
                    style="
                    width:28px;
                    height:28px;
                    border-radius:50%;
                    display:inline-block;
                    background:${escapeHTML(theme.primary)};
                    margin-right:10px;
                    "
                ></span>

                <span>
                    ${escapeHTML(theme.name || key)}
                </span>
            `;

            button.addEventListener(
                "click",
                () => changeTheme(key)
            );

            container.appendChild(button);
        });
}


/* =========================================================
   PAGES
========================================================= */

function showPage(pageId) {

    const pages =
        qsa("[data-page-content]");

    pages.forEach(page => {

        page.style.display =
            page.id === pageId
                ? ""
                : "none";
    });

    const explicit =
        $(pageId);

    if (explicit) {
        explicit.style.display = "";
    }

    qsa("[data-page]")
        .forEach(button => {

            button.classList.toggle(
                "active",
                button.dataset.page ===
                pageId
            );
        });

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}


/* =========================================================
   MENU SHEET
========================================================= */

function openMenuSheet() {

    const sheet =
        $("menuSheet") ||
        $("sheet");

    const overlay =
        $("sheetOverlay");

    if (sheet) {
        sheet.classList.add("active");
    }

    if (overlay) {
        overlay.classList.add("active");
    }
}


function closeMenuSheet() {

    const sheet =
        $("menuSheet") ||
        $("sheet");

    const overlay =
        $("sheetOverlay");

    if (sheet) {
        sheet.classList.remove("active");
    }

    if (overlay) {
        overlay.classList.remove("active");
    }
}


/* =========================================================
   TASKS
========================================================= */

async function loadTasks() {

    try {

        const data =
            await api("/tasks");

        state.tasks =
            data.tasks || [];

        renderTasks();

    } catch (e) {

        console.error(e);

        showToast(
            e.message ||
            "Unable to load tasks."
        );
    }
}


function renderTasks() {

    const container =
        $("taskList") ||
        $("tasksList") ||
        $("tasks");

    if (!container) {
        console.warn(
            "Task container not found."
        );
        return;
    }

    container.innerHTML = "";

    if (!state.tasks.length) {

        container.innerHTML = `
            <div class="empty-state">
                No tasks available right now.
            </div>
        `;

        return;
    }

    state.tasks.forEach(task => {

        const card =
            document.createElement("div");

        card.className =
            "task-card";

        card.innerHTML = `
            <div class="task-card-content">

                <div class="task-title">
                    ${escapeHTML(task.title)}
                </div>

                <div class="task-description">
                    ${escapeHTML(
                        task.description || ""
                    )}
                </div>

                <div class="task-bottom">

                    <span class="task-reward">
                        +${money(task.reward)} USDT
                    </span>

                    <button
                        type="button"
                        class="task-action"
                        data-task-id="${task.id}"
                    >
                        ${
                            task.completed
                                ? "Completed"
                                : "Start"
                        }
                    </button>

                </div>

            </div>
        `;

        const button =
            card.querySelector(
                ".task-action"
            );

        if (button) {

            if (task.completed) {

                button.disabled = true;

            } else {

                button.addEventListener(
                    "click",
                    () => openTask(task.id)
                );
            }
        }

        container.appendChild(card);
    });
}


function openTask(id) {

    const task =
        state.tasks.find(
            x => Number(x.id) === Number(id)
        );

    if (!task) return;

    state.selectedTask =
        task;

    const title =
        $("taskModalTitle");

    const description =
        $("taskModalDescription");

    const reward =
        $("taskModalReward");

    if (title) {
        title.textContent =
            task.title;
    }

    if (description) {
        description.textContent =
            task.description || "";
    }

    if (reward) {
        reward.textContent =
            "+" + money(task.reward) +
            " USDT";
    }

    const modal =
        $("taskModal");

    const overlay =
        $("taskModalOverlay");

    if (modal) {
        modal.classList.add("active");
    }

    if (overlay) {
        overlay.classList.add("active");
    }
}


function closeTaskModal() {

    const modal =
        $("taskModal");

    const overlay =
        $("taskModalOverlay");

    if (modal) {
        modal.classList.remove("active");
    }

    if (overlay) {
        overlay.classList.remove("active");
    }

    state.selectedTask = null;
}


function openSelectedTask() {

    const task =
        state.selectedTask;

    if (!task) return;

    if (task.url) {

        try {

            const tg =
                telegram();

            if (
                tg &&
                tg.openLink
            ) {

                tg.openLink(task.url);

            } else {

                window.open(
                    task.url,
                    "_blank"
                );
            }

        } catch {
            window.open(
                task.url,
                "_blank"
            );
        }
    }
}


async function completeSelectedTask() {

    const task =
        state.selectedTask;

    if (!task) return;

    try {

        const data =
            await api(
                `/tasks/${task.id}/complete`,
                {
                    method: "POST"
                }
            );

        showToast(
            `Task completed! +${money(
                data.reward
            )} USDT`
        );

        closeTaskModal();

        await Promise.all([
            loadMe(),
            loadTasks()
        ]);

    } catch (e) {

        showToast(e.message);
    }
}


/* =========================================================
   REFERRALS
========================================================= */

async function loadReferrals() {

    try {

        const data =
            await api("/referrals");

        state.referrals =
            data.referrals || [];

        const count =
            $("referralCount");

        if (count) {
            count.textContent =
                state.referrals.length;
        }

        const reward =
            $("referralReward");

        if (reward) {
            reward.textContent =
                money(data.referralReward);
        }

        const input =
            $("referralLink");

        if (
            input &&
            data.referralLink
        ) {
            input.value =
                data.referralLink;
        }

    } catch (e) {

        console.error(e);
    }
}


async function inviteFriends() {

    try {

        const data =
            await api("/referrals");

        const link =
            data.referralLink;

        if (!link) {

            showToast(
                "Referral link unavailable."
            );

            return;
        }

        const tg =
            telegram();

        const text =
            "Join ST Earn and earn rewards!";

        if (
            tg &&
            tg.openTelegramLink
        ) {

            const share =
                `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;

            tg.openTelegramLink(
                share
            );

        } else if (
            navigator.share
        ) {

            await navigator.share({
                title: "ST Earn",
                text,
                url: link
            });

        } else {

            await navigator.clipboard.writeText(
                link
            );

            showToast(
                "Referral link copied."
            );
        }

    } catch (e) {

        console.error(e);

        showToast(
            "Unable to share referral link."
        );
    }
}


/* =========================================================
   WITHDRAW
========================================================= */

async function submitWithdrawal() {

    const amountInput =
        $("withdrawAmount");

    const networkInput =
        $("withdrawNetwork");

    const addressInput =
        $("withdrawAddress");

    if (!amountInput) {

        showToast(
            "Withdrawal form not found."
        );

        return;
    }

    const amount =
        Number(amountInput.value || 0);

    const network =
        networkInput
            ? networkInput.value.trim()
            : "";

    const address =
        addressInput
            ? addressInput.value.trim()
            : "";

    try {

        const data =
            await api(
                "/withdrawals",
                {
                    method: "POST",
                    body: JSON.stringify({
                        amount,
                        network,
                        address
                    })
                }
            );

        showToast(
            "Withdrawal submitted."
        );

        amountInput.value = "";

        if (networkInput) {
            networkInput.value = "";
        }

        if (addressInput) {
            addressInput.value = "";
        }

        await Promise.all([
            loadMe(),
            loadWithdrawals()
        ]);

    } catch (e) {

        showToast(e.message);
    }
}


async function loadWithdrawals() {

    try {

        const data =
            await api(
                "/withdrawals"
            );

        state.withdrawals =
            data.withdrawals || [];

        renderWithdrawals();

    } catch (e) {

        console.error(e);
    }
}


function renderWithdrawals() {

    const container =
        $("withdrawalList") ||
        $("withdrawalsList");

    if (!container) return;

    container.innerHTML = "";

    if (!state.withdrawals.length) {

        container.innerHTML = `
            <div class="empty-state">
                No withdrawal history.
            </div>
        `;

        return;
    }

    state.withdrawals.forEach(item => {

        const row =
            document.createElement("div");

        row.className =
            "withdrawal-row";

        row.innerHTML = `
            <div>
                <strong>
                    ${money(item.amount)} USDT
                </strong>

                <small>
                    ${escapeHTML(
                        item.network || ""
                    )}
                </small>
            </div>

            <span>
                ${escapeHTML(
                    item.status || "pending"
                )}
            </span>
        `;

        container.appendChild(row);
    });
}


/* =========================================================
   ADMIN
========================================================= */

function updateAdminVisibility() {

    qsa(
        "[data-admin-only]"
    ).forEach(el => {

        el.style.display =
            state.isAdmin
                ? ""
                : "none";
    });

    const adminButton =
        $("adminSheetBtn");

    if (adminButton) {

        adminButton.style.display =
            state.isAdmin
                ? ""
                : "none";
    }
}


async function loadAdminSettings() {

    if (!state.isAdmin) return;

    try {

        const data =
            await api(
                "/admin/settings"
            );

        state.settings =
            data.settings;

        renderAdminSettings(
            data.settings
        );

    } catch (e) {

        showToast(e.message);
    }
}


function renderAdminSettings(s) {

    const map = {
        adminAppName:
            s.app_name,
        adminLogoUrl:
            s.logo_url,
        adminGlobalTheme:
            s.global_theme,
        adminReferralReward:
            s.referral_reward,
        adminMinimumWithdraw:
            s.minimum_withdraw,
        adminWithdrawFee:
            s.withdraw_fee,
        adminAnnouncement:
            s.announcement,
        adminTelegramChannel:
            s.telegram_channel
    };

    Object.entries(map)
        .forEach(([id, value]) => {

            const el = $(id);

            if (el) {
                el.value =
                    value ?? "";
            }
        });

    const userTheme =
        $("adminAllowUserTheme");

    if (userTheme) {
        userTheme.checked =
            Boolean(
                s.allow_user_theme
            );
    }

    const maintenance =
        $("adminMaintenance");

    if (maintenance) {
        maintenance.checked =
            Boolean(
                s.maintenance
            );
    }
}


async function saveAdminSettings() {

    if (!state.isAdmin) return;

    const data = {};

    const fields = {
        app_name:
            "adminAppName",
        logo_url:
            "adminLogoUrl",
        global_theme:
            "adminGlobalTheme",
        referral_reward:
            "adminReferralReward",
        minimum_withdraw:
            "adminMinimumWithdraw",
        withdraw_fee:
            "adminWithdrawFee",
        announcement:
            "adminAnnouncement",
        telegram_channel:
            "adminTelegramChannel"
    };

    Object.entries(fields)
        .forEach(([key, id]) => {

            const el = $(id);

            if (el) {
                data[key] =
                    el.value;
            }
        });

    const userTheme =
        $("adminAllowUserTheme");

    if (userTheme) {
        data.allow_user_theme =
            userTheme.checked;
    }

    const maintenance =
        $("adminMaintenance");

    if (maintenance) {
        data.maintenance =
            maintenance.checked;
    }

    try {

        await api(
            "/admin/settings",
            {
                method: "PUT",
                body: JSON.stringify(data)
            }
        );

        showToast(
            "Settings saved successfully."
        );

        await loadConfig();

    } catch (e) {

        showToast(e.message);
    }
}


/* =========================================================
   ADMIN TASKS
========================================================= */

async function loadAdminTasks() {

    if (!state.isAdmin) return;

    try {

        const data =
            await api(
                "/admin/tasks"
            );

        renderAdminTasks(
            data.tasks || []
        );

    } catch (e) {

        showToast(e.message);
    }
}


function renderAdminTasks(tasks) {

    const container =
        $("adminTaskList") ||
        $("adminTasks");

    if (!container) return;

    container.innerHTML = "";

    tasks.forEach(task => {

        const row =
            document.createElement("div");

        row.className =
            "admin-task-row";

        row.innerHTML = `
            <div>
                <strong>
                    ${escapeHTML(task.title)}
                </strong>

                <small>
                    ${money(task.reward)} USDT
                </small>
            </div>

            <div>
                <button
                    type="button"
                    data-delete-task="${task.id}"
                >
                    Delete
                </button>
            </div>
        `;

        const deleteButton =
            row.querySelector(
                "[data-delete-task]"
            );

        if (deleteButton) {

            deleteButton.addEventListener(
                "click",
                () =>
                    deleteAdminTask(
                        task.id
                    )
            );
        }

        container.appendChild(row);
    });
}


async function addAdminTask() {

    const title =
        $("adminTaskTitle");

    const description =
        $("adminTaskDescription");

    const url =
        $("adminTaskUrl");

    const reward =
        $("adminTaskReward");

    const type =
        $("adminTaskType");

    if (!title) {

        showToast(
            "Task form not found."
        );

        return;
    }

    try {

        await api(
            "/admin/tasks",
            {
                method: "POST",
                body: JSON.stringify({
                    title:
                        title.value.trim(),

                    description:
                        description
                            ? description.value.trim()
                            : "",

                    url:
                        url
                            ? url.value.trim()
                            : "",

                    reward:
                        reward
                            ? Number(
                                reward.value
                            )
                            : 0,

                    task_type:
                        type
                            ? type.value
                            : "custom"
                })
            }
        );

        showToast(
            "Task added."
        );

        title.value = "";

        if (description) {
            description.value = "";
        }

        if (url) {
            url.value = "";
        }

        if (reward) {
            reward.value = "";
        }

        await Promise.all([
            loadAdminTasks(),
            loadTasks()
        ]);

    } catch (e) {

        showToast(e.message);
    }
}


async function deleteAdminTask(id) {

    if (
        !confirm(
            "Delete this task?"
        )
    ) {
        return;
    }

    try {

        await api(
            `/admin/tasks/${id}`,
            {
                method: "DELETE"
            }
        );

        showToast(
            "Task deleted."
        );

        await Promise.all([
            loadAdminTasks(),
            loadTasks()
        ]);

    } catch (e) {

        showToast(e.message);
    }
}


/* =========================================================
   ADMIN USERS
========================================================= */

async function loadAdminUsers() {

    if (!state.isAdmin) return;

    try {

        const data =
            await api(
                "/admin/users"
            );

        renderAdminUsers(
            data.users || []
        );

    } catch (e) {

        showToast(e.message);
    }
}


function renderAdminUsers(users) {

    const container =
        $("adminUserList") ||
        $("adminUsers");

    if (!container) return;

    container.innerHTML = "";

    users.forEach(user => {

        const row =
            document.createElement("div");

        row.className =
            "admin-user-row";

        row.innerHTML = `
            <div>
                <strong>
                    ${escapeHTML(
                        user.first_name ||
                        user.username ||
                        user.telegram_id
                    )}
                </strong>

                <small>
                    ID: ${escapeHTML(
                        user.telegram_id
                    )}
                </small>
            </div>

            <div>
                <strong>
                    ${money(user.balance)}
                </strong>
            </div>
        `;

        container.appendChild(row);
    });
}


/* =========================================================
   ADMIN WITHDRAWALS
========================================================= */

async function loadAdminWithdrawals() {

    if (!state.isAdmin) return;

    try {

        const data =
            await api(
                "/admin/withdrawals"
            );

        renderAdminWithdrawals(
            data.withdrawals || []
        );

    } catch (e) {

        showToast(e.message);
    }
}


function renderAdminWithdrawals(items) {

    const container =
        $("adminWithdrawalList") ||
        $("adminWithdrawals");

    if (!container) return;

    container.innerHTML = "";

    items.forEach(item => {

        const row =
            document.createElement("div");

        row.className =
            "admin-withdrawal-row";

        row.innerHTML = `
            <div>
                <strong>
                    ${money(item.amount)} USDT
                </strong>

                <small>
                    ${escapeHTML(
                        item.network || ""
                    )}
                    -
                    ${escapeHTML(
                        item.address || ""
                    )}
                </small>
            </div>

            <div>
                <span>
                    ${escapeHTML(
                        item.status
                    )}
                </span>

                ${
                    item.status === "pending"
                        ? `
                        <button
                            type="button"
                            data-pay="${item.id}"
                        >
                            Paid
                        </button>

                        <button
                            type="button"
                            data-reject="${item.id}"
                        >
                            Reject
                        </button>
                        `
                        : ""
                }
            </div>
        `;

        const pay =
            row.querySelector(
                "[data-pay]"
            );

        const reject =
            row.querySelector(
                "[data-reject]"
            );

        if (pay) {

            pay.addEventListener(
                "click",
                () =>
                    updateWithdrawal(
                        item.id,
                        "paid"
                    )
            );
        }

        if (reject) {

            reject.addEventListener(
                "click",
                () =>
                    updateWithdrawal(
                        item.id,
                        "rejected"
                    )
            );
        }

        container.appendChild(row);
    });
}


async function updateWithdrawal(
    id,
    status
) {

    try {

        await api(
            `/admin/withdrawals/${id}`,
            {
                method: "PUT",
                body: JSON.stringify({
                    status
                })
            }
        );

        showToast(
            "Withdrawal updated."
        );

        await Promise.all([
            loadAdminWithdrawals(),
            loadMe()
        ]);

    } catch (e) {

        showToast(e.message);
    }
}


/* =========================================================
   REFRESH
========================================================= */

async function refreshAll() {

    await Promise.all([
        loadConfig(),
        loadMe(),
        loadTasks(),
        loadWithdrawals(),
        loadReferrals()
    ]);

    if (state.isAdmin) {

        await Promise.all([
            loadAdminSettings(),
            loadAdminTasks(),
            loadAdminUsers(),
            loadAdminWithdrawals()
        ]);
    }
}


/* =========================================================
   EVENT SETUP
========================================================= */

function setupEvents() {

    /*
       IMPORTANT:
       Every event uses `on()`.
       Missing HTML elements are ignored safely.
       Therefore:
       Cannot read properties of null
       (reading 'addEventListener')
       will not crash the application.
    */


    qsa("[data-page]")
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    const page =
                        button.dataset.page;

                    if (
                        page === "adminPage" &&
                        !state.isAdmin
                    ) {

                        showToast(
                            "Admin access required."
                        );

                        return;
                    }

                    showPage(page);
                }
            );
        });


    on(
        "menuButton",
        "click",
        openMenuSheet
    );


    on(
        "menuBtn",
        "click",
        openMenuSheet
    );


    on(
        "sheetOverlay",
        "click",
        closeMenuSheet
    );


    on(
        "closeSheet",
        "click",
        closeMenuSheet
    );


    on(
        "sheetClose",
        "click",
        closeMenuSheet
    );


    on(
        "sheetCloseBottom",
        "click",
        closeMenuSheet
    );


    on(
        "themeSheetBtn",
        "click",
        openThemeSheet
    );


    on(
        "themeButton",
        "click",
        openThemeSheet
    );


    on(
        "themeOverlay",
        "click",
        closeThemeSheet
    );


    on(
        "closeThemeSheet",
        "click",
        closeThemeSheet
    );


    on(
        "refreshButton",
        "click",
        refreshAll
    );


    on(
        "sheetRefresh",
        "click",
        async () => {

            closeMenuSheet();

            await refreshAll();
        }
    );


    on(
        "sheetHistory",
        "click",
        () => {

            closeMenuSheet();

            showPage(
                "walletPage"
            );
        }
    );


    on(
        "sheetInvite",
        "click",
        () => {

            closeMenuSheet();

            inviteFriends();
        }
    );


    on(
        "inviteButton",
        "click",
        inviteFriends
    );


    on(
        "adminSheetBtn",
        "click",
        () => {

            closeMenuSheet();

            if (state.isAdmin) {

                showPage(
                    "adminPage"
                );

                loadAdminSettings();
                loadAdminTasks();
                loadAdminUsers();
                loadAdminWithdrawals();
            }
        }
    );


    on(
        "withdrawButton",
        "click",
        submitWithdrawal
    );


    on(
        "taskOpenButton",
        "click",
        openSelectedTask
    );


    on(
        "taskCompleteButton",
        "click",
        completeSelectedTask
    );


    on(
        "closeTaskModal",
        "click",
        closeTaskModal
    );


    on(
        "taskModalOverlay",
        "click",
        closeTaskModal
    );


    on(
        "saveAdminSettings",
        "click",
        saveAdminSettings
    );


    on(
        "addAdminTask",
        "click",
        addAdminTask
    );


    on(
        "refreshAdminUsers",
        "click",
        loadAdminUsers
    );


    on(
        "refreshAdminWithdrawals",
        "click",
        loadAdminWithdrawals
    );


    qsa(
        "[data-theme]"
    ).forEach(button => {

        button.addEventListener(
            "click",
            () => {

                const theme =
                    button.dataset.theme;

                if (theme) {
                    changeTheme(theme);
                }
            }
        );
    });


    qsa(
        "[data-action]"
    ).forEach(button => {

        const action =
            button.dataset.action;

        if (!action) return;

        button.addEventListener(
            "click",
            () => {

                if (
                    action ===
                    "refresh"
                ) {
                    refreshAll();
                }

                if (
                    action ===
                    "invite"
                ) {
                    inviteFriends();
                }

                if (
                    action ===
                    "withdraw"
                ) {
                    showPage(
                        "withdrawPage"
                    );
                }

                if (
                    action ===
                    "tasks"
                ) {
                    showPage(
                        "tasksPage"
                    );
                }
            }
        );
    });
}


/* =========================================================
   SAFE ERROR HANDLER
========================================================= */

window.addEventListener(
    "error",
    event => {

        console.error(
            "ST Earn frontend error:",
            event.error || event.message
        );
    }
);


window.addEventListener(
    "unhandledrejection",
    event => {

        console.error(
            "ST Earn promise error:",
            event.reason
        );
    }
);


/* =========================================================
   START
========================================================= */

async function startApp() {

    try {

        initTelegram();

        setupEvents();

        await loadConfig();

        await loadMe();

        await Promise.all([
            loadTasks(),
            loadWithdrawals(),
            loadReferrals()
        ]);

        if (state.isAdmin) {

            await Promise.all([
                loadAdminSettings(),
                loadAdminTasks(),
                loadAdminUsers(),
                loadAdminWithdrawals()
            ]);
        }

        /*
          Default page.
        */

        const firstPage =
            state.isAdmin
                ? "homePage"
                : "homePage";

        if ($(firstPage)) {
            showPage(firstPage);
        }

        console.log(
            "ST Earn Mini App initialized successfully."
        );

    } catch (e) {

        console.error(
            "ST Earn initialization error:",
            e
        );

        showToast(
            e.message ||
            "Unable to start ST Earn."
        );
    }
}


if (
    document.readyState ===
    "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        startApp
    );

} else {

    startApp();
}
