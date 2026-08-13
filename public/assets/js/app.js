"use strict";

const tg = window.Telegram?.WebApp;

const state = {
  config: null,
  me: null,
  tasks: [],
  referrals: [],
  withdrawals: [],
  adminSettings: null,
  adminThemes: {},
  isAdmin: false,
  selectedTask: null,
  openedTask: false,
  currentPage: "homePage"
};

const $ = (id) => document.getElementById(id);

const api = async (url, options = {}) => {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (tg?.initData) {
    headers["X-Telegram-Init-Data"] = tg.initData;
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
};

function showToast(message) {
  $("toastText").textContent = message;
  $("toast").classList.add("show");

  clearTimeout(showToast.timer);

  showToast.timer = setTimeout(() => {
    $("toast").classList.remove("show");
  }, 2500);
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function taskIcon(type) {
  const icons = {
    visit: "🌐",
    watch: "▶",
    telegram: "✈",
    custom: "✓"
  };

  return icons[type] || "✓";
}

function applyTheme(theme) {
  if (!theme) return;

  document.documentElement.style.setProperty(
    "--primary",
    theme.primary
  );

  document.documentElement.style.setProperty(
    "--primary-2",
    theme.secondary
  );

  document.documentElement.style.setProperty(
    "--bg",
    theme.background
  );

  document.documentElement.style.setProperty(
    "--card",
    theme.card
  );

  document.documentElement.style.setProperty(
    "--text",
    theme.text
  );

  document.documentElement.style.setProperty(
    "--muted",
    theme.muted
  );
}

function telegramSetup() {
  if (!tg) return;

  tg.ready();
  tg.expand();

  try {
    tg.setHeaderColor(
      state.me?.themeData?.background || "#0d0f12"
    );

    tg.setBackgroundColor(
      state.me?.themeData?.background || "#0d0f12"
    );
  } catch {}

  tg.BackButton?.onClick(() => {
    if (state.currentPage !== "homePage") {
      showPage("homePage");
    } else {
      closeAllSheets();
    }
  });
}

async function loadConfig() {
  state.config = await api("/api/config");

  $("announcementText").textContent =
    state.config.announcement || "";

  document.title =
    state.config.appName || "ST Earn";

  if (state.config.logoUrl) {
    $("profileAvatar").innerHTML =
      `<img src="${escapeHtml(state.config.logoUrl)}" alt="Logo">`;
  }

  buildThemeList(
    state.config.themes || {},
    state.config.allowUserTheme
  );
}

async function loadMe() {
  const data = await api("/api/me");

  state.me = data.user;
  state.isAdmin = Boolean(data.isAdmin);

  applyTheme(data.themeData);

  const name =
    state.me.firstName ||
    state.me.username ||
    "User";

  $("profileName").textContent = name;

  $("profileAvatar").textContent =
    name.charAt(0).toUpperCase();

  if (state.config?.logoUrl) {
    $("profileAvatar").innerHTML =
      `<img src="${escapeHtml(state.config.logoUrl)}" alt="Logo">`;
  }

  updateBalanceUI();

  document
    .querySelectorAll(".admin-only")
    .forEach((el) => {
      el.style.display = state.isAdmin ? "" : "none";
    });

  if (state.isAdmin) {
    $("themeHint").textContent =
      "Choose or manage appearance";
  }
}

function updateBalanceUI() {
  if (!state.me) return;

  $("balance").textContent =
    money(state.me.balance);

  $("walletBalance").textContent =
    money(state.me.balance);

  $("totalEarned").textContent =
    `${money(state.me.totalEarned)} USDT`;

  $("tasksDone").textContent =
    state.me.tasksDone || 0;

  $("statEarned").textContent =
    money(state.me.totalEarned);

  $("statTasks").textContent =
    state.me.tasksDone || 0;

  $("statReferrals").textContent =
    state.me.referrals || 0;

  $("referralCount").textContent =
    state.me.referrals || 0;
}

async function refreshAll() {
  try {
    await loadMe();
    await loadTasks();
    await loadWithdrawals();
    await loadReferrals();

    if (state.isAdmin) {
      await loadAdminSettings();
    }

    showToast("Updated successfully");
  } catch (error) {
    showToast(error.message);
  }
}

async function loadTasks() {
  const data = await api("/api/tasks");

  state.tasks = data.tasks || [];

  renderTasks();
}

function renderTasks() {
  const container = $("taskList");

  if (!state.tasks.length) {
    container.innerHTML =
      `<div class="empty-state">No tasks available right now.</div>`;
    return;
  }

  container.innerHTML = state.tasks
    .map((task) => {
      const completed = Boolean(task.completed);

      return `
        <div class="task-card">

          <div class="task-icon">
            ${taskIcon(task.taskType)}
          </div>

          <div class="task-content">

            <strong>
              ${escapeHtml(task.title)}
            </strong>

            <p>
              ${escapeHtml(task.description || "Complete this task and earn reward.")}
            </p>

            <span class="task-reward">
              +${money(task.reward)} USDT
            </span>

          </div>

          <button
            class="task-action ${completed ? "done" : ""}"
            data-task-id="${task.id}"
            ${completed ? "disabled" : ""}
          >
            ${completed ? "Done" : "Start"}
          </button>

        </div>
      `;
    })
    .join("");

  container
    .querySelectorAll("[data-task-id]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const id = Number(button.dataset.taskId);
        openTask(id);
      });
    });
}

