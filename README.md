# Collab Editor Server

Realtime collaborative editor backend with a simple browser client (`public/index.html`). The server uses WebSockets for live ops and PostgreSQL to persist operations.

**Docker Quick Start**
1. Start the full stack.
   `docker compose up --build`
2. Open `public/index.html` and start collaborating.
3. Stop everything.
   `docker compose down`

Docker Hub image: `dipesh28/collaborativeeditor`
1. Pull image.
   `docker pull dipesh28/collaborativeeditor:latest`
2. Run backend container.
   `docker run -p 8080:8080 dipesh28/collaborativeeditor:latest`

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

**Docker Setup**
1. Build and start all services (backend, PostgreSQL, Redis).
   `docker compose up --build`
2. Open `public/index.html` in a browser.
3. Stop containers when done.
   `docker compose down`
4. Remove containers and volumes (optional).
   `docker compose down -v`

Docker notes:
1. Backend is available at `ws://localhost:8080`.
2. PostgreSQL runs with DB `collab_editor` and loads `init.sql` at startup.
3. Redis runs on `localhost:6379`.

**Notes**
1. The client connects to `ws://localhost:8080` by default.
2. The server persists every operation to the `operations` table and reconstructs documents on join.
![Demo](demo.gif)

## Load Testing Results
- Tested with 6000 concurrent WebSocket users
- 99.8% success rate (5988/6000)
- Server handles ~1000 concurrent connections on single instance
- Scales horizontally via Redis pub/sub
