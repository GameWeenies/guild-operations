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

(() => {
  const root = document.querySelector("[data-roster-reconciliation]");
  if (!root) return;
  const boxes = () => Array.from(root.querySelectorAll('input[name="reconcile-member"]'));
  const confirmation = root.querySelector("[data-reconciliation-confirm]");
  const submit = root.querySelector("[data-reconciliation-commit]");
  const status = root.querySelector("[data-reconciliation-status]");
  const count = root.querySelector("[data-reconciliation-selected]");
  const update = () => {
    count.textContent = String(boxes().filter((box) => box.checked).length);
    submit.disabled = !confirmation.checked;
  };
  root.addEventListener("change", update);
  root.querySelector("[data-reconciliation-all]").addEventListener("click", () => {
    boxes().forEach((box) => { box.checked = true; });
    update();
  });
  root.querySelector("[data-reconciliation-none]").addEventListener("click", () => {
    boxes().forEach((box) => { box.checked = false; });
    update();
  });
  submit.addEventListener("click", async () => {
    if (submit.disabled) return;
    const selected = boxes().filter((box) => box.checked).map((box) => box.value);
    if (!window.confirm(`Activate Manual authority and apply ${selected.length} selected differences? Unselected declarations will be preserved.`)) return;
    submit.disabled = true;
    status.textContent = "Applying reconciliation…";
    try {
      const response = await fetch("/guild/roster/mode/manual", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshot_version: root.dataset.snapshotVersion,
          selected_character_record_ids: selected,
        }),
      });
      if (response.ok) {
        status.textContent = "Manual roster activated.";
        window.location.reload();
        return;
      }
      const result = await response.json();
      status.textContent = result.error === "roster_snapshot_changed"
        ? "The roster snapshot changed. Reload and review the differences again."
        : result.error === "blizzard_sync_not_active"
          ? "Roster mode changed. Reload the page."
          : "Reconciliation failed. Review the current roster and retry.";
    } catch {
      status.textContent = "Unable to contact the server. Check your connection before retrying.";
    } finally {
      update();
    }
  });
  update();
})();

(() => {
  const root = document.querySelector("[data-roster-members]");
  if (!root) return;
  const send = async (characterRecordId, action, rankIndex) => {
    const response = await fetch("/guild/roster/members", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        character_record_id: characterRecordId, action,
        ...(action === "remove" ? {} : { rank_index: Number(rankIndex) }),
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Roster operation failed");
  };
  for (const row of root.querySelectorAll("[data-member-id]")) {
    const select = row.querySelector("[data-member-rank]");
    const save = row.querySelector("[data-member-save]");
    const remove = row.querySelector("[data-member-remove]");
    const status = row.querySelector("[data-member-status]");
    const original = select.value;
    select.addEventListener("change", () => { save.disabled = select.value === original; });
    const perform = async (action) => {
      if (action === "remove" && !window.confirm("Remove this character from the Guild Operations roster?")) return;
      save.disabled = true;
      remove.disabled = true;
      select.disabled = true;
      status.textContent = action === "remove" ? "Removing…" : "Saving…";
      try {
        await send(row.dataset.memberId, action, select.value);
        window.location.reload();
      } catch (error) {
        status.textContent = error.message;
        remove.disabled = false;
        select.disabled = false;
        save.disabled = select.value === original;
      }
    };
    save.addEventListener("click", () => perform("rank"));
    remove.addEventListener("click", () => perform("remove"));
  }
  const add = root.querySelector("[data-member-add]");
  if (add) {
    const character = root.querySelector("[data-member-add-character]");
    const rank = root.querySelector("[data-member-add-rank]");
    const status = root.querySelector("[data-member-add-status]");
    add.addEventListener("click", async () => {
      if (!character.value) return;
      add.disabled = true;
      status.textContent = "Adding…";
      try {
        await send(character.value, "add", rank.value);
        window.location.reload();
      } catch (error) {
        status.textContent = error.message;
        add.disabled = false;
      }
    });
  }
})();

(() => {
  const root = document.querySelector("[data-roster-applications]");
  if (!root) return;
  for (const row of root.querySelectorAll("[data-application-id]")) {
    const approve = row.querySelector("[data-application-approve]");
    const reject = row.querySelector("[data-application-reject]");
    const rank = row.querySelector("[data-application-rank]");
    const status = row.querySelector("[data-application-status]");
    const perform = async (action) => {
      if (action === "reject" && !window.confirm("Reject this guild roster application?")) return;
      approve.disabled = true;
      reject.disabled = true;
      rank.disabled = true;
      status.textContent = action === "approve" ? "Approving…" : "Rejecting…";
      try {
        const response = await fetch(`/guild/roster/applications/${encodeURIComponent(row.dataset.applicationId)}/${action}`, {
          method: "POST", credentials: "same-origin",
          ...(action === "approve" ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rank_index: Number(rank.value) }),
          } : {}),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Application review failed");
        window.location.reload();
      } catch (error) {
        status.textContent = error.message;
        approve.disabled = !rank.options.length;
        reject.disabled = false;
        rank.disabled = false;
      }
    };
    approve.addEventListener("click", () => perform("approve"));
    reject.addEventListener("click", () => perform("reject"));
  }
})();
