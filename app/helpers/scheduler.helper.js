import { nowID } from "./time.helper.js";

function matchTime(target) {
  const currentTime = nowID();

  const current =
    `${String(currentTime.getHours()).padStart(2, "0")}:` +
    `${String(currentTime.getMinutes()).padStart(2, "0")}`;

  return current === target;
}

function resolveTypeForUser(user, day) {
  const results = [];

  // MASUK
  if (day !== 0 && matchTime(user.masuk)) {
    results.push("masuk");
  }

  // PULANG
  if (day >= 1 && day <= 4 && matchTime(user.pulang)) {
    results.push("pulang");
  }

  if (day === 5 && matchTime(user.jumat)) {
    results.push("pulang");
  }

  if (day === 6 && matchTime(user.sabtu)) {
    results.push("pulang");
  }

  return results;
}

export { matchTime, resolveTypeForUser };
