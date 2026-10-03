-- Application-wide preferences leave the data database; runtime domain
-- settings stay here. The journal recovers the small cross-file commit window.
CREATE TABLE runtime_settings (
  runtime_id TEXT NOT NULL DEFAULT 'legacy-runtime-v1',setting_key TEXT NOT NULL,data TEXT NOT NULL,
  PRIMARY KEY(runtime_id,setting_key)
) STRICT;
INSERT INTO runtime_settings(runtime_id,setting_key,data)
SELECT runtime_id,setting_key,data FROM application_settings;
DROP TABLE application_settings;
DELETE FROM data_table_lifecycle WHERE table_name='application_settings';
INSERT INTO data_table_lifecycle VALUES
 ('runtime_settings','durable','runtime-settings',12);

CREATE TABLE settings_update_journal (
  runtime_id TEXT PRIMARY KEY, previous_revision INTEGER NOT NULL,
  next_revision INTEGER NOT NULL CHECK(next_revision > previous_revision),
  settings_json TEXT NOT NULL
) STRICT;
INSERT INTO data_table_lifecycle VALUES
 ('settings_update_journal','durable','application-settings-recovery',12);
INSERT INTO schema_migrations VALUES (12, 'separate-application-settings', unixepoch() * 1000);
PRAGMA user_version = 12;
