let csrfToken = null;

async function getCsrfToken({ force = false } = {}) {
  if (csrfToken && !force) return csrfToken;

  const response = await fetch("/auth/csrf", {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Gagal memperoleh token keamanan");
  }

  const payload = await response.json();
  csrfToken = payload.csrfToken;
  return csrfToken;
}

async function logout() {
  const token = await getCsrfToken({ force: true });
  const response = await fetch("/auth/logout", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "X-CSRF-Token": token,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Logout gagal");
  window.location.assign(payload.redirect || "/login");
}

function bindLogoutForms() {
  document.querySelectorAll("form.logout-form").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector("button[type='submit']");
      if (button) button.disabled = true;
      try {
        await logout();
      } catch (err) {
        console.error(err);
        if (button) button.disabled = false;
        alert("Logout gagal. Silakan coba lagi.");
      }
    });
  });
}

document.addEventListener("DOMContentLoaded", bindLogoutForms);

export { getCsrfToken, logout };
