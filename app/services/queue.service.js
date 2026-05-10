const MAX_CONCURRENT = 2;
const TASK_TIMEOUT = 180000;

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

    console.log(
      `[QUEUE] Start | Running: ${running}, Pending: ${queue.length}`,
    );

    withTimeout(task)
      .catch((err) => {
        console.log("[X] Queue error:", err.message);
      })
      .finally(() => {
        running--;
        console.log(
          `[QUEUE] Done | Running: ${running}, Pending: ${queue.length}`,
        );
        processQueue();
      });
  }
}

function addToQueue(task) {
  return new Promise((resolve, reject) => {
    queue.push(async () => {
      try {
        const result = await task();
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
    processQueue();
  });
}

export { addToQueue };
