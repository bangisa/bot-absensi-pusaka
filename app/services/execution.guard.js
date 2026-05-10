const executed = new Map();
const TTL = 60 * 1000;

function shouldRun(userId, type) {
  const key = `${userId}-${type}`;
  const now = Date.now();

  if (executed.has(key)) {
    const lastRun = executed.get(key);

    if (now - lastRun < TTL) {
      console.log(`[GUARD] Skip ${key}`);
      return false;
    }
  }

  executed.set(key, now);
  return true;
}

export { shouldRun };
