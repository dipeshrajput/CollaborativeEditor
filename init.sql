CREATE TABLE IF NOT EXISTS snapshots (
  id SERIAL PRIMARY KEY,
  document_id TEXT,
  version INT,
  content TEXT
);

CREATE TABLE IF NOT EXISTS operations (
  id TEXT PRIMARY KEY,
  document_id TEXT,
  type TEXT,
  position INT,
  text TEXT,
  length INT,
  client_id TEXT,
  base_version INT,
  committed_version INT
);