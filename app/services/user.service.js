import { insertUsers } from "../models/index.js";

function createUsers(users) {
  if (!Array.isArray(users)) {
    throw new Error("Body harus array");
  }

  return insertUsers(users);
}

export { createUsers };
