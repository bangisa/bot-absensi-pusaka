import { getLogs } from "./api.js";

const PAGE_SIZE = 10;

const logsContainer = document.getElementById("logs");
const logsSummary = document.getElementById("logs-summary");
const statusFilter = document.getElementById("status-filter");
const typeFilter = document.getElementById("type-filter");
const searchInput = document.getElementById("log-search");
const refreshButton = document.getElementById("refresh-logs");
const prevButton = document.getElementById("logs-prev");
const nextButton = document.getElementById("logs-next");
const pageInfo = document.getElementById("logs-page-info");

let allLogs = [];
let currentPage = 1;

function createCell(value) {
  const cell = document.createElement("td");
  cell.textContent = value ?? "-";
  return cell;
}

function createBadge(value, className) {
  const badge = document.createElement("span");
  badge.className = `badge ${className}`;
  badge.textContent = value ?? "-";
  return badge;
}

function createEmptyRow(message, className = "row-empty") {
  const row = document.createElement("tr");
  row.className = className;

  const cell = document.createElement("td");
  cell.colSpan = 5;
  cell.textContent = message;
  row.appendChild(cell);

  return row;
}

function formatLogDate(value) {
  if (!value) return "-";

  return new Date(value).toLocaleString("id-ID", {
    dateStyle: "short",
    timeStyle: "medium",
  });
}

function createLogRow(log) {
  const row = document.createElement("tr");
  row.className = `log-${log.status}`;

  row.appendChild(createCell(formatLogDate(log.created_at)));
  row.appendChild(createCell(log.nickname));

  const typeCell = document.createElement("td");
  typeCell.appendChild(createBadge(log.type, `type-${log.type}`));
  row.appendChild(typeCell);

  const statusCell = document.createElement("td");
  statusCell.appendChild(createBadge(log.status, `status-${log.status}`));
  row.appendChild(statusCell);

  row.appendChild(createCell(log.message));

  return row;
}

function getFilteredLogs() {
  const status = statusFilter.value;
  const type = typeFilter.value;
  const search = searchInput.value.trim().toLowerCase();

  return allLogs.filter((log) => {
    const matchesStatus = status === "all" || log.status === status;
    const matchesType = type === "all" || log.type === type;
    const text =
      `${log.nickname ?? ""} ${log.username ?? ""} ${log.message ?? ""}`.toLowerCase();
    const matchesSearch = !search || text.includes(search);

    return matchesStatus && matchesType && matchesSearch;
  });
}

function renderLogs(resetPage = false) {
  const logs = getFilteredLogs();
  const totalPages = Math.max(1, Math.ceil(logs.length / PAGE_SIZE));

  if (resetPage) currentPage = 1;
  currentPage = Math.min(Math.max(currentPage, 1), totalPages);

  logsContainer.replaceChildren();
  logsSummary.textContent = `${logs.length}/${allLogs.length} log`;

  if (!logs.length) {
    logsContainer.appendChild(createEmptyRow("Tidak ada log."));
  } else {
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageItems = logs.slice(start, start + PAGE_SIZE);

    pageItems.forEach((log) => {
      logsContainer.appendChild(createLogRow(log));
    });
  }

  pageInfo.textContent = `Hal ${currentPage}/${totalPages}`;
  prevButton.disabled = currentPage <= 1;
  nextButton.disabled = currentPage >= totalPages;
}

async function loadLogs() {
  try {
    refreshButton.disabled = true;
    refreshButton.textContent = "Memuat...";
    logsSummary.textContent = "Memuat...";

    allLogs = await getLogs();
    renderLogs();
  } catch (err) {
    console.error(err);
    logsSummary.textContent = "Gagal memuat";
    logsContainer.replaceChildren(createEmptyRow(err.message || "Gagal memuat log.", "row-error"));
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = "Refresh";
  }
}

statusFilter.addEventListener("change", () => renderLogs(true));
typeFilter.addEventListener("change", () => renderLogs(true));
searchInput.addEventListener("input", () => renderLogs(true));
refreshButton.addEventListener("click", loadLogs);

prevButton.addEventListener("click", () => {
  currentPage -= 1;
  renderLogs();
});

nextButton.addEventListener("click", () => {
  currentPage += 1;
  renderLogs();
});

loadLogs();
setInterval(loadLogs, 5000);