function openTask(id) {
  const task = state.tasks.find(
    (item) => Number(item.id) === Number(id)
  );

  if (!task) return;

  state.selectedTask = task;
  state.openedTask = false;

  $("taskModalTitle").textContent =
    task.title;

  $("taskModalDescription").textContent =
    task.description ||
    "Complete this task to receive your reward.";

  $("taskModalIcon").textContent =
    taskIcon(task.taskType);

  $("taskCompleteButton").disabled = true;
  $("taskCompleteButton").style.opacity = ".5";

  $("taskOpenButton").textContent =
    task.url ? "Open Task" : "Start Task";

  $("taskModalOverlay").classList.add("show");
}

function closeTaskModal() {
  $("taskModalOverlay").classList.remove("show");
  state.selectedTask = null;
}

async function completeSelectedTask() {
  const task = state.selectedTask;

  if (!task) return;

  try {
    const data = await api(
      `/api/tasks/${task.id}/complete`,
      {
        method: "POST",
        body: JSON.stringify({})
      }
    );

    showToast(
      `+${money(data.reward)} USDT earned!`
    );

    closeTaskModal();

    await loadMe();
    await loadTasks();
  } catch (error) {
    showToast(error.message);
  }
}

function openSelectedTask() {
  const task = state.selectedTask;

  if (!task) return;

  state.openedTask = true;

  if (task.url) {
    if (tg?.openLink) {
      tg.openLink(task.url);
    } else {
      window.open(task.url, "_blank");
    }
  }

  $("taskCompleteButton").disabled = false;
  $("taskCompleteButton").style.opacity = "1";

  showToast(
    "Task opened. Complete it, then claim reward."
  );
}

async function loadWithdrawals() {
  const data = await api("/api/withdrawals");

  state.withdrawals = data.withdrawals || [];

  renderWithdrawals();
}

function renderWithdrawals() {
  const container = $("withdrawalHistory");

  if (!state.withdrawals.length) {
    container.innerHTML =
      `<div class="empty-state">No withdrawals yet.</div>`;
    return;
  }

  container.innerHTML = state.withdrawals
    .map((item) => {
      const date = item.created_at
        ? new Date(item.created_at).toLocaleString()
        : "";

      return `
        <div class="history-item">

          <div>
            <strong>
              ${money(item.amount)} USDT
            </strong>

            <small>
              ${escapeHtml(item.network || "")}
              · ${escapeHtml(date)}
            </small>
          </div>

          <span class="status ${escapeHtml(item.status)}">
            ${escapeHtml(item.status)}
          </span>

        </div>
      `;
    })
    .join("");
}

