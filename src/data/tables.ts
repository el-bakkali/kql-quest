import type { Database, Row, Table } from '../kql/types';

/**
 * The whole game runs on a frozen clock. `ago(1d)` therefore means the same thing
 * today as it will next year, which keeps every expected answer stable.
 */
export const SIM_NOW = new Date('2026-03-10T12:00:00.000Z');

/** mulberry32 — small, fast, and identical in every browser. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pickOne = <T>(rnd: () => number, items: readonly T[]): T =>
  items[Math.floor(rnd() * items.length)];

const minutesAgo = (minutes: number) => new Date(SIM_NOW.getTime() - minutes * 60_000);

const USERS = [
  'dana.reyes@contoso.com',
  'sam.okafor@contoso.com',
  'lena.novak@contoso.com',
  'raj.patel@contoso.com',
  'mira.kondo@contoso.com',
  'tom.blake@contoso.com',
  'svc-backup@contoso.com',
  'admin@contoso.com',
] as const;

const OFFICE_IPS = ['10.10.4.18', '10.10.4.52', '10.10.7.31', '82.14.66.9', '82.14.66.10'] as const;
const HOSTILE_IPS = ['203.0.113.77', '198.51.100.23', '192.0.2.14'] as const;
const LOCATIONS = ['GB', 'FR', 'US', 'DE', 'NL'] as const;
const APPS = ['Azure Portal', 'Office 365 Exchange Online', 'Microsoft Teams', 'Azure DevOps'] as const;

const SERVERS = ['WEB-01', 'WEB-02', 'WEB-03', 'SQL-01', 'DC-01'] as const;

function buildSigninLogs(): Row[] {
  const rnd = seeded(20260310);
  const rows: Row[] = [];

  // Ordinary traffic: mostly successful, a sprinkling of MFA challenges.
  for (let i = 0; i < 120; i++) {
    const failed = rnd() < 0.12;
    rows.push({
      TimeGenerated: minutesAgo(Math.floor(rnd() * 10080)),
      UserPrincipalName: pickOne(rnd, USERS),
      IPAddress: pickOne(rnd, OFFICE_IPS),
      Location: pickOne(rnd, LOCATIONS),
      AppDisplayName: pickOne(rnd, APPS),
      ResultType: failed ? 50074 : 0,
      ResultDescription: failed ? 'Strong authentication is required' : 'Success',
    });
  }

  // A password-spray burst, so the "find the noisy account" levels have a real answer.
  const sprayTargets = ['dana.reyes@contoso.com', 'admin@contoso.com', 'svc-backup@contoso.com'];
  for (let i = 0; i < 46; i++) {
    rows.push({
      TimeGenerated: minutesAgo(Math.floor(rnd() * 900)),
      UserPrincipalName: sprayTargets[i % sprayTargets.length],
      IPAddress: HOSTILE_IPS[i % HOSTILE_IPS.length],
      Location: pickOne(rnd, ['RU', 'CN', 'BR'] as const),
      AppDisplayName: 'Azure Portal',
      ResultType: 50126,
      ResultDescription: 'Invalid username or password',
    });
  }

  return rows;
}

function buildSecurityEvent(): Row[] {
  const rnd = seeded(778811);
  const rows: Row[] = [];
  const activities: Record<number, string> = {
    4624: 'An account was successfully logged on',
    4625: 'An account failed to log on',
    4672: 'Special privileges assigned to new logon',
    4688: 'A new process has been created',
  };

  for (let i = 0; i < 150; i++) {
    const roll = rnd();
    const eventId = roll < 0.45 ? 4624 : roll < 0.72 ? 4625 : roll < 0.86 ? 4688 : 4672;
    rows.push({
      TimeGenerated: minutesAgo(Math.floor(rnd() * 4320)),
      Computer: pickOne(rnd, SERVERS),
      Account: `CONTOSO\\${pickOne(rnd, USERS).split('@')[0]}`,
      EventID: eventId,
      Activity: activities[eventId],
      LogonType: eventId === 4624 || eventId === 4625 ? pickOne(rnd, [2, 3, 10]) : 0,
    });
  }

  return rows;
}

function buildHeartbeat(): Row[] {
  const rnd = seeded(4242);
  const rows: Row[] = [];
  const fleet = [
    { Computer: 'WEB-01', OSType: 'Windows', Version: '10.0.20348', ComputerEnvironment: 'Azure' },
    { Computer: 'WEB-02', OSType: 'Windows', Version: '10.0.20348', ComputerEnvironment: 'Azure' },
    { Computer: 'WEB-03', OSType: 'Windows', Version: '10.0.17763', ComputerEnvironment: 'Azure' },
    { Computer: 'SQL-01', OSType: 'Windows', Version: '10.0.20348', ComputerEnvironment: 'Non-Azure' },
    { Computer: 'DC-01', OSType: 'Windows', Version: '10.0.17763', ComputerEnvironment: 'Non-Azure' },
    { Computer: 'APP-LX-01', OSType: 'Linux', Version: '22.04', ComputerEnvironment: 'Azure' },
    { Computer: 'APP-LX-02', OSType: 'Linux', Version: '22.04', ComputerEnvironment: 'Azure' },
    { Computer: 'BUILD-LX-01', OSType: 'Linux', Version: '20.04', ComputerEnvironment: 'Non-Azure' },
    { Computer: 'EDGE-LX-01', OSType: 'Linux', Version: '24.04', ComputerEnvironment: 'Azure' },
  ];

  for (const machine of fleet) {
    for (let i = 0; i < 6; i++) {
      rows.push({
        ...machine,
        TimeGenerated: minutesAgo(i * 60 + Math.floor(rnd() * 5)),
        RemoteIPCountry: machine.ComputerEnvironment === 'Azure' ? 'Ireland' : 'United Kingdom',
      });
    }
  }

  return rows;
}

function buildPerf(): Row[] {
  const rnd = seeded(99001);
  const rows: Row[] = [];
  // Two machines are deliberately hot so the "find overloaded servers" level has an answer.
  const cpuBaseline: Record<string, number> = {
    'WEB-01': 34,
    'WEB-02': 87,
    'WEB-03': 41,
    'SQL-01': 91,
    'DC-01': 22,
  };

  for (const computer of SERVERS) {
    for (let i = 0; i < 12; i++) {
      const at = minutesAgo(i * 30);
      rows.push({
        TimeGenerated: at,
        Computer: computer,
        ObjectName: 'Processor',
        CounterName: '% Processor Time',
        CounterValue: Math.round((cpuBaseline[computer] + (rnd() * 6 - 3)) * 100) / 100,
      });
      rows.push({
        TimeGenerated: at,
        Computer: computer,
        ObjectName: 'Memory',
        CounterName: 'Available MBytes',
        CounterValue: Math.round((2048 + rnd() * 4096) * 100) / 100,
      });
    }
  }

  return rows;
}

function table(
  name: string,
  description: string,
  columns: Table['columns'],
  rows: Row[],
): Table {
  return { name, description, columns, rows };
}

export const DB: Database = {
  SigninLogs: table(
    'SigninLogs',
    'Entra ID interactive sign-in attempts. ResultType 0 means success.',
    [
      { name: 'TimeGenerated', type: 'datetime' },
      { name: 'UserPrincipalName', type: 'string' },
      { name: 'IPAddress', type: 'string' },
      { name: 'Location', type: 'string' },
      { name: 'AppDisplayName', type: 'string' },
      { name: 'ResultType', type: 'long' },
      { name: 'ResultDescription', type: 'string' },
    ],
    buildSigninLogs(),
  ),
  SecurityEvent: table(
    'SecurityEvent',
    'Windows security log events forwarded by the agent. 4625 is a failed logon.',
    [
      { name: 'TimeGenerated', type: 'datetime' },
      { name: 'Computer', type: 'string' },
      { name: 'Account', type: 'string' },
      { name: 'EventID', type: 'long' },
      { name: 'Activity', type: 'string' },
      { name: 'LogonType', type: 'long' },
    ],
    buildSecurityEvent(),
  ),
  Heartbeat: table(
    'Heartbeat',
    'One record per agent check-in. The classic "is it alive?" table.',
    [
      { name: 'TimeGenerated', type: 'datetime' },
      { name: 'Computer', type: 'string' },
      { name: 'OSType', type: 'string' },
      { name: 'Version', type: 'string' },
      { name: 'ComputerEnvironment', type: 'string' },
      { name: 'RemoteIPCountry', type: 'string' },
    ],
    buildHeartbeat(),
  ),
  Perf: table(
    'Perf',
    'Performance counters sampled every 30 minutes.',
    [
      { name: 'TimeGenerated', type: 'datetime' },
      { name: 'Computer', type: 'string' },
      { name: 'ObjectName', type: 'string' },
      { name: 'CounterName', type: 'string' },
      { name: 'CounterValue', type: 'real' },
    ],
    buildPerf(),
  ),
};
