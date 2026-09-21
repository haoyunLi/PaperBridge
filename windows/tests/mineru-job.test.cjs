const test = require('node:test');
const assert = require('node:assert/strict');
const { createMineruJobGuard } = require('../electron/mineru-job.cjs');

test('cancel during delayed discovery prevents a child from starting and releases the job', async () => {
  const jobs = createMineruJobGuard();
  let finishDetection;
  const detection = new Promise(resolve => { finishDetection = resolve; });
  let spawned = 0;
  const parse = async () => {
    const job = jobs.begin();
    try {
      await detection;
      jobs.check(job);
      spawned++;
    } finally { jobs.finish(job); }
  };
  const running = parse();
  assert.throws(() => jobs.begin(), /already processing/);
  assert.equal(jobs.cancel(), true);
  finishDetection({ compatible: true, executable: 'mineru.exe' });
  await assert.rejects(running, { name: 'AbortError' });
  assert.equal(spawned, 0);
  assert.equal(jobs.cancel(), false);
  const next = jobs.begin();
  assert.doesNotThrow(() => jobs.check(next));
  jobs.finish(next);
});

test('cancel kills an attached process and invalidates even a successful late close', () => {
  const jobs = createMineruJobGuard();
  const job = jobs.begin();
  let kills = 0;
  const child = { kill() { kills++; } };
  jobs.attach(job, child);
  assert.equal(jobs.cancel(), true);
  assert.equal(kills, 1);
  jobs.detach(job, child);
  assert.throws(() => jobs.check(job), { name: 'AbortError' });
  jobs.finish(job);
  assert.equal(jobs.cancel(), false);
});

test('a late close from an old child cannot detach the next job child', () => {
  const jobs = createMineruJobGuard();
  const oldJob = jobs.begin();
  const oldChild = { kill() { throw new Error('old child should not receive a new cancellation'); } };
  jobs.attach(oldJob, oldChild);
  jobs.finish(oldJob);
  const nextJob = jobs.begin();
  let nextKills = 0;
  const nextChild = { kill() { nextKills++; } };
  jobs.attach(nextJob, nextChild);
  jobs.detach(oldJob, oldChild);
  assert.equal(jobs.cancel(), true);
  assert.equal(nextKills, 1);
  jobs.finish(nextJob);
});
