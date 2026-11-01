(() => {
  const root = document.querySelector("[data-roster-review]");
  if (!root) return;
  const boxes = () => Array.from(root.querySelectorAll('input[name="member"]'));
  const confirmation = root.querySelector("[data-roster-confirm]");
  const submit = root.querySelector("[data-roster-commit]");
  const status = root.querySelector("[data-roster-status]");
  const selectedCount = root.querySelector("[data-roster-selected]");
  const update = () => {
    selectedCount.textContent = String(boxes().filter((box) => box.checked).length);
    submit.disabled = !confirmation.checked;
  };
  root.addEventListener("change", update);
  root.querySelector("[data-roster-select-all]").addEventListener("click", () => {
    boxes().forEach((box) => { box.checked = true; });
    update();
  });
  root.querySelector("[data-roster-clear]").addEventListener("click", () => {
    boxes().forEach((box) => { box.checked = false; });
    update();
  });
  submit.addEventListener("click", async () => {
    if (!confirmation.checked || submit.disabled) return;
    const selected = boxes().filter((box) => box.checked).map((box) => box.value);
    if (!window.confirm(`Initialize the Manual roster with ${selected.length} selected characters? This action cannot be repeated.`)) return;
    submit.disabled = true;
    status.textContent = "Initializing roster…";
    try {
      const response = await fetch("/guild/roster/initialization", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshot_version: root.dataset.snapshotVersion,
          selected_character_record_ids: selected,
        }),
      });
      if (response.ok) {
        status.textContent = "Manual roster initialized.";
        window.location.reload();
        return;
      }
      const result = await response.json();
      if (response.status === 409 && result.error === "roster_snapshot_changed") {
        status.textContent = "The Blizzard roster changed. Reload this page and review the latest snapshot before retrying.";
      } else {
        status.textContent = result.error === "roster_already_initialized"
          ? "The Manual roster has already been initialized. Reload the page."
          : "Initialization failed. Please retry or reload the page.";
      }
    } catch {
      status.textContent = "Unable to contact the server. Check your connection before retrying.";
    } finally {
      update();
    }
  });
  update();
})();
