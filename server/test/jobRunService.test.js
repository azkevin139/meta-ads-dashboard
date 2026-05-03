const test = require('node:test');
const assert = require('node:assert/strict');

function restoreCache(entries) {
  for (const [key, value] of entries) {
    if (value) require.cache[key] = value;
    else delete require.cache[key];
  }
}

test('jobRunService records success and failure lifecycle', async () => {
  const dbPath = require.resolve('../db');
  const servicePath = require.resolve('../services/jobRunService');
  const originals = new Map([
    [dbPath, require.cache[dbPath]],
    [servicePath, require.cache[servicePath]],
  ]);

  const runs = [];
  delete require.cache[servicePath];
  require.cache[dbPath] = {
    exports: {
      queryOne: async (sql, params) => {
        if (sql.includes('INSERT INTO job_runs')) {
          const row = {
            id: runs.length + 1,
            job_name: params[0],
            scope_type: params[1],
            scope_id: params[2],
            status: 'running',
            summary_json: JSON.parse(params[3] || '{}'),
          };
          runs.push(row);
          return { ...row };
        }
        if (sql.includes('UPDATE job_runs')) {
          const row = runs.find((r) => r.id === params[0]);
          row.status = params[1];
          row.summary_json = { ...row.summary_json, ...JSON.parse(params[2] || '{}') };
          row.error_text = params[3];
          return { ...row };
        }
        return null;
      },
      queryAll: async () => [],
    },
  };

  try {
    const service = require('../services/jobRunService');
    const result = await service.recordRun({ jobName: 'test-job' }, async () => ([{ imported: 2 }]), {
      summarize: (rows) => ({ imported: rows[0].imported }),
    });
    assert.equal(result[0].imported, 2);
    assert.equal(runs[0].status, 'success');
    assert.equal(runs[0].summary_json.imported, 2);

    await assert.rejects(
      service.recordRun({ jobName: 'broken-job' }, async () => {
        throw new Error('boom');
      }),
      /boom/
    );
    assert.equal(runs[1].status, 'failed');
    assert.equal(runs[1].error_text, 'boom');
  } finally {
    restoreCache(originals);
  }
});
