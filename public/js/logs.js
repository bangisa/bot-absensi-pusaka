import { getLogs } from "./api.js";

const logsContainer = document.getElementById("logs");

function createLogRow(log) {
  const row = document.createElement("tr");
  const createdAt = new Date(log.created_at).toLocaleString("id-ID");

  row.className = `log-${log.status}`;

  row.innerHTML = `
    <td>${createdAt}</td>

    <td>${log.username}</td>

    <td>
      <span class="badge type-${log.type}">
        ${log.type}
      </span>
    </td>

    <td>
      <span class="badge status-${log.status}">
        ${log.status}
      </span>
    </td>

    <td>${log.message}</td>
  `;

  return row;
}

async function loadLogs() {
  try {
    const logs = await getLogs();

    logsContainer.innerHTML = "";

    logs.forEach((log) => {
      logsContainer.appendChild(createLogRow(log));
    });
  } catch (err) {
    console.error(err);
  }
}

loadLogs();

setInterval(loadLogs, 5000);
