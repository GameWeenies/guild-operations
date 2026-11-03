const rankWorkspaces = [...document.querySelectorAll("[data-rank-workspace]")];
const savedNames = new WeakMap();
const savedRoles = new WeakMap();
const savedCapabilities = new WeakMap();
const saving = new WeakSet();
const roleFields = document.querySelector("[data-discord-role-fields]");
const roleForm = document.querySelector("#discord-role-mappings-form");

if (roleFields) {
  let moved = 0;
  for (const field of [...roleFields.querySelectorAll("[data-discord-rank-field]")]) {
    const slot = document.querySelector('[data-discord-role-slot="' + field.dataset.discordRankField + '"]');
    if (!slot) continue;
    slot.append(field);
    moved++;
  }
  if (moved && !roleFields.children.length) {
    const section = roleFields.closest(".admin-section");
    if (section) section.classList.add("discord-role-mappings-relocated");
  }
}

function rankChanges(workspace) {
  const name = workspace.querySelector('[data-rank-name-form] input[name="displayName"]');
  const role = workspace.querySelector('[data-discord-rank-field] select');
  const capabilities = [...workspace.querySelectorAll("[data-rank-capability]")].filter(input =>
    !input.disabled && input.checked !== savedCapabilities.get(input));
  return { name, role, capabilities,
    nameChanged: Boolean(name && name.value !== savedNames.get(name)),
    roleChanged: Boolean(role && role.value !== savedRoles.get(role)) };
}
function refreshSave(workspace) {
  const button = workspace.querySelector("[data-rank-save]");
  if (!button) return;
  const changes = rankChanges(workspace);
  button.disabled = saving.has(workspace) || !(changes.nameChanged || changes.roleChanged || changes.capabilities.length);
}
const requestedRank = location.hash.match(/^#rank-(\d+)$/)?.[1];
if (requestedRank) document.getElementById(`rank-${requestedRank}`)?.setAttribute("open", "");

for (const workspace of rankWorkspaces) {
  const name = workspace.querySelector('[data-rank-name-form] input[name="displayName"]');
  const role = workspace.querySelector('[data-discord-rank-field] select');
  if (name) { savedNames.set(name, name.value); name.addEventListener("input", () => refreshSave(workspace)); }
  if (role) { savedRoles.set(role, role.value); role.addEventListener("change", () => refreshSave(workspace)); }
  for (const input of workspace.querySelectorAll("[data-rank-capability]")) {
    savedCapabilities.set(input, input.checked);
    input.addEventListener("change", () => refreshSave(workspace));
  }
  const button = workspace.querySelector("[data-rank-save]");
  const status = workspace.querySelector("[data-rank-save-status]");
  button?.addEventListener("click", async () => {
    if (saving.has(workspace)) return;
    const changes = rankChanges(workspace);
    if (!(changes.nameChanged || changes.roleChanged || changes.capabilities.length)) return;
    if (changes.nameChanged && !changes.name.value.trim()) { changes.name.reportValidity(); return; }
    saving.add(workspace);
    refreshSave(workspace);
    const failures = [];
    const completed = [];
    status.textContent = "Saving…";
    const rankIndex = workspace.id.slice("rank-".length);
    try {
      if (changes.nameChanged) {
        try {
          const response = await fetch(`/admin/ranks/${encodeURIComponent(rankIndex)}/display-name`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ displayName: changes.name.value })
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(body.error ?? "Name save failed");
          savedNames.set(changes.name, body.rank.displayName);
          changes.name.value = body.rank.displayName;
          workspace.querySelector("[data-rank-heading]").textContent = body.rank.displayName;
          completed.push("name");
        } catch (error) { failures.push(`Display name: ${error.message}`); }
      }
      for (const input of changes.capabilities) {
        const key = input.dataset.rankCapability;
        const peers = [...document.querySelectorAll("[data-rank-capability]")].filter(peer => peer.dataset.rankCapability === key);
        const previous = input.dataset.permittedRanks.split(",").filter(Boolean).map(Number);
        const next = input.checked ? [...new Set([...previous, Number(rankIndex)])].sort((a,b) => a-b) : previous.filter(rank => rank !== Number(rankIndex));
        try {
          const response = await fetch(`/admin/permissions/${encodeURIComponent(key)}`, {
            method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ permittedRanks: next })
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(body.error ?? "Capability save failed");
          for (const peer of peers) peer.dataset.permittedRanks = body.permittedRanks.join(",");
          savedCapabilities.set(input, input.checked);
          completed.push(key);
        } catch (error) { failures.push(`${key}: ${error.message}`); }
      }
      if (changes.roleChanged && roleForm) {
        try {
          const formData = new FormData(roleForm);
          const response = await fetch(roleForm.action, { method: "POST", body: new URLSearchParams(formData), redirect: "manual" });
          // The existing endpoint redirects after saving. A redirect response indicates acceptance.
          if (!response.ok && response.type !== "opaqueredirect" && response.status !== 302 && response.status !== 303) throw new Error("Discord role mapping save failed");
          for (const select of document.querySelectorAll('[data-discord-rank-field] select')) savedRoles.set(select, select.value);
          completed.push("Discord role");
        } catch (error) { failures.push(`Discord role: ${error.message}`); }
      }
      status.textContent = failures.length ? `Some changes were not saved. ${failures.join("; ")}` : completed.length ? "Changes saved." : "No changes saved.";
    } finally {
      saving.delete(workspace);
      refreshSave(workspace);
    }
  });
  refreshSave(workspace);
}
