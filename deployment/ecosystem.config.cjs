// Deployment draft: prepare production .env and complete acceptance before use.
module.exports = {
  apps: [
    {
      name: "bot-absensi-pusaka",
      script: "index.js",
      cwd: "/opt/bot-absensi-pusaka",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      restart_delay: 3000,
      kill_timeout: 120000,
      max_memory_restart: "750M",
      env: {
        NODE_ENV: "production",
        TZ: "Asia/Jakarta",
      },
    },
  ],
};
