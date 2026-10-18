import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../../app/services/daily-schedule.service.js', import.meta.url), 'utf8');
const generateSource = source.slice(source.indexOf('async function generateDailySchedules('), source.indexOf('const getJakartaDate ='));
const healthSource = fs.readFileSync(new URL('../../app/services/health.service.js', import.meta.url), 'utf8');
const checkSource = healthSource.slice(healthSource.indexOf('function checkHolidayProvider()'), healthSource.indexOf('async function buildHealthSnapshot('));
let passed = 0;

async function run(name, { day = 'sunday', available = true, isHoliday = false, holidayName = null, cancelAt = 0 } = {}) {
  let providerCalls = 0, userReads = 0, checks = 0;
  const holiday = { available, isHoliday, name: holidayName, source: available ? 'test-provider' : 'unavailable' };
  const generate = new Function('getZonedDate', 'getZonedDay', 'getZonedTime', 'checkNationalHoliday', 'shuffleUsers', 'findAllUsers', generateSource + '; return generateDailySchedules;')(
    () => '2026-10-18', () => day, () => '05:00:00',
    async date => { assert.equal(date, '2026-10-18'); providerCalls++; return holiday; },
    users => users, () => { userReads++; return []; },
  );
  const result = await generate(new Date('2026-10-18T00:00:00+07:00'), { shouldContinue: () => ++checks !== cancelAt });
  assert.equal(providerCalls, cancelAt === 1 ? 0 : 1);
  assert.equal(result.generated, 0);
  if (cancelAt) {
    assert.equal(result.cancelled, true);
    assert.equal(userReads, 0);
  } else {
    const health = new Function('getDailyScheduleGeneratorStatus', checkSource + ';return checkHolidayProvider();')(() => ({ lastResult: result }));
    assert.equal(health.available, available);
    assert.equal(health.source, holiday.source);
    assert.equal(health.status, available ? 'HEALTHY' : 'DEGRADED');
    assert.equal(health.isHoliday, day === 'sunday' || isHoliday);
    assert.equal(userReads, day === 'sunday' || isHoliday ? 0 : 1);
    if (day === 'sunday') assert.match(health.name, /Hari Minggu/);
    if (holidayName) assert.ok(health.name.includes(holidayName));
    assert.deepEqual(holiday, { available, isHoliday, name: holidayName, source: available ? 'test-provider' : 'unavailable' });
  }
  console.log(`PASS ${name}`);
  passed++;
}

await run('Sunday provider available');
await run('Sunday national holiday', { isHoliday: true, holidayName: 'Dummy holiday' });
await run('Sunday provider unavailable', { available: false });
await run('Weekday unchanged', { day: 'monday' });
await run('National holiday unchanged', { day: 'monday', isHoliday: true, holidayName: 'Dummy holiday' });
await run('Cancel before provider', { cancelAt: 1 });
await run('Cancel after provider', { cancelAt: 2 });
console.log(`${passed} PASS, 0 FAIL; no database or external requests used.`);
