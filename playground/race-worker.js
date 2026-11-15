// Runs one timed match per message, so the page stays responsive and a hung built-in match can
// be stopped by terminating this worker.
import { SafeRegExp } from '../src/index.ts';

self.onmessage = (e) => {
  const { id, engine, pattern, flags, prefix, pump, suffix, n } = e.data;
  try {
    const input = prefix + pump.repeat(n) + suffix;
    const plain = [...flags].filter((c) => c !== 'g' && c !== 'y').join('');
    const re = engine === 'native' ? new RegExp(pattern, plain) : new SafeRegExp(pattern, plain);
    re.test(input.slice(0, 4)); // warm-up
    // Repeat fast matches until 20 ms have passed and report the mean, because worker timers
    // are coarse (often 0.1 ms resolution). A slow first run is reported as is.
    let runs = 0;
    let matched = false;
    const t = performance.now();
    do {
      matched = re.test(input);
      runs++;
    } while (performance.now() - t < 20 && runs < 10000);
    const ms = (performance.now() - t) / runs;
    self.postMessage({ id, ms, matched, length: input.length });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message) });
  }
};
