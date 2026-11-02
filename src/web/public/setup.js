async function submitSetup(form, endpoint) {
  const button = form.querySelector("button[type=submit]");
  if (button) button.disabled = true;
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "accept": "application/json",  },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error("Setup action failed");
    window.location.assign(endpoint.endsWith("/authorize") ? "/" : "/setup");
  } catch {
    const status = document.querySelector("[data-setup-status]");
    if (status) status.textContent = "That step could not be completed. Please try again.";
    if (button) button.disabled = false;
  }
}
document.querySelectorAll("form[data-setup-guild]").forEach((form) => form.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitSetup(form, "/installation/guild");
}));
document.querySelector("form[data-setup-authorize]")?.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitSetup(event.currentTarget, "/installation/authorize");
});

document.querySelector("form[data-setup-signout]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  if (button) button.disabled = true;
  try {
    const response = await fetch("/auth/logout", {
      method: "POST",
      headers: { "accept": "application/json" },
    });
    if (!response.ok) throw new Error("Sign out failed");
    window.location.assign("/setup");
  } catch {
    const status = document.querySelector("[data-setup-status]");
    if (status) status.textContent = "Sign out could not be completed. Please try again.";
    if (button) button.disabled = false;
  }
});


document.querySelector("form[data-rebind-authorize]")?.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitSetup(event.currentTarget, "/installation/rebind/authorize");
});

document.querySelector("form[data-roster-recovery-authorize]")?.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitSetup(event.currentTarget, "/installation/roster-recovery/authorize");
});
