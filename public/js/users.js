import { getUsers, createUser, deleteUser, updateUser } from "./api.js";

const PAGE_SIZE = 10;

const usersList = document.getElementById("users-list");
const usersSummary = document.getElementById("users-summary");
const userModal = document.getElementById("user-modal");
const openUserModalButton = document.getElementById("open-user-modal");
const closeUserModalButton = document.getElementById("close-user-modal");
const form = document.getElementById("user-form");
const formMessage = document.getElementById("form-message");
const submitButton = form.querySelector("button[type='submit']");
const prevButton = document.getElementById("users-prev");
const nextButton = document.getElementById("users-next");
const pageInfo = document.getElementById("users-page-info");

let usersData = [];
let currentPage = 1;
let editingId = null;

function setMessage(message, type = "info") {
  formMessage.textContent = message;
  formMessage.style.borderColor = type === "error" ? "var(--red)" : "var(--green)";
  formMessage.style.color = type === "error" ? "#f87171" : "#34d399";
}

function clearMessage() {
  formMessage.textContent = "";
}

function resetForm() {
  form.reset();
}

function openUserModal(user = null) {
  editingId = user?.id ?? null;
  resetForm();
  document.getElementById("user-modal-title").textContent = editingId ? "Edit User" : "Tambah User";
  for (const key of ["username", "password"]) {
    document.getElementById(key).required = !editingId;
    document.getElementById(`${key}-required`).hidden = Boolean(editingId);
    document.getElementById(`${key}-hint`).textContent = editingId ? "Kosongkan untuk mempertahankan" : "Akun Pusaka";
  }
  document.getElementById("username").placeholder = user?.usernameMasked ?? "";
  if (user) {
    document.getElementById("nickname").value = user.nickname ?? "";
    document.getElementById("lat").value = user.latitude;
    document.getElementById("lng").value = user.longitude;
    document.getElementById("service-plan").value = user.service_days_total === null ? "unlimited" : String(user.service_days_total);
  }
  setLoading(false);
  clearMessage();
  userModal.showModal();
  document.getElementById("nickname").focus();
}

function closeUserModal() {
  if (!userModal.open) return;

  userModal.close();
}

function setLoading(loading) {
  submitButton.disabled = loading;
  submitButton.textContent = loading ? "Menyimpan..." : editingId ? "Simpan" : "Tambah";
}

function appendCell(row, value, className = "") {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  cell.textContent = value ?? "-";
  row.appendChild(cell);
  return cell;
}

function createEmptyRow(message, className = "row-empty") {
  const row = document.createElement("tr");
  row.className = className;

  const cell = document.createElement("td");
  cell.colSpan = 7;
  cell.textContent = message;
  row.appendChild(cell);

  return row;
}

function createUserRow(user) {
  const row = document.createElement("tr");

  appendCell(row, user.id);

  const nicknameCell = document.createElement("td");
  nicknameCell.className = "user-cell";

  const nickname = document.createElement("strong");
  nickname.textContent = user.nickname || "-";

  const autoLogin = document.createElement("small");
  autoLogin.textContent = Number(user.auto_login ?? 1) === 1 ? "Auto login aktif" : "Auto login nonaktif";

  nicknameCell.append(nickname, autoLogin);
  row.appendChild(nicknameCell);
  appendCell(row, user.service_days_total === null ? "Tak Terbatas" : `${user.service_days_total} Hari`);
  appendCell(row, user.service_days_used);
  appendCell(row, user.service_days_remaining === null ? "Tak Terbatas" : user.service_days_remaining);
  appendCell(row, user.service_status === "completed" ? "Habis" : "Aktif");

  const actionCell = document.createElement("td");
  const editButton = document.createElement("button");
  editButton.className = "btn secondary";
  editButton.type = "button";
  editButton.textContent = "Edit";
  editButton.addEventListener("click", () => openUserModal(user));
  const deleteButton = document.createElement("button");
  deleteButton.className = "btn danger";
  deleteButton.type = "button";
  deleteButton.textContent = "Hapus";

  deleteButton.addEventListener("click", async () => {
    if (!confirm(`Hapus user ${user.usernameMasked || user.nickname || user.id}?`)) return;

    try {
      deleteButton.disabled = true;
      deleteButton.textContent = "Menghapus...";
      await deleteUser(user.id);
      await loadUsers();
      setMessage(`User ${user.usernameMasked || user.nickname || user.id} dihapus.`);
    } catch (err) {
      console.error(err);
      setMessage(err.message || "Gagal menghapus user", "error");
      deleteButton.disabled = false;
      deleteButton.textContent = "Hapus";
    }
  });

  const actions = document.createElement("div");
  actions.className = "setting-actions";
  actions.append(editButton, deleteButton);
  actionCell.append(actions);
  row.appendChild(actionCell);

  return row;
}

function getTotalPages() {
  return Math.max(1, Math.ceil(usersData.length / PAGE_SIZE));
}

function renderUsers() {
  const totalPages = getTotalPages();
  currentPage = Math.min(Math.max(currentPage, 1), totalPages);

  usersList.replaceChildren();
  usersSummary.textContent = `${usersData.length} user`;

  if (!usersData.length) {
    usersList.appendChild(createEmptyRow("Belum ada user."));
  } else {
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageItems = usersData.slice(start, start + PAGE_SIZE);

    pageItems.forEach((user) => {
      usersList.appendChild(createUserRow(user));
    });
  }

  pageInfo.textContent = `Hal ${currentPage}/${totalPages}`;
  prevButton.disabled = currentPage <= 1;
  nextButton.disabled = currentPage >= totalPages;
}

function getFormData() {
  return {
    username: document.getElementById("username").value.trim(),
    nickname: document.getElementById("nickname").value.trim(),
    password: document.getElementById("password").value,
    latitude: document.getElementById("lat").value.trim(),
    longitude: document.getElementById("lng").value.trim(),
    service_days_total: document.getElementById("service-plan").value === "unlimited" ? null : Number(document.getElementById("service-plan").value),
  };
}

function validateCoordinates(data) {
  if (data.latitude && (Number(data.latitude) < -90 || Number(data.latitude) > 90)) {
    throw new Error("Latitude tidak valid.");
  }

  if (data.longitude && (Number(data.longitude) < -180 || Number(data.longitude) > 180)) {
    throw new Error("Longitude tidak valid.");
  }
}

async function loadUsers() {
  try {
    usersSummary.textContent = "Memuat...";
    usersList.replaceChildren(createEmptyRow("Memuat..."));

    usersData = await getUsers();
    renderUsers();
  } catch (err) {
    console.error(err);
    usersSummary.textContent = "Gagal memuat";
    usersList.replaceChildren(createEmptyRow(err.message || "Gagal memuat user.", "row-error"));
  }
}

prevButton.addEventListener("click", () => {
  currentPage -= 1;
  renderUsers();
});

nextButton.addEventListener("click", () => {
  currentPage += 1;
  renderUsers();
});

openUserModalButton.addEventListener("click", () => openUserModal());
closeUserModalButton.addEventListener("click", closeUserModal);

userModal.addEventListener("click", (event) => {
  if (event.target === userModal) {
    closeUserModal();
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    clearMessage();
    const data = getFormData();
    validateCoordinates(data);
    setLoading(true);

    if (editingId) await updateUser(editingId, data);
    else await createUser(data);
    resetForm();
    currentPage = 1;

    await loadUsers();
    setMessage("User tersimpan.");
    closeUserModal();
  } catch (err) {
    console.error(err);
    setMessage(err.message || "Gagal menambah user", "error");
  } finally {
    setLoading(false);
  }
});

loadUsers();
