const executed = new Set();

function makeKey(userId, type, date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const h = date.getHours();
  const min = date.getMinutes();
  return `${userId}-${type}-${y}${m}${d}-${h}:${min}`;
}

function shouldRun(userId, type) {
  const key = makeKey(userId, type);
  if (executed.has(key)) return false;

  executed.add(key);

  if (executed.size > 10000) {
    executed.clear();
  }

  return true;
}

module.exports = {
  shouldRun,
};
