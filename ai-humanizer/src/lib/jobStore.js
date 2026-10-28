/** Browser-local history. No-retention jobs stay in memory and never touch disk. */
const JOB_KEY = 'humanizer_jobs';
const SETTING_KEY = 'humanizer_settings';
const temporaryJobs = new Map();

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const optionalStrings = (record, fields) => fields.every((field) => record[field] == null || typeof record[field] === 'string');

function validRecord(record, key) {
  if (!isObject(record) || typeof record.id !== 'string' || !record.id) return false;
  if (key === SETTING_KEY) return record.retention_days == null || [0, 7, 30, 90].includes(record.retention_days);
  if (!optionalStrings(record, ['title', 'source_text', 'final_text', 'rewritten_text', 'style', 'custom_style', 'purpose', 'status', 'provider', 'model_fast', 'model_quality', 'prompt_version', 'error', 'notes'])) return false;
  if (['source_words', 'result_words', 'cost_estimate', 'repair_loops'].some((field) => record[field] != null && (typeof record[field] !== 'number' || !Number.isFinite(record[field]) || record[field] < 0))) return false;
  if (['expires_at', 'created_date'].some((field) => record[field] != null && (typeof record[field] !== 'string' || !Number.isFinite(Date.parse(record[field]))))) return false;
  if (record.review_decisions != null && (!isObject(record.review_decisions) || Object.values(record.review_decisions).some((value) => typeof value !== 'boolean'))) return false;
  if (record.unresolved_flags != null && (!Array.isArray(record.unresolved_flags) || record.unresolved_flags.some((flag) => typeof flag !== 'string' && !isObject(flag)))) return false;
  if (record.audit != null) {
    if (!isObject(record.audit) || !optionalStrings(record.audit, ['summary'])) return false;
    for (const field of ['items', 'certainty', 'format_violations']) {
      const entries = record.audit[field];
      if (entries != null && (!Array.isArray(entries) || entries.some((entry) => !isObject(entry) || !optionalStrings(entry, ['kind', 'value', 'status', 'note', 'marker', 'rule'])))) return false;
    }
  }
  if (record.diagnosis != null) {
    if (!isObject(record.diagnosis)) return false;
    for (const field of ['patterns', 'findings']) {
      const findings = record.diagnosis[field];
      if (findings != null && (!Array.isArray(findings) || findings.some((entry) => !isObject(entry) || !optionalStrings(entry, ['pattern', 'location', 'severity'])))) return false;
    }
  }
  return true;
}

function readAll(key) {
  let value;
  try {
    value = JSON.parse(localStorage.getItem(key) || '[]');
  } catch {
    throw new Error('Saved data could not be read. Check that browser storage is available.');
  }
  if (!Array.isArray(value) || value.some((record) => !validRecord(record, key)) || new Set(value.map((record) => record.id)).size !== value.length) {
    throw new Error('Saved data is damaged and could not be opened safely. Your data has not been changed. You can delete saved rewrites in Data & settings or clear this site’s browser data to reset it.');
  }
  return value;
}

function writeAll(key, items) {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    throw new Error('Your browser could not update saved data. Free some site storage or check storage permissions, then try again.');
  }
}

function savedJobs() {
  const all = readAll(JOB_KEY);
  const current = all.filter((job) => !job.expires_at || Date.parse(job.expires_at) > Date.now());
  if (current.length !== all.length) writeAll(JOB_KEY, current);
  return current;
}

const makeId = () => crypto.randomUUID();
const now = () => new Date().toISOString();

const RewriteJob = {
  async create(data) {
    const record = { ...data, id: makeId(), created_date: now() };
    if (data.retention_days === 0) temporaryJobs.set(record.id, record);
    else writeAll(JOB_KEY, [record, ...savedJobs()]);
    return record;
  },
  async get(id) {
    const found = temporaryJobs.get(id) || savedJobs().find((job) => job.id === id);
    if (!found) throw new Error('That rewrite is no longer available. It may have expired or been deleted.');
    return found;
  },
  async update(id, patch) {
    if (temporaryJobs.has(id)) {
      const record = { ...temporaryJobs.get(id), ...patch, id };
      temporaryJobs.set(id, record);
      return record;
    }
    const jobs = savedJobs();
    const index = jobs.findIndex((job) => job.id === id);
    if (index === -1) throw new Error('That rewrite is no longer available.');
    jobs[index] = { ...jobs[index], ...patch, id };
    writeAll(JOB_KEY, jobs);
    return jobs[index];
  },
  async delete(id) {
    if (temporaryJobs.delete(id)) return;
    writeAll(JOB_KEY, savedJobs().filter((job) => job.id !== id));
  },
  async deleteMany(filter) {
    if (filter?.created_by_id !== undefined) {
      temporaryJobs.clear();
      writeAll(JOB_KEY, []);
      return;
    }
    if (filter?.expires_at?.$lt) {
      writeAll(JOB_KEY, savedJobs().filter((job) => !job.expires_at || job.expires_at >= filter.expires_at.$lt));
    }
  },
  async list(sortField = '-created_date', limit = Infinity) {
    const desc = String(sortField).startsWith('-');
    const field = desc ? sortField.slice(1) : sortField;
    return savedJobs().sort((a, b) => {
      const comparison = String(a[field] || '').localeCompare(String(b[field] || ''));
      return desc ? -comparison : comparison;
    }).slice(0, limit);
  },
};

const UserSetting = {
  async list() { return readAll(SETTING_KEY).slice(0, 1); },
  async create(data) {
    const record = { ...data, id: makeId(), created_date: now() };
    writeAll(SETTING_KEY, [record]);
    return record;
  },
  async update(id, patch) {
    const record = readAll(SETTING_KEY).find((setting) => setting.id === id);
    if (!record) throw new Error('Settings could not be found. Reload this page and try again.');
    const updated = { ...record, ...patch, id };
    writeAll(SETTING_KEY, [updated]);
    return updated;
  },
};

export const jobStore = { RewriteJob, UserSetting };
