// 🔍 VALIDASI
function validateUser(data) {
  if (!data.username || !data.password) {
    throw new Error("Username & password wajib");
  }

  // if (data.latitude == null || data.longitude == null) {
  //   throw new Error("Lokasi wajib");
  // }

  // if (!data.masuk || !data.pulang || !data.jumat || !data.sabtu) {
  //   throw new Error("Jam wajib diisi");
  // }
}

export { validateUser };
