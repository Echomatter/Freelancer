const plain = row => row && { ...row };

export function createModelRatings(db, tx) {
  return {
    modelCatalog(rows) {
      tx(() => {
        const save = db.prepare(`INSERT INTO model_catalog(model_id,metadata_json) VALUES(?,?)
          ON CONFLICT(model_id) DO UPDATE SET metadata_json=excluded.metadata_json`);
        for (const row of rows) save.run(row.id, JSON.stringify(row));
      });
      return this.modelRatings();
    },
    modelRatings() {
      return Object.fromEntries(db.prepare('SELECT model_id, rating_json, updated_at, source_model FROM model_catalog').all()
        .map((row) => [row.model_id, { status: row.rating_json ? 'Updated' : 'Missing information',
          rating: row.rating_json ? JSON.parse(row.rating_json) : null,
          updatedAt: row.updated_at, sourceModel: row.source_model }]));
    },
    unratedModels() {
      return db.prepare('SELECT model_id, metadata_json FROM model_catalog ORDER BY (rating_json IS NOT NULL), updated_at, model_id').all()
        .map((row) => ({ id: row.model_id, ...JSON.parse(row.metadata_json) }));
    },
    saveModelRatings(rows, sourceModel) {
      tx(() => {
        const save = db.prepare('UPDATE model_catalog SET rating_json=?, updated_at=?, source_model=? WHERE model_id=?');
        for (const row of rows) if (save.run(JSON.stringify(row.rating), Date.now(), sourceModel, row.id).changes !== 1)
          throw Error('Model inventory changed during the ratings update. Refresh and try again.');
      });
    },
    ratingJob(id) {
      const row = db.prepare('SELECT * FROM model_rating_jobs WHERE id=?').get(id);
      return row && { id: row.id, project: row.project_id, session: row.session_id,
        model: row.model_id, targets: JSON.parse(row.targets_json), status: row.status,
        summary: row.summary, error: row.error, progress: JSON.parse(row.progress_json), createdAt: row.created_at, updatedAt: row.updated_at };
    },
    currentRatingJob() {
      const row = db.prepare('SELECT id FROM model_rating_jobs ORDER BY created_at DESC LIMIT 1').get();
      const job = row ? this.ratingJob(row.id) : null;
      return job?.status === 'dismissed' ? null : job;
    },
    systemSessions(project) {
      const sessions = new Set();
      for (const row of db.prepare('SELECT session_id, progress_json FROM model_rating_jobs WHERE project_id=?').all(project)) {
        sessions.add(row.session_id);
        for (const worker of JSON.parse(row.progress_json ?? '{}').workers ?? []) if (worker.session) sessions.add(worker.session);
      }
      return sessions;
    },
    saveRatingJob(job) {
      db.prepare(`INSERT INTO model_rating_jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET status=excluded.status, summary=excluded.summary,
        error=excluded.error, progress_json=excluded.progress_json, updated_at=excluded.updated_at`)
        .run(job.id, job.project, job.session, job.model, JSON.stringify(job.targets), job.status,
          job.summary, job.error ?? null, job.createdAt, Date.now(), JSON.stringify(job.progress ?? {}));
      return this.ratingJob(job.id);
    },
  };
}
