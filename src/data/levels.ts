export interface Requirement {
  /** Checked against the player's query before results are compared. */
  pattern: RegExp;
  message: string;
}

export interface Level {
  id: string;
  world: number;
  name: string;
  /** In-fiction mission text. */
  brief: string;
  /** What the player is actually learning, shown under the brief. */
  objective: string;
  tables: string[];
  starter: string;
  solution: string;
  hints: string[];
  requires: Requirement[];
  xp: number;
  /** Which part of the Must Learn KQL series this maps to. */
  reference: string;
  /** Revealed once the query is correct — this is the story payload. */
  clue: string;
}

export const CASE_TITLE = 'Case 4417 — The Contoso Spray';

export const WORLD_BRIEFINGS: Record<number, string> = {
  1: 'Contoso woke up to alerts and no answers. You have the raw tables and nothing else. Establish that the telemetry is trustworthy, then find the shape of the attack.',
  2: 'The attack is real. Now name it. Stop reading rows one at a time and start asking the data questions it can actually answer.',
};

export const CASE_SUMMARY =
  'A password spray against Contoso. Three rotating external addresses hammered a short list of accounts — including the svc-backup service account — while SQL-01 ran hot. The Linux estate was never touched. Eight queries, one conclusion, zero guesswork.';

export const WORLDS = [
  {
    id: 1,
    name: 'Ingest Ridge',
    tagline: 'Get data on screen, then cut it down to size.',
    accent: 0x38bdf8,
  },
  {
    id: 2,
    name: 'Summit of Sums',
    tagline: 'Stop looking at rows. Start looking at answers.',
    accent: 0xa78bfa,
  },
] as const;