async function submitWithdrawal() {
  const amount = Number(
    $("withdrawAmount").value
  );

  const network =
    $("withdrawNetwork").value.trim();

  const address =
    $("withdrawAddress").value.trim();

  if (!amount || amount <= 0) {
    showToast("Enter a valid amount");
    return;
  }

  if (!network || !address) {
    showToast("Complete all withdrawal fields");
    return;
  }

  try {
    await api("/api/withdrawals", {
      method: "POST",
      body: JSON.stringify({
        amount,
        network,
        address
      })
    });

    $("withdrawAmount").value = "";
    $("withdrawNetwork").value = "";
    $("withdrawAddress").value = "";

    showToast("Withdrawal request submitted");

    await loadMe();
    await loadWithdrawals();
  } catch (error) {
    showToast(error.message);
  }
}

async function loadReferrals() {
  const data = await api("/api/referrals");

  state.referrals = data.referrals || [];

  renderReferrals();
}

function renderReferrals() {
  const container = $("referralList");

  if (!state.referrals.length) {
    container.innerHTML =
      `<div class="empty-state">No referrals yet.</div>`;
    return;
  }

  container.innerHTML = state.referrals
    .map((item) => {
      const name =
        item.first_name ||
        item.username ||
        "Telegram User";

      return `
        <div class="history-item">

          <div>
            <strong>
              ${escapeHtml(name)}
            </strong>

            <small>
              ${item.username ? "@" + escapeHtml(item.username) : "Telegram user"}
            </small>
          </div>

          <span class="status paid">
            Joined
          </span>

        </div>
      `;
    })
    .join("");
}

