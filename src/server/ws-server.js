const http = require("http");
const express = require("express");
const uuid = require("uuid");
const path = require("path");
const { WebSocketServer } = require("ws");
const app = express();
const PORT = process.env.PORT || 3000;
const pool = require("../db/connection");
const {
  saveOperation,
  saveSnapshot,
} = require("../db/operations");
const { reconstruction } = require("../db/reconstruct");

// Redis pub/sub is disabled for now to allow running without Redis (single-instance mode).
const USE_REDIS = false;

async function testConnection() {
  try {
    const client = await pool.connect();
    console.log("Connected to PostgreSQL");
    client.release();
  } catch (err) {
    console.error("Error connecting to PostgreSQL", err);
  }
}

testConnection();

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
app.use(express.static(path.join(__dirname, "../../public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../../public/index.html"));
});

const clients = new Map();
const subscribedChannels = new Set();
const docs = new Map();

function getDoc(documentId) {
  if (!docs.has(documentId)) {
    docs.set(documentId, { text: "", version: 0, history: [] });
  }
  return docs.get(documentId);
}

function transform(op1, op2) {
  if (!op1 || op1.type === "noop") return op1;
  op1 = { ...op1 };

  // INSERT vs INSERT
  if (op1.type === "insert" && op2.type === "insert") {
    if (
      op2.position < op1.position ||
      (op2.position === op1.position && op2.clientId < op1.clientId)
    ) {
      op1.position += op2.text.length;
    }
    return op1;
  }

  // INSERT vs DELETE
  if (op1.type === "insert" && op2.type === "delete") {
    if (op1.position > op2.position) {
      op1.position =
        op1.position <= op2.position + op2.length
          ? op2.position
          : op1.position - op2.length;
    }
    return op1;
  }

  // DELETE vs INSERT
  if (op1.type === "delete" && op2.type === "insert") {
    if (op2.position <= op1.position) {
      op1.position += op2.text.length;
    } else if (op2.position < op1.position + op1.length) {
      op1.length += op2.text.length;
    }
    return op1;
  }

  // DELETE vs DELETE
  if (op1.type === "delete" && op2.type === "delete") {
    // op2 completely after op1 -> no change
    if (op2.position >= op1.position + op1.length) {
      return op1;
    }
    // op2 completely before op1 -> shift position
    if (op2.position + op2.length <= op1.position) {
      op1.position -= op2.length;
      return op1;
    }
    // op2 completely covers op1 -> noop
    if (
      op2.position <= op1.position &&
      op2.position + op2.length >= op1.position + op1.length
    ) {
      return { type: "noop" };
    }
    // op2 completely inside op1 -> shrink
    if (
      op2.position > op1.position &&
      op2.position + op2.length < op1.position + op1.length
    ) {
      op1.length -= op2.length;
    }
    // op2 overlaps op1 from the left
    else if (op2.position < op1.position) {
      op1.length -= op2.position + op2.length - op1.position;
      op1.position = op2.position;
    }
    // op2 overlaps op1 from the right
    else {
      op1.length -= op1.position + op1.length - op2.position;
    }

    if (op1.length <= 0) return { type: "noop" };

    return op1;
  }

  return op1;
}

function broadcastOperation(operation, serverVersion, senderId) {
  clients.forEach((client, id) => {
    if (client.documentId === operation.documentId && id !== senderId) {
      client.ws.send(
        JSON.stringify({ type: "remoteOperation", operation, serverVersion }),
      );
    }
  });
}

wss.on("connection", (ws) => {
  const clientId = uuid.v4();

  console.log("New client connected:", clientId);

  clients.set(clientId, {
    ws,
    documentId: null,
  });

  ws.on("message", async (msg) => {
    const message = JSON.parse(msg);

    if (message.type === "operation") {
      const documentId = clients.get(clientId)?.documentId;
      if (!documentId) return;

      const doc = getDoc(documentId);
      let operation = message.operation;

      operation.clientId = clientId;
      if (operation.baseVersion < doc.version) {
        const missedOps = doc.history.slice(operation.baseVersion);

        for (const op of missedOps) {
          operation = transform(operation, op);
          if (operation.type === "noop") break;
        }
      }

      if (operation.type === "noop") {
        ws.send(JSON.stringify({ type: "ack", serverVersion: doc.version }));
        return;
      }

      if (operation.type === "insert") {
        const chars = Array.from(doc.text);
        doc.text =
          chars.slice(0, operation.position).join("") +
          operation.text +
          chars.slice(operation.position).join("");
      }

      if (operation.type === "delete") {
        const chars = Array.from(doc.text);
        doc.text =
          chars.slice(0, operation.position).join("") +
          chars.slice(operation.position + operation.length).join("");
      }

      doc.version++;

      operation.committedVersion = doc.version;
      operation.documentId = documentId;
      doc.history.push(operation);

      await saveOperation(operation);
      if (doc.version % 100 === 0) {
        await saveSnapshot({
          documentId,
          version: doc.version,
          content: doc.text,
        });
      }
      ws.send(JSON.stringify({ type: "ack", serverVersion: doc.version }));

      if (USE_REDIS) {
        // Redis publish path intentionally disabled in this mode.
      } else {
        broadcastOperation(operation, doc.version, clientId);
      }
    } else if (message.type == "cursor") {
      const documentId = clients.get(clientId)?.documentId;
      if (!documentId) return;

      clients.forEach((client, id) => {
        if (id !== clientId && client.documentId === documentId) {
          client.ws.send(
            JSON.stringify({ type: "cursor", position: message.position }),
          );
        }
      });
    } else if (message.type == "join") {
      clients.set(clientId, { ws, documentId: message.documentId });
      console.log(clients.get(clientId).documentId);
      const doc = getDoc(message.documentId);
      const { text, version, history } = await reconstruction(message.documentId);
      doc.text = text;
      doc.version = version;
      doc.history = history;
      ws.send(
        JSON.stringify({
          type: "init",
          text: doc.text,
          version: doc.version,
        }),
      );

      const channel = `doc:${message.documentId}`;
      if (USE_REDIS && !subscribedChannels.has(channel)) {
        // Redis subscribe path intentionally disabled in this mode.
        subscribedChannels.add(channel);
      }
    }
  });

  ws.on("close", () => {
    clients.delete(clientId);
    console.log("Client disconnected");
  });
});

server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
