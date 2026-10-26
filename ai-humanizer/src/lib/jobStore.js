/** Browser-local history. No-retention jobs stay in memory and never touch disk. */
const JOB_KEY = 'humanizer_jobs';
const SETTING_KEY = 'humanizer_settings';
const temporaryJobs = new Map();

function readAll(key) {
  let value;
  try {
    value = JSON.parse(localStorage.getItem(key) || '[]');
  } catch {
    throw new Error('Saved data could not be read. Check that browser storage is available.');
  }
  if (!Array.isArray(value)) throw new Error('Saved data is damaged. Clear this site’s browser data to reset it.');
  return value;
}

function writeAll(key, items) {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    throw new Error('Your browser could not save this rewrite. Free some site storage, or choose “Do not save to history” in settings.');
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
  async list(sortField = '-created_date', limit = 100) {
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
