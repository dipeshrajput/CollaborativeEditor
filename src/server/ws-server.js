const http = require("http");
const express = require("express");
const uuid = require("uuid");
const { WebSocketServer } = require("ws");
const app = express();
const pool = require("../db/connection");
const {
  saveOperation,
  getOperations,
  saveSnapshot,
  getLatestSnapshot,
} = require("../db/operations");
const { reconstruction } = require("../db/reconstruct");
const { Redis } = require("ioredis");
const publisher = new Redis();
const subscriber = new Redis();
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

app.get("/", (req, res) => {
  debugger;
  res.send("Server is running");
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
    // op2 completely after op1 → no change
    if (op2.position >= op1.position + op1.length) {
      return op1;
    }
    // op2 completely before op1 → shift position
    if (op2.position + op2.length <= op1.position) {
      op1.position -= op2.length;
      return op1;
    }
    // op2 completely covers op1 → noop
    if (
      op2.position <= op1.position &&
      op2.position + op2.length >= op1.position + op1.length
    ) {
      return { type: "noop" };
    }
    // op2 completely inside op1 → shrink
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
subscriber.on("message", (channel, message) => {
  const { operation, serverVersion, senderId } = JSON.parse(message);

  clients.forEach((client, id) => {
    if (client.documentId === operation.documentId && id !== senderId) {
      client.ws.send(
        JSON.stringify({ type: "remoteOperation", operation, serverVersion }),
      );
    }
  });
});

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
      const doc = getDoc(clients.get(clientId).documentId);
      let operation = message.operation;

      operation.clientId = clientId;
      if (operation.baseVersion < doc.version) {
        const missedOps = doc.history.slice(operation.baseVersion);

        for (let op of missedOps) {
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

      operation.documentId = clients.get(clientId).documentId;

      doc.history.push(operation);

      await saveOperation(operation);
      if (doc.version % 100 === 0) {
        await saveSnapshot({
          documentId: clients.get(clientId).documentId,
          version: doc.version,
          content: doc.text,
        });
      }
      ws.send(JSON.stringify({ type: "ack", serverVersion: doc.version }));

      publisher.publish(
        `doc:${operation.documentId}`,
        JSON.stringify({
          operation,
          serverVersion: doc.version,
          senderId: clientId,
        }),
      );
    } else if (message.type == "cursor") {
      clients.forEach((client, id) => {
        if (
          id !== clientId &&
          client.documentId === clients.get(clientId).documentId
        ) {
          client.ws.send(
            JSON.stringify({ type: "cursor", position: message.position }),
          );
        }
      });
    } else if (message.type == "join") {
      clients.set(clientId, { ws: ws, documentId: message.documentId });
      console.log(clients.get(clientId).documentId);
      const doc = getDoc(message.documentId);
      const { text, version, history } = await reconstruction(
        message.documentId,
      );
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
      if (!subscribedChannels.has(channel)) {
        subscriber.subscribe(channel);
        subscribedChannels.add(channel);
      }
    }
  });

  ws.on("close", () => {
    clients.delete(clientId);
    console.log("Client disconnected");
  });
});

server.listen(8080, () => {
  console.log("Server running on port 8080");
});
