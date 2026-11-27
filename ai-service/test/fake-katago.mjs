#!/usr/bin/env node
// TEST DOUBLE — NOT KataGo. Speaks just enough of KataGo's JSON analysis protocol to verify that the
// adapter's process handling, request building and response parsing are correct.
import { createInterface } from 'node:readline';

const LETTERS = 'ABCDEFGHJKLMNOPQRST';
const gtp = (p, size) => `${LETTERS[p % size]}${size - Math.floor(p / size)}`;
const rl = createInterface({ input: process.stdin });

rl.on('line', (line) => {
  const q = JSON.parse(line);
  if (q.action === 'query_version') return console.log(JSON.stringify({ id: q.id, version: 'fake-1.0', gitHash: 'test' }));
  if (q.action === 'terminate') return;
  if (q.boardXSize === 99) return console.log(JSON.stringify({ id: q.id, error: 'unsupported board size' }));
  if (q.maxVisits === 12345) return; // never answers → exercises the timeout path
  const size = q.boardXSize;
  const played = new Set(q.moves.map((m) => m[1]));
  for (const s of q.initialStones) played.add(s[1]);
  for (const turn of q.analyzeTurns) {
    const toPlay = ((turn % 2 === 0) === (q.initialPlayer === 'B')) ? 'B' : 'W';
    // deterministic fake: prefers the first free point in reading order; Black's winrate drifts with the turn number
    const free = [];
    for (let p = 0; p < size * size; p++) if (!played.has(gtp(p, size))) free.push(gtp(p, size));
    const moveInfos = free.slice(0, 5).map((m, i) => ({ move: m, visits: 100 - i * 20, winrate: 0.5 + 0.01 * turn - i * 0.02, scoreLead: turn * 0.5 - i, prior: 0.5 / (i + 1), order: i, pv: [m] }));
    const msg = {
      id: q.id, turnNumber: turn,
      rootInfo: { currentPlayer: toPlay, winrate: 0.5 + 0.01 * turn, scoreLead: turn * 0.5, visits: q.maxVisits },
      moveInfos,
    };
    if (q.includeOwnership) msg.ownership = Array.from({ length: size * size }, (_, i) => (i % 2 ? 0.9 : -0.9));
    console.log(JSON.stringify(msg));
  }
});
