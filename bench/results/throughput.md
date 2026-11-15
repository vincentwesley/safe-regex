| workload | built-in RegExp | SafeRegExp | ratio |
|---|---|---|---|
| literal search (8547 matches) | 0.3 ms | 11.9 ms | 41× |
| ISO dates (8547 matches) | 0.6 ms | 29.2 ms | 47× |
| emails (8547 matches) | 8.9 ms | 189.6 ms | 21× |
| IPv4 (8547 matches) | 1.3 ms | 34.6 ms | 26× |
| words, case-insensitive (8548 matches) | 0.4 ms | 14.3 ms | 33× |
| line trim (1 matches) | 1.2 ms | 31.1 ms | 26× |

Built-in vs SafeRegExp on v22.23.4, best of 5 runs after one warm-up (`bench/throughput.mjs`).
