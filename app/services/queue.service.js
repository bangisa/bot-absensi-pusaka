const MAX_CONCURRENT = 2;
let running = 0;
let queue = [];

// 🔁 tambah ke queue
function addToQueue(task) {
  queue.push(task);
  processQueue();
}

// 🔄 worker
async function processQueue() {
  // jalankan selama masih ada slot & task
  while (running < MAX_CONCURRENT && queue.length > 0) {
    const task = queue.shift();
    running++;

    // jalankan task async tanpa blocking loop
    task()
      .catch((err) => {
        console.log("[x] Queue error:", err.message);
      })
      .finally(() => {
        running--;
        processQueue();
      });
  }
}

module.exports = {
  addToQueue,
};
