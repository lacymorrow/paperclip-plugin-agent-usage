import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

// Runs the interactive CLI probe and guarantees nothing it started outlives it.
//
// A process group alone is not enough: `script` starts its command in a new
// session on a new pty, so `claude` is never in the shell's group. The probe is
// therefore also found by parentage and by a marker env var that every
// descendant inherits, which still matches after a process is re-parented.

const MARKER_KEY = "PAPERCLIP_USAGE_PROBE_ID";
const MAX_OUTPUT_CHARS = 8 * 1024 * 1024;
const POLL_MS = 50;

export interface ProbeResult {
  stdout: string;
  stderr: string;
  /** True only when the shell exited 0 on its own, before the timeout. */
  ok: boolean;
}

export interface ProbeOptions {
  env: Record<string, string>;
  timeoutMs: number;
  /** Time between SIGTERM and SIGKILL. */
  killGraceMs?: number;
}

interface Probe {
  /** The shell's pid, which is also its process group id. */
  pid: number;
  marker: string;
}

const activeProbes = new Set<Probe>();

interface ProcessInfo {
  pid: number;
  ppid: number;
  marked: boolean;
}

function readProc(marker: string): ProcessInfo[] {
  const found: ProcessInfo[] = [];
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, "utf8");
      // Fields after the parenthesised command name: state, ppid, ...
      const [state, ppid] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (state === "Z") continue;
      let marked = false;
      try {
        marked = readFileSync(`/proc/${name}/environ`, "utf8").split("\0").includes(marker);
      } catch {
        // Another user's process; it cannot be one of ours.
      }
      found.push({ pid: Number(name), ppid: Number(ppid), marked });
    } catch {
      // Exited while we were looking.
    }
  }
  return found;
}

function readPs(marker: string): ProcessInfo[] {
  // BSD ps: -E appends each process's environment to the command column.
  const out = execFileSync("ps", ["-A", "-ww", "-E", "-o", "pid=,ppid=,stat=,command="], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 5000,
  });
  const found: ProcessInfo[] = [];
  for (const line of out.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s(.*)$/.exec(line);
    if (!match || match[3].startsWith("Z")) continue;
    found.push({ pid: Number(match[1]), ppid: Number(match[2]), marked: match[4].includes(marker) });
  }
  return found;
}

/** Live processes belonging to a probe: marked ones, the shell, and their descendants. */
function findProbeProcesses(probe: Probe): number[] {
  let processes: ProcessInfo[];
  try {
    processes = process.platform === "linux" ? readProc(probe.marker) : readPs(probe.marker);
  } catch {
    return [];
  }
  const ours = new Set<number>();
  for (const p of processes) {
    if (p.marked || p.pid === probe.pid) ours.add(p.pid);
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of processes) {
      if (!ours.has(p.pid) && ours.has(p.ppid)) {
        ours.add(p.pid);
        grew = true;
      }
    }
  }
  ours.delete(process.pid);
  return [...ours];
}

function signal(pid: number, name: NodeJS.Signals | 0): boolean {
  try {
    process.kill(pid, name);
    return true;
  } catch {
    return false;
  }
}

function signalProbe(probe: Probe, pids: Iterable<number>, name: NodeJS.Signals): void {
  signal(-probe.pid, name);
  for (const pid of pids) signal(pid, name);
}

/** SIGTERM everything the probe started, then SIGKILL whatever is left after the grace period. */
async function killProbe(probe: Probe, graceMs: number): Promise<void> {
  // Look before signalling: parent links are lost once `script` dies.
  const seen = new Set(findProbeProcesses(probe));
  if (seen.size === 0 && !signal(-probe.pid, 0)) return;
  signalProbe(probe, seen, "SIGTERM");

  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!signal(-probe.pid, 0) && ![...seen].some((pid) => signal(pid, 0))) break;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  for (const pid of findProbeProcesses(probe)) seen.add(pid);
  signalProbe(probe, [...seen].filter((pid) => signal(pid, 0)), "SIGKILL");
}

/**
 * Last-resort synchronous kill for worker shutdown. Probes are detached, so
 * they would otherwise survive the worker.
 */
export function killActiveProbes(): void {
  for (const probe of activeProbes) {
    signalProbe(probe, findProbeProcesses(probe), "SIGKILL");
  }
  activeProbes.clear();
}

process.on("exit", killActiveProbes);

export function runProbeShell(command: string, options: ProbeOptions): Promise<ProbeResult> {
  const { env, timeoutMs, killGraceMs = 2000 } = options;
  const id = randomUUID();

  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", command], {
      detached: true,
      env: { ...env, [MARKER_KEY]: id },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let exitCode: number | null = null;
    let timedOut = false;
    let cleanup: Promise<void> | null = null;
    const probe: Probe | null = child.pid ? { pid: child.pid, marker: `${MARKER_KEY}=${id}` } : null;
    if (probe) activeProbes.add(probe);

    const finish = (): Promise<void> => {
      cleanup ??= (async () => {
        clearTimeout(timer);
        if (probe) {
          await killProbe(probe, killGraceMs);
          activeProbes.delete(probe);
        }
        // Nothing should hold the pipes now. Don't hang the poll if something does.
        await new Promise((done) => setTimeout(done, POLL_MS));
        child.stdout.destroy();
        child.stderr.destroy();
        resolve({ stdout, stderr, ok: exitCode === 0 && !timedOut });
      })();
      return cleanup;
    };

    const timer = setTimeout(() => {
      timedOut = true;
      void finish();
    }, timeoutMs);

    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      if (stdout.length < MAX_OUTPUT_CHARS) stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      if (stderr.length < MAX_OUTPUT_CHARS) stderr += chunk;
    });
    child.on("exit", (code) => {
      exitCode = code;
      void finish();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      if (probe) activeProbes.delete(probe);
      reject(error);
    });
  });
}
