import { getUsers, createUser, deleteUser } from "./api.js";

const usersList = document.getElementById("users-list");

const form = document.getElementById("user-form");

function createUserRow(user) {
  const row = document.createElement("tr");

  row.innerHTML = `
    <td>${user.id}</td>

    <td>${user.username}</td>

    <td>${user.latitude}</td>

    <td>${user.longitude}</td>

    <td>
      <button class="danger delete-btn">
        Hapus
      </button>
    </td>
  `;

  row.querySelector(".delete-btn").addEventListener("click", async () => {
    if (!confirm("Hapus user?")) return;

    try {
      await deleteUser(user.id);

      await loadUsers();
    } catch (err) {
      console.error(err);

      alert(err.message);
    }
  });

  return row;
}

async function loadUsers() {
  try {
    const users = await getUsers();

    usersList.innerHTML = "";

    if (!users.length) {
      usersList.innerHTML = `
        <tr>
            <td colspan="5">
            Belum ada user
            </td>
        </tr>
    `;

      return;
    }

    users.forEach((user) => {
      usersList.appendChild(createUserRow(user));
    });
  } catch (err) {
    console.error(err);

    usersList.innerHTML = `
        <tr>
            <td colspan="5">
            Belum ada user
            </td>
        </tr>
    `;
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  try {
    await createUser({
      username: document.getElementById("username").value,

      password: document.getElementById("password").value,

      latitude: document.getElementById("lat").value,

      longitude: document.getElementById("lng").value,
    });

    form.reset();

    await loadUsers();

    alert("User berhasil ditambahkan");
  } catch (err) {
    console.error(err);

    alert(err.message);
  }
});

loadUsers();
