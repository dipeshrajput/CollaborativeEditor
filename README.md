# Collab Editor Server

Realtime collaborative editor backend with a simple browser client (`public/index.html`). The server uses WebSockets for live ops and PostgreSQL to persist operations.

**Requirements**
1. Node.js 18+ (or any recent LTS).
2. PostgreSQL running locally.

**Setup**
1. Install dependencies.
   `npm install express ws pg uuid`
2. Create the database and table.
   ```sql
   CREATE DATABASE collab_editor;

   \c collab_editor

   CREATE TABLE operations (
     id UUID PRIMARY KEY,
     document_id TEXT NOT NULL,
     type TEXT NOT NULL,
     position INTEGER NOT NULL,
     text TEXT,
     length INTEGER,
     client_id TEXT NOT NULL,
     base_version INTEGER NOT NULL,
     committed_version INTEGER NOT NULL
   );
   ```
3. Update DB credentials if needed in `src/db/connection.js`.

**Run**
1. Start the WebSocket server.
   `node src/server/ws-server.js`
2. Open `public/index.html` in a browser.
3. Create or join a room to start collaborating.

**Notes**
1. The client connects to `ws://localhost:8080` by default.
2. The server persists every operation to the `operations` table and reconstructs documents on join.