function inviteFriends() {
  const botUsername =
    state.config?.telegramChannel ||
    "";

  let link = "";

  if (botUsername) {
    const clean =
      botUsername.replace(/^@/, "");

    link =
      `https://t.me/${clean}`;
  } else {
    link =
      window.location.href;
  }

  const text =
    "Join ST Earn and start earning!";

  const share =
    `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;

  if (tg?.openTelegramLink) {
    tg.openTelegramLink(share);
  } else {
    window.open(share, "_blank");
  }
}

/* ============================
   NAVIGATION
============================ */

function showPage(pageId) {
  const target = $(pageId);

  if (!target) return;

  document
    .querySelectorAll(".page")
    .forEach((page) => {
      page.classList.remove("active");
    });

  target.classList.add("active");

  document
    .querySelectorAll(".nav")
    .forEach((nav) => {
      nav.classList.toggle(
        "active",
        nav.dataset.page === pageId
      );
    });

  state.currentPage = pageId;

  closeAllSheets();

  if (pageId === "tasksPage") {
    loadTasks().catch((e) => showToast(e.message));
  }

  if (pageId === "walletPage") {
    loadWithdrawals().catch((e) =>
      showToast(e.message)
    );
  }

  if (pageId === "referralsPage") {
    loadReferrals().catch((e) =>
      showToast(e.message)
    );
  }

  if (pageId === "adminPage" && state.isAdmin) {
    loadAdminSettings().catch((e) =>
      showToast(e.message)
    );
  }

  if (tg?.BackButton) {
    if (pageId === "homePage") {
      tg.BackButton.hide();
    } else {
      tg.BackButton.show();
    }
  }
}

/* ============================
   BOTTOM SHEET
============================ */

function openMenuSheet() {
  $("sheetOverlay").classList.add("show");
  $("bottomSheet").classList.add("show");
}

function closeMenuSheet() {
  $("sheetOverlay").classList.remove("show");
  $("bottomSheet").classList.remove("show");
}

function openThemeSheet() {
  if (
    state.config &&
    !state.config.allowUserTheme
  ) {
    showToast(
      "Theme changing is disabled by admin"
    );
    return;
  }

  closeMenuSheet();

  $("themeOverlay").classList.add("show");
  $("themeSheet").classList.add("show");
}

function closeThemeSheet() {
  $("themeOverlay").classList.remove("show");
  $("themeSheet").classList.remove("show");
}

function closeAllSheets() {
  closeMenuSheet();
  closeThemeSheet();
}

function buildThemeList(themes, enabled) {
  const container = $("themeList");

  const entries = Object.entries(themes);

  if (!entries.length) {
    container.innerHTML =
      `<div class="empty-state">No themes available.</div>`;
    return;
  }

  container.innerHTML = entries
    .map(([key, theme]) => {
      return `
        <button
          class="theme-option"
          data-theme="${escapeHtml(key)}"
        >

          <div
            class="theme-preview"
            style="
              background:
                linear-gradient(
                  135deg,
                  ${theme.primary},
                  ${theme.secondary}
                );
            "
          ></div>

          <strong>
            ${escapeHtml(theme.name)}
          </strong>

          <small>
            ${enabled ? "Available" : "Admin controlled"}
          </small>

        </button>
      `;
    })
    .join("");

  container
    .querySelectorAll("[data-theme]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        changeUserTheme(
          button.dataset.theme
        );
      });
    });
}

async function changeUserTheme(theme) {
  if (
    !state.config?.allowUserTheme
  ) {
    showToast(
      "Admin has disabled user themes"
    );
    return;
  }

  try {
    await api("/api/theme", {
      method: "POST",
      body: JSON.stringify({ theme })
    });

    closeThemeSheet();

    await loadMe();

    showToast("Theme updated");
  } catch (error) {
    showToast(error.message);
  }
}

/* ============================
   ADMIN SETTINGS
============================ */

async function loadAdminSettings() {
  if (!state.isAdmin) return;

  const data = await api(
    "/api/admin/settings"
  );

  state.adminSettings = data.settings;
  state.adminThemes = data.themes || {};

  const s = data.settings;

  $("a_app_name").value =
    s.app_name ?? "";

  $("a_logo_url").value =
    s.logo_url ?? "";

  $("a_referral_reward").value =
    s.referral_reward ?? 0;

  $("a_minimum_withdraw").value =
    s.minimum_withdraw ?? 0;

  $("a_withdraw_fee").value =
    s.withdraw_fee ?? 0;

  $("a_telegram_channel").value =
    s.telegram_channel ?? "";

  $("a_announcement").value =
    s.announcement ?? "";

  $("a_allow_user_theme").value =
    String(s.allow_user_theme);

  $("a_maintenance").value =
    String(s.maintenance);

  const themeSelect =
    $("a_global_theme");

  themeSelect.innerHTML =
    Object.entries(state.adminThemes)
      .map(([key, theme]) => {
        return `
          <option value="${escapeHtml(key)}">
            ${escapeHtml(theme.name)}
          </option>
        `;
      })
      .join("");

  themeSelect.value =
    s.global_theme || "gold";

  buildThemeList(
    state.adminThemes,
    Boolean(s.allow_user_theme)
  );

  await loadAdminTasks();
}

async function saveAdminSettings() {
  if (!state.isAdmin) return;

  const payload = {
    app_name:
      $("a_app_name").value.trim(),

    logo_url:
      $("a_logo_url").value.trim(),

    global_theme:
      $("a_global_theme").value,

    allow_user_theme:
      $("a_allow_user_theme").value === "true",

    referral_reward:
      Number($("a_referral_reward").value || 0),

    minimum_withdraw:
      Number($("a_minimum_withdraw").value || 0),

    withdraw_fee:
      Number($("a_withdraw_fee").value || 0),

    announcement:
      $("a_announcement").value.trim(),

    maintenance:
      $("a_maintenance").value === "true",

    telegram_channel:
      $("a_telegram_channel").value.trim()
  };

  try {
    await api("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify(payload)
    });

    state.config.allowUserTheme =
      payload.allow_user_theme;

    state.config.announcement =
      payload.announcement;

    state.config.appName =
      payload.app_name;

    state.config.logoUrl =
      payload.logo_url;

    state.config.telegramChannel =
      payload.telegram_channel;

    $("announcementText").textContent =
      payload.announcement;

    document.title =
      payload.app_name || "ST Earn";

    if (payload.logo_url) {
      $("profileAvatar").innerHTML =
        `<img src="${escapeHtml(payload.logo_url)}" alt="Logo">`;
    }

    const theme =
      state.adminThemes[payload.global_theme];

    if (theme) {
      applyTheme(theme);
    }

    buildThemeList(
      state.adminThemes,
      payload.allow_user_theme
    );

    showToast("Settings saved");

    await loadMe();
  } catch (error) {
    showToast(error.message);
  }
}

/* ============================
   ADMIN TASKS
============================ */

async function loadAdminTasks() {
  if (!state.isAdmin) return;

  try {
    const data = await api(
      "/api/admin/tasks"
    );

    renderAdminTasks(data.tasks || []);
  } catch (error) {
    $("adminTaskList").innerHTML =
      `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function renderAdminTasks(tasks) {
  const container =
    $("adminTaskList");

  if (!tasks.length) {
    container.innerHTML =
      `<div class="empty-state">No tasks created.</div>`;
    return;
  }

  container.innerHTML = tasks
    .map((task) => {
      return `
        <div class="admin-item">

          <div class="admin-item-top">

            <div>
              <strong>
                ${escapeHtml(task.title)}
              </strong>

              <small>
                ${escapeHtml(task.task_type)}
                · +${money(task.reward)} USDT
              </small>
            </div>

            <span class="status ${task.active ? "paid" : "rejected"}">
              ${task.active ? "Active" : "Off"}
            </span>

          </div>

          <div class="admin-actions">

            <button
              class="btn-danger"
              data-delete-task="${task.id}"
            >
              Delete
            </button>

          </div>

        </div>
      `;
    })
    .join("");

  container
    .querySelectorAll("[data-delete-task]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        deleteAdminTask(
          button.dataset.deleteTask
        );
      });
    });
}

