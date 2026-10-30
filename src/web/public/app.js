document.documentElement.dataset.webRenderer = "ready";

function formatViewerLocalTimes() {
  document.querySelectorAll("time[data-local-time-unix]").forEach((element) => {
    if (!(element instanceof HTMLTimeElement)) return;

    const unixSeconds = Number(element.dataset.localTimeUnix);
    if (!Number.isFinite(unixSeconds)) return;

    const date = new Date(unixSeconds * 1000);
    if (Number.isNaN(date.getTime())) return;

    const dateStyle = element.dataset.localTimeDateStyle === "medium" ? "medium" : "full";
    element.dateTime = date.toISOString();
    element.textContent = new Intl.DateTimeFormat(undefined, {
      dateStyle,
      timeStyle: "short",
    }).format(date);
  });
}

function closeOpenMenus() {
  document.querySelectorAll("details.menu-surface[open]").forEach((details) => {
    details.removeAttribute("open");
  });
}

function currentReturnTo(reopenMainPicker = false) {
  const url = new URL(window.location.href);
  if (reopenMainPicker) url.searchParams.set("main_picker", "open");
  return `${url.pathname}${url.search}${url.hash}`;
}

function cleanCeremonyParams() {
  const url = new URL(window.location.href);
  url.searchParams.delete("refresh");
  url.searchParams.delete("main_picker");
  if (url.searchParams.get("select_main") !== "required") url.searchParams.delete("select_main");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function setRefreshButtonsInProgress() {
  document.querySelectorAll("[data-refresh-characters]").forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) return;
    button.disabled = true;
    const label = button.querySelector("[data-refresh-label]");
    if (label instanceof HTMLElement) label.textContent = "Refresh in progress…";
    else button.textContent = "Refresh in progress…";
  });
}

function startCharacterRefresh() {
  setRefreshButtonsInProgress();
  closeOpenMenus();
  window.location.assign(`/me/refresh?return_to=${encodeURIComponent(currentReturnTo(true))}`);
}

function requiredMainPicker() {
  const picker = document.querySelector("[data-main-picker]");
  if (!(picker instanceof HTMLDialogElement)) return null;
  const params = new URLSearchParams(window.location.search);
  return params.get("select_main") === "required"
    && picker.dataset.hasMain !== "true"
    && picker.querySelector("[data-select-main]") !== null ? picker : null;
}

function openRequestedMainPicker() {
  const picker = document.querySelector("[data-main-picker]");
  if (!(picker instanceof HTMLDialogElement)) return;
  const params = new URLSearchParams(window.location.search);
  if (params.get("main_picker") === "open" && !picker.open) picker.showModal();
}

function openRequiredMainPicker() {
  const picker = requiredMainPicker();
  if (!picker) return;
  const closeButton = picker.querySelector("[data-close-main-picker]");
  if (closeButton instanceof HTMLButtonElement) closeButton.hidden = true;
  if (!picker.open) picker.showModal();
}

