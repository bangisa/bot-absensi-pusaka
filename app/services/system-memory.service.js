import { execFile } from "node:child_process";

function toBytes(kilobytes = 0) {
  return Number(kilobytes || 0) * 1024;
}

function execFileWithPid(file, args, options) {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, options, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({ stdout, pid: child.pid });
    });
  });
}

function collectDescendantPids(processes, rootPids) {
  const roots = new Set(rootPids.filter(Boolean).map(Number));
  const selected = new Set(roots);
  let changed = true;

  while (changed) {
    changed = false;

    for (const item of processes) {
      if (selected.has(item.ppid) && !selected.has(item.pid)) {
        selected.add(item.pid);
        changed = true;
      }
    }
  }

  return selected;
}

function summarizeProcesses(processes, selectedPids, nodePid, browserPid) {
  const selected = processes.filter((item) => selectedPids.has(item.pid));
  const nodeRss = selected
    .filter((item) => item.pid === nodePid)
    .reduce((total, item) => total + item.rss, 0);
  const browserPids = collectDescendantPids(processes, [browserPid]);
  const browserRss = selected
    .filter((item) => browserPids.has(item.pid))
    .reduce((total, item) => total + item.rss, 0);
  const totalRss = selected.reduce((total, item) => total + item.rss, 0);

  return {
    totalRss,
    nodeRss,
    browserRss,
    otherRss: Math.max(0, totalRss - nodeRss - browserRss),
    processCount: selected.length,
  };
}

async function getLinuxProcesses() {
  const { stdout, pid } = await execFileWithPid(
    "ps",
    ["-eo", "pid=,ppid=,rss=,comm="],
    { timeout: 3000 },
  );

  const processes = stdout
    .trim()
    .split("\n")
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);

      if (!match) return null;

      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        rss: toBytes(match[3]),
        name: match[4],
      };
    })
    .filter(Boolean);

  return { processes, collectorPid: pid };
}

async function getWindowsProcesses() {
  const command =
    "Get-CimInstance Win32_Process | " +
    "Select-Object ProcessId,ParentProcessId,WorkingSetSize,Name | " +
    "ConvertTo-Json -Compress";

  const { stdout, pid } = await execFileWithPid(
    "powershell.exe",
    ["-NoProfile", "-Command", command],
    { timeout: 5000 },
  );

  const parsed = JSON.parse(stdout || "[]");
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const processes = rows.map((item) => ({
    pid: Number(item.ProcessId),
    ppid: Number(item.ParentProcessId),
    rss: Number(item.WorkingSetSize || 0),
    name: item.Name,
  }));

  return { processes, collectorPid: pid };
}

async function getProcessTreeMemory(rootPids) {
  const nodePid = process.pid;
  const browserPid = rootPids.find((pid) => pid && pid !== nodePid) ?? null;
  const nodeMemory = process.memoryUsage();
  const fallback = {
    totalRss: nodeMemory.rss,
    nodeRss: nodeMemory.rss,
    browserRss: 0,
    otherRss: 0,
    processCount: 1,
    source: "node",
    available: false,
  };

  try {
    const result = process.platform === "win32"
      ? await getWindowsProcesses()
      : await getLinuxProcesses();
    const selectedPids = collectDescendantPids(result.processes, [nodePid, browserPid]);
    const collectorPids = collectDescendantPids(result.processes, [result.collectorPid]);

    for (const pid of collectorPids) {
      selectedPids.delete(pid);
    }

    return {
      ...summarizeProcesses(result.processes, selectedPids, nodePid, browserPid),
      source: process.platform === "win32" ? "cim" : "ps",
      available: true,
    };
  } catch (err) {
    return {
      ...fallback,
      error: err.message,
    };
  }
}

export { getProcessTreeMemory };
