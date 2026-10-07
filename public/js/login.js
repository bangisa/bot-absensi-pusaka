const form = document.querySelector("#login-form");
const username = document.querySelector("#username");
const password = document.querySelector("#password");
const nextInput = document.querySelector("#next");
const button = document.querySelector("#login-button");
const message = document.querySelector("#login-message");

const params = new URLSearchParams(window.location.search);
const next = params.get("next");
nextInput.value = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  button.disabled = true;
  message.textContent = "Memverifikasi...";
  message.classList.remove("error");

  try {
    const response = await fetch("/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: username.value,
        password: password.value,
        next: nextInput.value,
      }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || "Login gagal");
    }

    password.value = "";
    window.location.assign(payload.redirect || "/");
  } catch (err) {
    message.textContent = err.message;
    message.classList.add("error");
    password.select();
  } finally {
    button.disabled = false;
  }
});