export const LEVELS: Level[] = [
  {
    id: 'first-light',
    world: 1,
    name: 'First Light',
    brief:
      'The relay is dark. Every agent in the estate reports into the Heartbeat table — pull a handful of records so we can confirm the feed is alive.',
    objective: 'Return any 5 rows from Heartbeat.',
    tables: ['Heartbeat'],
    starter: 'Heartbeat\n',
    solution: 'Heartbeat\n| take 5',
    hints: [
      'Every KQL query starts with a table name on its own line.',
      'Add a new line starting with a pipe character to chain an operator.',
      'The operator you want is `take`, followed by how many rows you need.',
    ],
    requires: [{ pattern: /\|\s*(take|limit)\b/i, message: 'Use the `take` operator.' }],
    xp: 100,
    reference: 'Must Learn KQL Part 2: Just Above Sea Level',
    clue: 'The feed is alive — every agent is still checking in. Whatever happened here, the evidence was not deleted. It is all still sitting in these tables.',
  },
  {
    id: 'bad-logins',
    world: 1,
    name: 'Failed Handshake',
    brief:
      'Something is rattling the front door. SigninLogs records every authentication attempt, and a ResultType of 0 means it worked. Show me only the attempts that did not.',
    objective: 'Filter SigninLogs down to failed sign-ins.',
    tables: ['SigninLogs'],
    starter: 'SigninLogs\n| where \n',
    solution: 'SigninLogs\n| where ResultType != 0',
    hints: [
      '`where` keeps only the rows matching a condition.',
      'Compare the ResultType column against 0.',
      '"Not equal to" in KQL is `!=`, so the condition is `ResultType != 0`.',
    ],
    requires: [{ pattern: /\|\s*where\b/i, message: 'Use the `where` operator.' }],
    xp: 150,
    reference: 'Must Learn KQL Part 4: Search and Where',
    clue: 'Dozens of sign-ins were rejected as "Invalid username or password", all carrying result code 50126. Nobody mistypes a password that many times. Someone is guessing.',
  },
  {
    id: 'trim-the-noise',
    world: 1,
    name: 'Trim the Noise',
    brief:
      'Seven columns is six too many for the incident bridge. Keep the failed sign-ins, but show only when it happened, who it was, and where it came from.',
    objective: 'Select a specific set of columns with `project`.',
    tables: ['SigninLogs'],
    starter: 'SigninLogs\n| where ResultType != 0\n| project \n',
    solution: 'SigninLogs\n| where ResultType != 0\n| project TimeGenerated, UserPrincipalName, IPAddress',
    hints: [
      '`project` picks which columns survive, in the order you list them.',
      'You need three columns, separated by commas.',
      'They are TimeGenerated, UserPrincipalName and IPAddress.',
    ],
    requires: [
      { pattern: /\|\s*where\b/i, message: 'Keep the `where` filter from the last mission.' },
      { pattern: /\|\s*project\b/i, message: 'Use the `project` operator.' },
    ],
    xp: 150,
    reference: 'Must Learn KQL Part 5: Project and Extend',
    clue: 'Stripped to three columns the pattern is obvious: the rejections cluster into a tight window, and not one of them comes from an office address.',
  },
  {
    id: 'head-count',
    world: 1,
    name: 'Head Count',
    brief:
      'The bridge does not want a table, it wants a number. Windows logs a 4625 event for every failed logon. How many are in the window?',
    objective: 'Collapse a filtered table into a single count.',
    tables: ['SecurityEvent'],
    starter: 'SecurityEvent\n| where EventID == 4625\n',
    solution: 'SecurityEvent\n| where EventID == 4625\n| count',
    hints: [
      'The `count` operator takes no arguments at all.',
      'Filter first, then count what is left.',
      'The final line is simply `| count`.',
    ],
    requires: [
      { pattern: /\|\s*where\b/i, message: 'Filter to event 4625 with `where` first.' },
      { pattern: /\|\s*count\b/i, message: 'Use the `count` operator.' },
    ],
    xp: 200,
    reference: 'Must Learn KQL Part 6: Count',
    clue: 'The Windows estate logged failed logons of its own. They did not stop at the front door — they rattled the servers too.',
  },
  {
    id: 'usual-suspects',
    world: 2,
    name: 'The Usual Suspects',
    brief:
      'The failures are not spread evenly — someone is being targeted. Group the failed sign-ins by account, count them, and put the worst offender on top. Name the counted column FailedAttempts.',
    objective: 'Group rows with `summarize` and order the result.',
    tables: ['SigninLogs'],
    starter: 'SigninLogs\n| where ResultType != 0\n| summarize \n',
    solution:
      'SigninLogs\n| where ResultType != 0\n| summarize FailedAttempts = count() by UserPrincipalName\n| sort by FailedAttempts desc',
    hints: [
      '`summarize` aggregates rows into groups: `summarize <name> = count() by <column>`.',
      'Name the aggregate exactly `FailedAttempts` and group by UserPrincipalName.',
      'Finish with `| sort by FailedAttempts desc` to rank them.',
    ],
    requires: [
      { pattern: /\|\s*summarize\b/i, message: 'Use the `summarize` operator.' },
      { pattern: /\|\s*(sort|order)\s+by\b/i, message: 'Rank the result with `sort by`.' },
    ],
    xp: 250,
    reference: 'Must Learn KQL Part 8: Summarize',
    clue: 'Three accounts absorbed nearly every failure. One of them is svc-backup — a service account no human should ever be signing in as.',
  },
  {
    id: 'hot-metal',
    world: 2,
    name: 'Hot Metal',
    brief:
      'Two boxes in the estate are melting. Average the "% Processor Time" counter per machine and show only the ones running above 80. Call the average AvgCpu.',
    objective: 'Aggregate with `avg()`, then filter the aggregated result.',
    tables: ['Perf'],
    starter: 'Perf\n| where CounterName == "% Processor Time"\n| summarize \n',
    solution:
      'Perf\n| where CounterName == "% Processor Time"\n| summarize AvgCpu = avg(CounterValue) by Computer\n| where AvgCpu > 80',
    hints: [
      'Filter to the right counter first — Perf holds memory counters too.',
      '`summarize AvgCpu = avg(CounterValue) by Computer` gives one row per machine.',
      'You can chain a second `where` after `summarize` to filter the aggregate itself.',
    ],
    requires: [
      { pattern: /avg\s*\(/i, message: 'Average the counter with `avg()`.' },
      { pattern: /\|\s*summarize\b/i, message: 'Use the `summarize` operator.' },
    ],
    xp: 300,
    reference: 'Must Learn KQL Part 8: Summarize',
    clue: 'Two machines are pinned above 80% CPU, and one of them is SQL-01. The crown jewel is the box running hot.',
  },
  {
    id: 'fleet-census',
    world: 2,
    name: 'Fleet Census',
    brief:
      'Procurement wants a headcount by platform. Heartbeat has many rows per machine, so count each machine once. Name the result Machines.',
    objective: 'Count distinct values inside a group with `dcount()`.',
    tables: ['Heartbeat'],
    starter: 'Heartbeat\n| summarize \n',
    solution: 'Heartbeat\n| summarize Machines = dcount(Computer) by OSType',
    hints: [
      'A plain `count()` would count check-ins, not machines.',
      '`dcount(<column>)` counts distinct values.',
      'Group by OSType: `summarize Machines = dcount(Computer) by OSType`.',
    ],
    requires: [{ pattern: /dcount\s*\(/i, message: 'Use `dcount()` so machines are not double counted.' }],
    xp: 300,
    reference: 'Must Learn KQL Part 8: Summarize',
    clue: 'Nine machines, two platforms — and the Linux estate was never touched. Whoever this is, they only know how to attack Windows.',
  },
  {
    id: 'top-talkers',
    world: 2,
    name: 'Top Talkers',
    brief:
      'Final call. Rank the source addresses behind the failed sign-ins and give me only the three loudest. Name the counted column Attempts.',
    objective: 'Rank and slice a result set with `top ... by`.',
    tables: ['SigninLogs'],
    starter: 'SigninLogs\n| where ResultType != 0\n| summarize \n',
    solution:
      'SigninLogs\n| where ResultType != 0\n| summarize Attempts = count() by IPAddress\n| top 3 by Attempts',
    hints: [
      'Summarize by IPAddress first, naming the aggregate `Attempts`.',
      '`top N by <column>` sorts descending and keeps N rows in one step.',
      'The last line is `| top 3 by Attempts`.',
    ],
    requires: [
      { pattern: /\|\s*summarize\b/i, message: 'Use the `summarize` operator.' },
      { pattern: /\|\s*top\s+\d+\s+by\b/i, message: 'Use `top N by` to rank and slice.' },
    ],
    xp: 350,
    reference: 'Must Learn KQL Part 9: Top and Sort',
    clue: 'Three external addresses, none of them ours: 203.0.113.77, 198.51.100.23 and 192.0.2.14. Rotating sources, one target list. This was a password spray — and you proved it with eight queries.',
  },
];

export const levelsForWorld = (world: number) => LEVELS.filter((l) => l.world === world);

export const getLevel = (id: string) => LEVELS.find((l) => l.id === id);