async function addAdminTask() {
  const title =
    $("a_t_title").value.trim();

  const description =
    $("a_t_desc").value.trim();

  const url =
    $("a_t_url").value.trim();

  const reward =
    Number($("a_t_reward").value || 0);

  const task_type =
    $("a_t_type").value;

  if (!title) {
    showToast("Task title required");
    return;
  }

  try {
    await api("/api/admin/tasks", {
      method: "POST",
      body: JSON.stringify({
        title,
        description,
        url,
        reward,
        task_type
      })
    });

    $("a_t_title").value = "";
    $("a_t_desc").value = "";
    $("a_t_url").value = "";
    $("a_t_reward").value = "";

    showToast("Task added");

    await loadAdminTasks();
    await loadTasks();
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteAdminTask(id) {
  if (!confirm("Delete this task?")) return;

  try {
    await api(
      `/api/admin/tasks/${id}`,
      {
        method: "DELETE"
      }
    );

    showToast("Task deleted");

    await loadAdminTasks();
    await loadTasks();
  } catch (error) {
    showToast(error.message);
  }
}

/* ============================
   ADMIN USERS
============================ */

async function loadAdminUsers() {
  if (!state.isAdmin) return;

  try {
    const data = await api(
      "/api/admin/users"
    );

    renderAdminUsers(data.users || []);
  } catch (error) {
    $("adminUserList").innerHTML =
      `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function renderAdminUsers(users) {
  const container =
    $("adminUserList");

  if (!users.length) {
    container.innerHTML =
      `<div class="empty-state">No users found.</div>`;
    return;
  }

  container.innerHTML = users
    .map((user) => {
      const name =
        user.first_name ||
        user.username ||
        "User";

      return `
        <div class="admin-item">

          <div class="admin-item-top">

            <div>
              <strong>
                ${escapeHtml(name)}
              </strong>

              <small>
                ID: ${escapeHtml(user.telegram_id)}
                <br>
                Balance: ${money(user.balance)} USDT
              </small>
            </div>

            <span class="status ${
              user.blocked
                ? "rejected"
                : "paid"
            }">
              ${user.blocked ? "Blocked" : "Active"}
            </span>

          </div>

          <div class="admin-actions">

            <button
              class="btn-success"
              data-edit-user="${escapeHtml(user.telegram_id)}"
              data-balance="${money(user.balance)}"
            >
              Balance
            </button>

            <button
              class="${
                user.blocked
                  ? "btn-success"
                  : "btn-danger"
              }"
              data-block-user="${escapeHtml(user.telegram_id)}"
              data-blocked="${user.blocked}"
            >
              ${user.blocked ? "Unblock" : "Block"}
            </button>

          </div>

        </div>
      `;
    })
    .join("");

  container
    .querySelectorAll("[data-edit-user]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        editUserBalance(
          button.dataset.editUser,
          button.dataset.balance
        );
      });
    });

  container
    .querySelectorAll("[data-block-user]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        toggleUserBlock(
          button.dataset.blockUser,
          button.dataset.blocked === "true"
        );
      });
    });
}

async function editUserBalance(
  telegramId,
  currentBalance
) {
  const value = prompt(
    "Enter new balance:",
    currentBalance
  );

  if (value === null) return;

  const balance = Number(value);

  if (!Number.isFinite(balance) || balance < 0) {
    showToast("Invalid balance");
    return;
  }

  try {
    await api(
      `/api/admin/users/${encodeURIComponent(telegramId)}`,
      {
        method: "PUT",
        body: JSON.stringify({
          balance
        })
      }
    );

    showToast("Balance updated");

    await loadAdminUsers();
  } catch (error) {
    showToast(error.message);
  }
}

async function toggleUserBlock(
  telegramId,
  currentlyBlocked
) {
  const action =
    currentlyBlocked
      ? "unblock"
      : "block";

  if (!confirm(`Are you sure you want to ${action} this user?`)) {
    return;
  }

  try {
    await api(
      `/api/admin/users/${encodeURIComponent(telegramId)}`,
      {
        method: "PUT",
        body: JSON.stringify({
          blocked: !currentlyBlocked
        })
      }
    );

    showToast(
      currentlyBlocked
        ? "User unblocked"
        : "User blocked"
    );

    await loadAdminUsers();
  } catch (error) {
    showToast(error.message);
  }
}

/* ============================
   ADMIN WITHDRAWALS
============================ */

async function loadAdminWithdrawals() {
  if (!state.isAdmin) return;

  try {
    const data = await api(
      "/api/admin/withdrawals"
    );

    renderAdminWithdrawals(
      data.withdrawals || []
    );
  } catch (error) {
    $("adminWithdrawalList").innerHTML =
      `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function renderAdminWithdrawals(items) {
  const container =
    $("adminWithdrawalList");

  if (!items.length) {
    container.innerHTML =
      `<div class="empty-state">No withdrawals found.</div>`;
    return;
  }

  container.innerHTML = items
    .map((item) => {
      return `
        <div class="admin-item">

          <div class="admin-item-top">

            <div>
              <strong>
                ${money(item.amount)} USDT
              </strong>

              <small>
                ${escapeHtml(item.first_name || item.username || "User")}
                <br>
                ${escapeHtml(item.network || "")}
                <br>
                ${escapeHtml(item.address || "")}
              </small>
            </div>

            <span class="status ${escapeHtml(item.status)}">
              ${escapeHtml(item.status)}
            </span>

          </div>

          ${
            item.status === "pending"
              ? `
                <div class="admin-actions">

                  <button
                    class="btn-success"
                    data-pay-withdrawal="${item.id}"
                  >
                    Paid
                  </button>

                  <button
                    class="btn-danger"
                    data-reject-withdrawal="${item.id}"
                  >
                    Reject
                  </button>

                </div>
              `
              : ""
          }

        </div>
      `;
    })
    .join("");

  container
    .querySelectorAll("[data-pay-withdrawal]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        processWithdrawal(
          button.dataset.payWithdrawal,
          "paid"
        );
      });
    });

  container
    .querySelectorAll("[data-reject-withdrawal]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        processWithdrawal(
          button.dataset.rejectWithdrawal,
          "rejected"
        );
      });
    });
}

