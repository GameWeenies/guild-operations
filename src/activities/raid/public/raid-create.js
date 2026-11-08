for (const element of document.querySelectorAll("[data-unix-time]")) {
  const unix = Number(element.getAttribute("data-unix-time"));
  if (!Number.isFinite(unix)) continue;
  const date = new Date(unix * 1000);
  element.textContent = date.toLocaleString();
  if (element instanceof HTMLTimeElement) element.dateTime = date.toISOString();
}

const setup = document.querySelector("[data-raid-setup]");
const setupToggle = document.querySelector("[data-toggle-raid-setup]");
if (setup instanceof HTMLElement && setupToggle instanceof HTMLButtonElement) {
  setupToggle.addEventListener("click", () => {
    setup.hidden = !setup.hidden;
    setupToggle.textContent = setup.hidden ? "New raid" : "Close";
    if (!setup.hidden) setup.querySelector("input")?.focus();
  });
}

const createForm = document.querySelector("[data-raid-create-form]");
const createStatus = document.querySelector("[data-raid-create-status]");
if (createForm instanceof HTMLFormElement) {
  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(createStatus instanceof HTMLElement)) return;

    const data = new FormData(createForm);
    const startsAt = String(data.get("startsAt") ?? "");
    const startDate = new Date(startsAt);
    if (!startsAt || !Number.isFinite(startDate.getTime())) {
      createStatus.textContent = "Choose a valid raid start time.";
      return;
    }

    const requirements = [];
    const minimumItemLevel = String(data.get("minimumItemLevel") ?? "").trim();
    const enchantsAndGems = String(data.get("enchantsAndGems") ?? "").trim();
    if (minimumItemLevel) requirements.push({ label: "Minimum item level", value: minimumItemLevel });
    if (enchantsAndGems) requirements.push({ label: "Enchants & gems", value: enchantsAndGems });

    createStatus.textContent = "Creating raid…";
    try {
      const response = await fetch("/activities/raid/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: String(data.get("label") ?? ""),
          description: String(data.get("description") ?? ""),
          occursAt: [Math.floor(startDate.getTime() / 1000)],
          difficulty: String(data.get("difficulty") ?? ""),
          requirements,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Raid could not be created");
      window.location.href = `/activities/raid/${encodeURIComponent(payload.raid.raidId)}/manage`;
    } catch (error) {
      createStatus.textContent = error instanceof Error ? error.message : "Raid could not be created.";
    }
  });
}
