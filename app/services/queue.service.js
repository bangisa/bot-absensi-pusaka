import { queueConfig } from "../config/index.js";

const MAX_CONCURRENT = queueConfig.maxConcurrent;
const TASK_TIMEOUT = queueConfig.taskTimeout;

/**
 * Menyimpan antrean berdasarkan user.
 *
 * Bentuk:
 * Map<
 *   userId,
 *   Array<{
 *     task,
 *     resolve,
 *     reject
 *   }>
 * >
 */
const userQueues = new Map();

/**
 * User yang saat ini sedang menjalankan task.
 *
 * Satu user hanya boleh memiliki satu task aktif.
 */
const activeUsers = new Set();

let running = 0;

/**
 * Menjalankan task dengan batas waktu.
 *
 * Catatan:
 * timeout ini hanya menghentikan penantian Promise.
 * Ia belum otomatis menghentikan browser/Puppeteer yang
 * masih berjalan. Penghentian proses browser akan
 * ditangani pada langkah timeout dan recovery.
 */
function withTimeout(task) {
  let timeoutId;

  const taskPromise = Promise.resolve().then(task);

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Queue task timeout setelah ${TASK_TIMEOUT} ms`));
    }, TASK_TIMEOUT);
  });

  return Promise.race([taskPromise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

/**
 * Menghitung seluruh task yang masih menunggu.
 *
 * Task aktif tidak termasuk dalam nilai ini.
 */
function getPendingCount() {
  let total = 0;

  for (const queue of userQueues.values()) {
    total += queue.length;
  }

  return total;
}

/**
 * Menghapus antrean user apabila sudah kosong
 * dan tidak ada task aktif.
 */
function cleanupUserQueue(userId) {
  const queue = userQueues.get(userId);

  if (queue?.length === 0 && !activeUsers.has(userId)) {
    userQueues.delete(userId);
  }
}

/**
 * Mencari user berikutnya yang:
 * - memiliki task pending;
 * - belum memiliki task aktif.
 */
function findNextReadyUserId() {
  for (const [userId, queue] of userQueues) {
    if (queue.length > 0 && !activeUsers.has(userId)) {
      return userId;
    }
  }

  return null;
}

/**
 * Menjalankan satu task milik user.
 */
function runUserTask(userId) {
  const queue = userQueues.get(userId);

  if (!queue || queue.length === 0) {
    cleanupUserQueue(userId);
    return;
  }

  if (activeUsers.has(userId)) {
    return;
  }

  if (running >= MAX_CONCURRENT) {
    return;
  }

  const queueItem = queue.shift();

  activeUsers.add(userId);
  running++;

  console.log(
    `[QUEUE] Start user=${userId} | ` +
      `running=${running}/${MAX_CONCURRENT} | ` +
      `userPending=${queue.length} | ` +
      `totalPending=${getPendingCount()}`,
  );

  withTimeout(queueItem.task)
    .then((result) => {
      queueItem.resolve(result);
    })
    .catch((err) => {
      queueItem.reject(err);
    })
    .finally(() => {
      running--;
      activeUsers.delete(userId);

      console.log(
        `[QUEUE] Done user=${userId} | ` +
          `running=${running}/${MAX_CONCURRENT} | ` +
          `userPending=${queue.length} | ` +
          `totalPending=${getPendingCount()}`,
      );

      cleanupUserQueue(userId);

      /*
       * Memproses task berikutnya.
       *
       * Pemanggilan ini juga memungkinkan task berikut
       * milik user yang sama berjalan setelah task
       * sebelumnya benar-benar selesai.
       */
      processQueue();
    });
}

/**
 * Mengisi seluruh slot concurrency yang tersedia.
 */
function processQueue() {
  while (running < MAX_CONCURRENT) {
    const userId = findNextReadyUserId();

    if (userId === null) {
      break;
    }

    runUserTask(userId);
  }
}

/**
 * Menambahkan task ke antrean user.
 *
 * Task milik user yang sama akan selalu serial.
 * Task milik user berbeda dapat berjalan paralel
 * hingga mencapai MAX_CONCURRENT.
 */
function addToQueue(userId, task) {
  if (userId === undefined || userId === null) {
    return Promise.reject(new Error("userId wajib diberikan ke queue"));
  }

  if (typeof task !== "function") {
    return Promise.reject(new TypeError("Queue task harus berupa function"));
  }

  if (!userQueues.has(userId)) {
    userQueues.set(userId, []);
  }

  return new Promise((resolve, reject) => {
    const queue = userQueues.get(userId);

    queue.push({
      task,
      resolve,
      reject,
    });

    console.log(
      `[QUEUE] Added user=${userId} | ` +
        `userPending=${queue.length} | ` +
        `totalPending=${getPendingCount()}`,
    );

    processQueue();
  });
}

function getQueueStatus() {
  const users = [];

  for (const [userId, queue] of userQueues) {
    users.push({
      userId,
      active: activeUsers.has(userId),
      pending: queue.length,
    });
  }

  return {
    running,
    pending: getPendingCount(),
    maxConcurrent: MAX_CONCURRENT,
    activeUserCount: activeUsers.size,
    queuedUserCount: userQueues.size,
    users,
  };
}

export { addToQueue, getQueueStatus };
