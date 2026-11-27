import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { handicapPoints } from '../../src/engine/handicap.ts';
import { fromGtp, toGtp } from './coords.ts';
import {
  EngineUnavailableError,
  type Analysis,
  type AnalyzeOptions,
  type Candidate,
  type EngineHealth,
  type GoEngineAdapter,
  type PositionRequest,
} from './types.ts';

export interface KataGoConfig {
  binary: string;
  model: string;
  config: string;
  /** optional: b18c384nbt-humanv0 model enabling rank-calibrated play */
  humanModel?: string;
  /** extra CLI args, e.g. ['-override-config', 'numSearchThreads=8'] */
  extraArgs?: string[];
  queryTimeoutMs?: number;
}

interface Pending {
  resolve: (v: any[]) => void;
  reject: (e: Error) => void;
  expected: number;
  results: any[];
  timer: NodeJS.Timeout;
}

/**
 * Talks to a real KataGo process using its JSON "analysis engine" protocol
 * (https://github.com/lightvector/KataGo/blob/master/docs/Analysis_Engine.md).
 * The process is started lazily and restarted if it dies. Nothing here fakes analysis:
 * when KataGo cannot be started every call rejects with EngineUnavailableError.
 */
export class KataGoAdapter implements GoEngineAdapter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, Pending>();
  private seq = 0;
  private startError: string | null = null;
  private stderrTail: string[] = [];

  constructor(private cfg: KataGoConfig) {}

  private ensure(): ChildProcessWithoutNullStreams {
    if (this.proc && !this.proc.killed && this.proc.exitCode === null) return this.proc;
    const args = ['analysis', '-config', this.cfg.config, '-model', this.cfg.model];
    if (this.cfg.humanModel) args.push('-human-model', this.cfg.humanModel);
    args.push(...(this.cfg.extraArgs ?? []));
    const proc = spawn(this.cfg.binary, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.startError = null;
    proc.on('error', (e) => {
      this.startError = e.message;
      this.failAll(new EngineUnavailableError(`cannot start KataGo: ${e.message}`));
    });
    proc.on('exit', (code) => {
      if (this.proc === proc) this.proc = null;
      this.failAll(new EngineUnavailableError(`KataGo exited (code ${code}). ${this.stderrTail.slice(-3).join(' | ')}`));
    });
    proc.stderr.on('data', (d: Buffer) => {
      this.stderrTail.push(...d.toString().split('\n').filter(Boolean));
      this.stderrTail = this.stderrTail.slice(-20);
    });
    createInterface({ input: proc.stdout }).on('line', (line) => this.onLine(line));
    this.proc = proc;
    return proc;
  }

  private failAll(err: Error) {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(id);
    }
  }

  private onLine(line: string) {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // KataGo can print non-JSON banner lines
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    if (msg.error || msg.warning) {
      if (msg.error) {
        clearTimeout(p.timer);
        this.pending.delete(msg.id);
        p.reject(new Error(`KataGo error: ${msg.error}`));
      }
      return;
    }
    p.results.push(msg);
    if (p.results.length >= p.expected) {
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      p.resolve(p.results);
    }
  }

  private query(body: Record<string, unknown>, expected: number): Promise<any[]> {
    return new Promise((resolve, reject) => {
      let proc: ChildProcessWithoutNullStreams;
      try {
        proc = this.ensure();
      } catch (e: any) {
        return reject(new EngineUnavailableError(e.message));
      }
      const id = `q${++this.seq}`;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        proc.stdin.write(JSON.stringify({ id: `t${id}`, action: 'terminate', terminateId: id }) + '\n');
        reject(new Error('analysis timed out'));
      }, this.cfg.queryTimeoutMs ?? 60_000);
      this.pending.set(id, { resolve, reject, expected, results: [], timer });
      proc.stdin.write(JSON.stringify({ id, ...body }) + '\n', (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(new EngineUnavailableError(`cannot write to KataGo: ${err.message}`));
        }
      });
    });
  }

  private buildQuery(pos: PositionRequest, opts: AnalyzeOptions, turns: number[]) {
    const { size } = pos;
    const hp = handicapPoints(size, pos.handicap);
    const firstColor = hp.length > 0 ? 'W' : 'B';
    const moves: [string, string][] = pos.moves.map((p, i) => [(i % 2 === 0) === (firstColor === 'B') ? 'B' : 'W', toGtp(p, size)]);
    const override: Record<string, unknown> = {};
    if (opts.humanProfile && this.cfg.humanModel) {
      override.humanSLProfile = opts.humanProfile;
      override.ignorePreRootHistory = false;
    }
    return {
      rules: pos.rules,
      komi: pos.komi,
      boardXSize: size,
      boardYSize: size,
      initialStones: hp.map((p) => ['B', toGtp(p, size)]),
      initialPlayer: firstColor,
      moves,
      maxVisits: opts.maxVisits,
      analyzeTurns: turns,
      includeOwnership: !!opts.ownership,
      includePolicy: !!opts.policy,
      overrideSettings: override,
    };
  }

  private parse(msg: any, pos: PositionRequest): Analysis {
    const size = pos.size;
    const root = msg.rootInfo ?? {};
    const toPlay = root.currentPlayer === 'W' ? 2 : 1;
    // Our shipped config sets reportAnalysisWinratesAs = BLACK, so values are already Black-relative.
    const candidates: Candidate[] = (msg.moveInfos ?? []).map((m: any) => ({
      p: fromGtp(m.move, size),
      visits: m.visits,
      winrate: m.winrate,
      scoreLead: m.scoreLead,
      prior: m.prior,
      pv: (m.pv ?? []).map((x: string) => fromGtp(x, size)),
    }));
    const analysis: Analysis = {
      toPlay: toPlay as 1 | 2,
      winrate: root.winrate,
      scoreLead: root.scoreLead,
      candidates,
    };
    if (msg.ownership) analysis.ownership = msg.ownership.map((v: number) => v); // KataGo: +1 = Black when reportAnalysisWinratesAs=BLACK
    if (msg.policy) analysis.policy = msg.policy;
    return analysis;
  }

  async analyze(pos: PositionRequest, opts: AnalyzeOptions): Promise<Analysis> {
    const turn = pos.moves.length;
    const res = await this.query(this.buildQuery(pos, opts, [turn]), 1);
    return this.parse(res[0], pos);
  }

  async analyzeTurns(pos: PositionRequest, opts: AnalyzeOptions): Promise<Analysis[]> {
    const turns = opts.turns ?? Array.from({ length: pos.moves.length + 1 }, (_, i) => i);
    const res = await this.query(this.buildQuery(pos, opts, turns), turns.length);
    const out: Analysis[] = [];
    for (const m of res) out[m.turnNumber] = this.parse(m, pos);
    return out;
  }

  async health(): Promise<EngineHealth> {
    try {
      const res = await this.query({ action: 'query_version' }, 1);
      return { ok: true, engine: 'katago', detail: 'running', version: res[0]?.version };
    } catch (e: any) {
      return { ok: false, engine: 'katago', detail: this.startError ?? e.message };
    }
  }

  async close() {
    this.proc?.kill();
    this.proc = null;
  }
}

/** Used when no KataGo is configured: every call fails loudly instead of inventing moves. */
export class UnconfiguredAdapter implements GoEngineAdapter {
  constructor(private reason: string) {}
  async health(): Promise<EngineHealth> {
    return { ok: false, engine: 'katago', detail: this.reason };
  }
  async analyze(): Promise<Analysis> {
    throw new EngineUnavailableError(this.reason);
  }
  async analyzeTurns(): Promise<Analysis[]> {
    throw new EngineUnavailableError(this.reason);
  }
  async close() {}
}
