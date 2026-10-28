// Claim: "a token works on any request, whichever copy answers it."
//
// One token, the member token that ONE copy printed at startup, is sent on
// REQUESTS authenticated reads (GET /bookings) through the proxy. Each answer is
// filed under the copy that gave it, by the X-Upstream header the proxy adds.
// The run passes only if every answer is a 200.
//
//   docker compose --profile load run --rm --no-deps \
//     -e TOKEN=<a u-1 token from `docker compose logs api`> -e N=2 \
//     k6 run /load/tokens.js
//
// (load/run.sh tokens.js looks the token up and does this for you.)

import http from 'k6/http';
import { Rate } from 'k6/metrics';

const BASE = __ENV.BASE || 'http://proxy';
const TOKEN = __ENV.TOKEN;
const N = Number(__ENV.N || 2); // copies the run must see behind the proxy
const REQUESTS = Number(__ENV.REQUESTS || 40);

const accepted = new Rate('token_accepted');

export const options = {
  // One user, one request at a time: the claim is about which copy answers,
  // not about load, so nothing here should depend on timing.
  scenarios: { reads: { executor: 'per-vu-iterations', vus: 1, iterations: 1 } },
  thresholds: { token_accepted: ['rate==1'] },
};

export function setup() {
  if (!TOKEN) {
    throw new Error('Set TOKEN to a token one copy printed (docker compose logs api).');
  }
  // Count the copies behind the proxy before trusting anything else.
  const seen = new Set();
  for (let i = 0; i < 4 * N; i++) {
    seen.add(http.get(`${BASE}/health`).headers['X-Upstream']);
  }
  if (seen.size < N) {
    throw new Error(`expected ${N} copies behind the proxy, saw ${[...seen].join(', ')}`);
  }
}

export default function () {
  const answers = {}; // X-Upstream -> { status -> count }
  for (let i = 0; i < REQUESTS; i++) {
    const res = http.get(`${BASE}/bookings`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const copy = res.headers['X-Upstream'] || '(no X-Upstream)';
    answers[copy] = answers[copy] || {};
    answers[copy][res.status] = (answers[copy][res.status] || 0) + 1;
    accepted.add(res.status === 200);
  }

  const copies = Object.keys(answers).sort();
  console.log(`token ${TOKEN.slice(0, 4)}... sent ${REQUESTS} times through ${BASE}`);
  for (const copy of copies) {
    const statuses = Object.entries(answers[copy]).map(([s, n]) => `${s} x${n}`).join(', ');
    console.log(`  answered by ${copy}: ${statuses}`);
  }
  console.log(`distinct X-Upstream values: ${copies.length}`);
}
