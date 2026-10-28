// Claim: "a room slot is booked at most once."
//
// For each of SLOTS one-hour slots in ROOM, two people ask for the same slot
// at the same moment (one http.batch): Ada (u-1) with copy A's token, sent
// straight to copy A, and Cass (u-2) with copy B's token, sent straight to
// copy B. If a slot is booked at most once, exactly one of each pair is
// confirmed (201) and the other is waitlisted (202), so the run must count
// exactly SLOTS confirmations and no slot confirmed twice.
//
// It goes around the proxy on purpose. A token only works on the copy that
// issued it (tokens.js), so through the proxy about half of these requests
// would stop at a 401 before they reached the booking code, and the run would
// measure tokens again instead of bookings.
//
//   docker compose --profile load run --rm --no-deps \
//     -e A=http://f26-lab09-api-1:8080 -e TOKEN_A=<api-1's u-1 token> \
//     -e B=http://f26-lab09-api-2:8080 -e TOKEN_B=<api-2's u-2 token> \
//     k6 run /load/bookings.js
//
// (load/run.sh bookings.js looks the names and tokens up and does this for
// you; load/run.sh bookings.js 1 1 is the one-copy control.)
//
// Teardown hands back everything the run took, waitlist places first so that
// nothing gets promoted, then bookings. That keeps the next run under the cap
// of five bookings per person. KEEP=1 leaves it all in place to look at.

import http from 'k6/http';
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';

const A = { name: 'A', base: __ENV.A || 'http://f26-lab09-api-1:8080', token: __ENV.TOKEN_A };
const B = { name: 'B', base: __ENV.B || 'http://f26-lab09-api-2:8080', token: __ENV.TOKEN_B };
const SIDES = [A, B];
const N = Number(__ENV.N || 2); // distinct copies the run must reach
const CAP = 5; // BookingPolicy.defaults(): active bookings per person
const SLOTS = Number(__ENV.SLOTS || CAP);
const ROOM = __ENV.ROOM || 'r-1';
const FIRST_HOUR = 10; // UTC, inside the 06:00-22:00 opening hours

const confirmed = new Counter('bookings_201');
const doubleBooked = new Counter('slots_double_booked');

export const options = {
  // Every slot at once, both requests for a slot in the same batch.
  scenarios: {
    same_slots: { executor: 'shared-iterations', vus: SLOTS, iterations: SLOTS },
  },
  thresholds: {
    bookings_201: [`count==${SLOTS}`],
    slots_double_booked: ['count==0'],
  },
};

function auth(side) {
  return { headers: { Authorization: `Bearer ${side.token}` } };
}

export function setup() {
  // A week out, so every slot is in the future and inside the 60-day horizon.
  const date = new Date(Date.now() + 7 * 86400e3).toISOString().slice(0, 10);

  const ips = new Set();
  for (const side of SIDES) {
    if (!side.token) {
      throw new Error(`Set TOKEN_${side.name} to a token ${side.base} printed at startup.`);
    }
    // Each token has to work on its own copy, or every booking would be a 401
    // and the run would pass or fail for the wrong reason.
    const own = http.get(`${side.base}/bookings`, auth(side));
    if (own.status !== 200) {
      throw new Error(`TOKEN_${side.name} got ${own.status} from ${side.base}, its own copy`);
    }
    // Bookings this person already holds would push the run into the cap,
    // and the 409s would look like the invariant holding.
    const held = JSON.parse(own.body).bookings.length;
    if (held + SLOTS > CAP) {
      throw new Error(`TOKEN_${side.name}'s user already holds ${held} bookings at ${side.base}`);
    }
    // Start from the same data: the room has to be empty that day.
    const day = http.get(`${side.base}/rooms/${ROOM}/availability?date=${date}`);
    if (JSON.parse(day.body).bookedMinutes !== 0) {
      throw new Error(`${ROOM} already has bookings on ${date} at ${side.base}`);
    }
    ips.add(own.remote_ip);
  }
  // The direct-call version of counting X-Upstream values.
  if (ips.size < N) {
    throw new Error(`expected ${N} distinct copies, reached ${[...ips].join(', ')}`);
  }
  console.log(`A=${A.base} B=${B.base}, distinct copies reached: ${ips.size} (${[...ips].join(', ')})`);
  return { date };
}

export default function (data) {
  const slot = exec.scenario.iterationInTest;
  const hour = String(FIRST_HOUR + slot).padStart(2, '0');
  const start = `${data.date}T${hour}:00:00Z`;
  const body = { roomId: ROOM, start, minutes: '60' };

  const [ra, rb] = http.batch(SIDES.map((side) => ['POST', `${side.base}/bookings`, body, auth(side)]));

  const wins = [ra, rb].filter((res) => res.status === 201).length;
  confirmed.add(wins);
  doubleBooked.add(wins > 1 ? 1 : 0);
  console.log(`${start}  A ${describe(ra)}  |  B ${describe(rb)}${wins > 1 ? '  <- booked twice' : ''}`);
}

function describe(res) {
  if (res.status === 201) {
    const booking = JSON.parse(res.body).booking;
    return `201 ${booking.id.slice(0, 11)} for ${booking.userId} (${res.remote_ip})`;
  }
  if (res.status === 202) {
    return `202 waitlisted (${res.remote_ip})`;
  }
  return `${res.status} ${res.body} (${res.remote_ip})`;
}

export function teardown(data) {
  if (__ENV.KEEP) {
    return;
  }
  const day = (item) => item.roomId === ROOM && item.start.startsWith(data.date);
  for (const kind of ['waitlist', 'bookings']) {
    for (const side of SIDES) {
      const held = JSON.parse(http.get(`${side.base}/${kind}`, auth(side)).body)[kind];
      for (const item of held.filter(day)) {
        http.del(`${side.base}/${kind}/${item.id}`, null, auth(side));
      }
    }
  }
}