async function saveMain(button) {
  const picker = document.querySelector("[data-main-picker]");
  const status = document.querySelector("[data-main-picker-status]");
  const choices = document.querySelector("[data-character-choices]");
  if (!(picker instanceof HTMLDialogElement) || !(status instanceof HTMLElement) || !(choices instanceof HTMLElement)) return;

  const buttons = choices.querySelectorAll("[data-select-main]");
  buttons.forEach((candidate) => { candidate.disabled = true; });
  status.textContent = "Saving…";

  try {
    const response = await fetch("/me/main-character", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        realm_id: button.dataset.realmId,
        character_id: button.dataset.characterId,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      status.textContent = result.error || "Unable to select main character.";
      return;
    }

    buttons.forEach((candidate) => {
      candidate.classList.remove("character-choice-current");
      const current = candidate.querySelector(".current-main-label");
      if (current) current.remove();
    });
    button.classList.add("character-choice-current");
    const name = button.querySelector(".character-choice-name");
    if (name instanceof HTMLElement) {
      const current = document.createElement("span");
      current.className = "current-main-label";
      current.textContent = "Current default";
      name.appendChild(current);
    }

    picker.dataset.hasMain = "true";
    status.textContent = "";

    const url = new URL(window.location.href);
    url.searchParams.delete("select_main");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    const closeButton = picker.querySelector("[data-close-main-picker]");
    if (closeButton instanceof HTMLButtonElement) closeButton.hidden = false;
    picker.close();
    window.location.reload();
  } catch {
    status.textContent = "Unable to select main character.";
  } finally {
    buttons.forEach((candidate) => { candidate.disabled = false; });
  }
}

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const refresh = target.closest("[data-refresh-characters]");
  if (refresh) {
    startCharacterRefresh();
    return;
  }

  const logout = target.closest("[data-logout]");
  if (logout) {
    void fetch("/auth/logout", { method: "POST" }).then((response) => {
      if (response.ok) window.location.assign("/");
    });
    return;
  }

  const editDisplayName = target.closest("[data-edit-display-name]");
  if (editDisplayName) {
    const display = document.querySelector("[data-identity-name-display]");
    const form = document.querySelector("[data-display-name-form]");
    if (display instanceof HTMLElement && form instanceof HTMLFormElement) {
      display.hidden = true;
      form.hidden = false;
      const input = form.querySelector('input[name="display_name"]');
      if (input instanceof HTMLInputElement) {
        input.focus();
        input.select();
      }
    }
    return;
  }

  const cancelDisplayName = target.closest("[data-cancel-display-name]");
  if (cancelDisplayName) {
    const display = document.querySelector("[data-identity-name-display]");
    const form = document.querySelector("[data-display-name-form]");
    if (display instanceof HTMLElement && form instanceof HTMLFormElement) {
      form.hidden = true;
      display.hidden = false;
      form.reset();
    }
    return;
  }

  const openProfileIconPicker = target.closest("[data-open-profile-icon-picker]");
  if (openProfileIconPicker) {
    closeOpenMenus();
    const picker = document.querySelector("[data-profile-icon-picker]");
    if (picker instanceof HTMLDialogElement) picker.showModal();
    return;
  }

  const closeProfileIconPicker = target.closest("[data-close-profile-icon-picker]");
  if (closeProfileIconPicker) {
    const picker = document.querySelector("[data-profile-icon-picker]");
    if (picker instanceof HTMLDialogElement) picker.close();
    return;
  }

  const openPicker = target.closest("[data-open-main-picker]");
  if (openPicker) {
    closeOpenMenus();
    const picker = document.querySelector("[data-main-picker]");
    if (picker instanceof HTMLDialogElement) picker.showModal();
    return;
  }

  const closePicker = target.closest("[data-close-main-picker]");
  if (closePicker) {
    const picker = document.querySelector("[data-main-picker]");
    if (picker instanceof HTMLDialogElement && !requiredMainPicker()) picker.close();
    return;
  }

  const selectMain = target.closest("[data-select-main]");
  if (selectMain instanceof HTMLButtonElement) void saveMain(selectMain);
});

document.addEventListener("click", (event) => {
  const picker = event.target;
  if (!(picker instanceof HTMLDialogElement) || !picker.matches("[data-profile-icon-picker]")) return;
  const rect = picker.getBoundingClientRect();
  const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  if (!inside) picker.close();
});

document.addEventListener("click", (event) => {
  const picker = event.target;
  if (!(picker instanceof HTMLDialogElement) || !picker.matches("[data-main-picker]")) return;
  if (requiredMainPicker()) return;
  const rect = picker.getBoundingClientRect();
  const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  if (!inside) picker.close();
});

document.addEventListener("cancel", (event) => {
  const picker = event.target;
  if (!(picker instanceof HTMLDialogElement) || !picker.matches("[data-main-picker]")) return;
  if (requiredMainPicker()) event.preventDefault();
});

document.addEventListener("toggle", (event) => {
  const opened = event.target;
  if (!(opened instanceof HTMLDetailsElement) || !opened.open) return;

  document.querySelectorAll("details.menu-surface[open]").forEach((details) => {
    if (details !== opened) details.removeAttribute("open");
  });
}, true);

const ceremonyParams = new URLSearchParams(window.location.search);
if (ceremonyParams.get("refresh") === "failed") {
  window.alert("Character refresh failed. Your existing character data has been left unchanged.");
}
formatViewerLocalTimes();
openRequestedMainPicker();
cleanCeremonyParams();
openRequiredMainPicker();
