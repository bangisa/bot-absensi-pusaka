export function paginate(items, requestedPage, pageSize = 10) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(Math.max(requestedPage, 1), totalPages);
  const start = (currentPage - 1) * pageSize;
  return { currentPage, totalPages, items: items.slice(start, start + pageSize) };
}

export function updatePagination({ currentPage, totalPages }, info, previous, next) {
  info.textContent = `Hal ${currentPage}/${totalPages}`;
  previous.disabled = currentPage <= 1;
  next.disabled = currentPage >= totalPages;
}

export function createEmptyRow(message, columns, className = "row-empty") {
  const row = document.createElement("tr");
  row.className = className;
  const cell = document.createElement("td");
  cell.colSpan = columns;
  cell.textContent = message;
  row.appendChild(cell);
  return row;
}
