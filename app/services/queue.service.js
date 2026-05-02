const MAX_CONCURRENT = 2;
const TASK_TIMEOUT = 60000;

let running = 0;
let queue = [];

function withTimeout(task) {
  return Promise.race([
    task(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Task timeout")), TASK_TIMEOUT),
    ),
  ]);
}

function processQueue() {
  while (running < MAX_CONCURRENT && queue.length > 0) {
    const task = queue.shift();
    running++;

    withTimeout(task)
      .catch((err) => {
        console.log("[X] Queue error:", err.message);
      })
      .finally(() => {
        running--;
        processQueue();
      });
  }
}

function addToQueue(task) {
  queue.push(task);
  processQueue();
}

module.exports = { addToQueue };