async function processWithdrawal(
  id,
  status
) {
  const action =
    status === "paid"
      ? "mark this withdrawal as PAID"
      : "REJECT this withdrawal";

  if (!confirm(`Are you sure you want to ${action}?`)) {
    return;
  }

  try {
    await api(
      `/api/admin/withdrawals/${id}`,
      {
        method: "PUT",
        body: JSON.stringify({
          status
        })
      }
    );

    showToast(
      status === "paid"
        ? "Withdrawal marked paid"
        : "Withdrawal rejected"
    );

    await loadAdminWithdrawals();
  } catch (error) {
    showToast(error.message);
  }
}

/* ============================
   ADMIN TABS
============================ */

function setupAdminTabs() {
  document
    .querySelectorAll("[data-admin-tab]")
    .forEach((button) => {
      button.addEventListener("click", async () => {

        document
          .querySelectorAll(".admin-tab")
          .forEach((tab) => {
            tab.classList.remove("active");
          });

        button.classList.add("active");

        document
          .querySelectorAll(".admin-panel")
          .forEach((panel) => {
            panel.style.display = "none";
          });

        const target =
          $(button.dataset.adminTab);

        if (target) {
          target.style.display = "block";
        }

        const tab =
          button.dataset.adminTab;

        if (tab === "adminSettings") {
          await loadAdminSettings();
        }

        if (tab === "adminTasks") {
          await loadAdminTasks();
        }

        if (tab === "adminUsers") {
          await loadAdminUsers();
        }

        if (tab === "adminWithdrawals") {
          await loadAdminWithdrawals();
        }
      });
    });
}

