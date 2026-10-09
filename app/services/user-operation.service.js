const active = new Set();
export const isUserOperationActive = (id) => active.has(Number(id));
export function beginUserOperation(id) {
  id = Number(id);
  if (active.has(id)) throw new Error("User sedang diproses. Coba kembali setelah selesai.");
  active.add(id);
}
export function endUserOperation(id) { active.delete(Number(id)); }
