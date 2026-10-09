// 🔍 VALIDASI
function validateUser(data) {
  if (!data.username || !data.password) {
    throw new Error("Username & password wajib");
  }

}

function validateUserInput(data, { partial = false } = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Data user tidak valid.");
  const allowed = ["nickname", "username", "password", "latitude", "longitude", "service_days_total"];
  if (Object.keys(data).some(key => !allowed.includes(key))) throw new Error("Field user tidak diizinkan.");
  const result = {};
  for (const key of ["nickname", "username", "password"]) {
    if (!(key in data)) { if (!partial) throw new Error(`${key} wajib diisi.`); continue; }
    if (typeof data[key] !== "string" || data[key].length > (key === "password" ? 1024 : 200)) throw new Error(`${key} tidak valid.`);
    const value = key === "password" ? data[key] : data[key].trim();
    if (partial && key !== "nickname" && !value.trim()) continue;
    if (!value.trim()) throw new Error(`${key} wajib diisi.`);
    result[key] = value;
  }
  for (const [key, limit] of [["latitude", 90], ["longitude", 180]]) {
    if (!(key in data)) { if (!partial) throw new Error(`${key} wajib diisi.`); continue; }
    const value = data[key];
    if (!["string", "number"].includes(typeof value) || String(value).trim() === "" || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > limit) throw new Error(`${key} tidak valid.`);
    result[key] = Number(value);
  }
  if ("service_days_total" in data) {
    if (data.service_days_total !== null && ![1, 7, 30, 90].includes(data.service_days_total)) throw new Error("Paket tidak valid.");
    result.service_days_total = data.service_days_total;
  }
  return result;
}

export { validateUser, validateUserInput };