/* ============================
   EVENTS
============================ */

function setupEvents() {

  document
    .querySelectorAll("[data-page]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const page =
          button.dataset.page;

        if (
          page === "adminPage" &&
          !state.isAdmin
        ) {
          showToast("Admin access required");
          return;
        }

        showPage(page);
      });
    });


  $("menuButton")
    .addEventListener(
      "click",
      openMenuSheet
    );


  $("sheetOverlay")
    .addEventListener(
      "click",
      closeMenuSheet
    );


  $("closeSheet")
    .addEventListener(
      "click",
      closeMenuSheet
    );


  $("sheetCloseBottom")
    .addEventListener(
      "click",
      closeMenuSheet
    );


  $("themeSheetBtn")
    .addEventListener(
      "click",
      openThemeSheet
    );


  $("themeOverlay")
    .addEventListener(
      "click",
      closeThemeSheet
    );


  $("closeThemeSheet")
    .addEventListener(
      "click",
      closeThemeSheet
    );


  $("sheetRefresh")
    .addEventListener(
      "click",
      async () => {
        closeMenuSheet();

        try {
          await refreshAll();
        } catch {}
      }
    );


  $("refreshButton")
    .addEventListener(
      "click",
      async () => {
        try {
          await refreshAll();
        } catch {}
      }
    );


  $("sheetHistory")
    .addEventListener(
      "click",
      () => {
        closeMenuSheet();
        showPage("walletPage");
      }
    );


  $("sheetInvite")
    .addEventListener(
      "click",
      () => {
        closeMenuSheet();
        inviteFriends();
      }
    );


  $("inviteButton")
    .addEventListener(
      "click",
      inviteFriends
    );


  $("adminSheetBtn")
    .addEventListener(
      "click",
      () => {
        closeMenuSheet();

        if (state.isAdmin) {
          showPage("adminPage");
        }
      }
    );


  $("withdrawButton")
    .addEventListener(
      "click",
      submitWithdrawal
    );


  $("taskOpenButton")
    .addEventListener(
      "click",
      openSelectedTask
    );


  $("taskCompleteButton")
    .addEventListener(
      "click",
      completeSelectedTask
    );


  $("closeTaskModal")
    .addEventListener(
      "click",
      closeTaskModal
    );


  $("taskModalOverlay")
    .addEventListener(
      "click",
      closeTaskModal
    );


  $("saveAdminSettings")
    .addEventListener(
      "click",
      saveAdminSettings
    );


  $("addAdminTask")
    .addEventListener(
      "click",
      addAdminTask
    );


  $("refreshAdminUsers")
    .addEventListener(
      "click",
      loadAdminUsers
    );


  $("refreshAdminWithdrawals")
    .addEventListener(
      "click",
      loadAdminWithdrawals
    );


  setupAdminTabs();
}

/* ============================
   START
============================ */

async function startApp() {
  try {

    if (!tg?.initData) {
      throw new Error(
        "Please open ST Earn from Telegram."
      );
    }

    await loadConfig();

    await loadMe();

    telegramSetup();

    setupEvents();

    await loadTasks();

    await loadWithdrawals();

    await loadReferrals();

    if (state.isAdmin) {
      await loadAdminSettings();
    }

    $("loadingScreen").style.display =
      "none";

    $("app").style.display =
      "block";

    showPage("homePage");

  } catch (error) {

    console.error(error);

    $("loadingScreen").innerHTML = `
      <div class="loading-logo">!</div>

      <div class="loading-title">
        ST Earn
      </div>

      <p style="max-width:280px;text-align:center;">
        ${escapeHtml(error.message)}
      </p>
    `;
  }
}

document.addEventListener(
  "DOMContentLoaded",
  startApp
);
