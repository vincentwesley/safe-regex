| workload | built-in RegExp | SafeRegExp | ratio |
|---|---|---|---|
| literal search (8547 matches) | 0.3 ms | 15.2 ms | 52× |
| ISO dates (8547 matches) | 0.9 ms | 34.3 ms | 38× |
| emails (8547 matches) | 9.1 ms | 183.2 ms | 20× |
| IPv4 (8547 matches) | 1.3 ms | 35.5 ms | 27× |
| words, case-insensitive (8548 matches) | 0.4 ms | 12.2 ms | 29× |
| last word of each line (9862 matches) | 14.9 ms | 173.4 ms | 12× |

Built-in vs SafeRegExp on v22.23.4, best of 5 runs after one warm-up (`bench/throughput.mjs`).
