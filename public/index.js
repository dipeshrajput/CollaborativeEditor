let serverVersion = 0;
let inFlight = null;
let buffer   = null;
let localOps = 0;
let currentRoomId = '';
let pendingRoomId = '';
const ws = new WebSocket('ws://localhost:8080');
const textarea = document.getElementById('textForedit');
const statusBadge = document.getElementById('statusBadge');
const statusMeta = document.getElementById('statusMeta');
const roomIdLabel = document.getElementById('roomIdLabel');
const roomIdMini = document.getElementById('roomIdMini');
const roomInput = document.getElementById('roomInput');
const existingRoomBtn = document.getElementById('existingRoomBtn');
const createRoomBtn = document.getElementById('createRoomBtn');
const copyRoomBtn = document.getElementById('copyRoomBtn');
const shareLinkText = document.getElementById('shareLinkText');
const versionLabel = document.getElementById('versionLabel');
const connectionLabel = document.getElementById('connectionLabel');
const localOpsLabel = document.getElementById('localOps');
const latencyLabel = document.getElementById('latencyLabel');
const roomHint = document.getElementById('roomHint');

function enqueue(op) {
  if (!inFlight) {
    sendOp(op);
  } else {
    buffer = buffer ? compose(buffer, op) : op;
  }
}
function sendOp(op) {
  op.baseVersion = serverVersion;  // stamp on the op itself
  inFlight = op;
  ws.send(JSON.stringify({ type: 'operation', operation: op }));
}

function compose(op1, op2) {
  // adjacent inserts -> merge
  if (op1.type === 'insert' && op2.type === 'insert' &&
      op2.position === op1.position + op1.text.length) {
    return {
      ...op1,
      text:   op1.text + op2.text,
      length: op1.length + op2.length
    };
  }

  // adjacent backspaces -> merge
  if (op1.type === 'delete' && op2.type === 'delete' &&
      op2.position === op1.position - 1) {
    return {
      ...op1,
      position: op2.position,
      length:   op1.length + op2.length
    };
  }

  return op2;
}

function transform(op1, op2) {
  if (!op1 || op1.type === 'noop') return op1;
  op1 = { ...op1 };

  // INSERT vs INSERT
  if (op1.type === 'insert' && op2.type === 'insert') {
    if (op2.position < op1.position ||
       (op2.position === op1.position && op2.clientId < op1.clientId)) {
      op1.position += op2.text.length;
    }
    return op1;
  }

  // INSERT vs DELETE
  if (op1.type === 'insert' && op2.type === 'delete') {
    if (op1.position > op2.position) {
      op1.position = op1.position <= op2.position + op2.length
        ? op2.position
        : op1.position - op2.length;
    }
    return op1;
  }

  // DELETE vs INSERT
  if (op1.type === 'delete' && op2.type === 'insert') {
    if (op2.position <= op1.position) {
      op1.position += op2.text.length;
    } else if (op2.position < op1.position + op1.length) {
      op1.length += op2.text.length;
    }
    return op1;
  }

  // DELETE vs DELETE
  if (op1.type === 'delete' && op2.type === 'delete') {
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
    if (op2.position <= op1.position &&
        op2.position + op2.length >= op1.position + op1.length) {
      return { type: 'noop' };
    }
    // op2 completely inside op1 -> shrink
    if (op2.position > op1.position &&
        op2.position + op2.length < op1.position + op1.length) {
      op1.length -= op2.length;
    }
    // op2 overlaps op1 from the left
    else if (op2.position < op1.position) {
      op1.length -= (op2.position + op2.length - op1.position);
      op1.position = op2.position;
    }
    // op2 overlaps op1 from the right
    else {
      op1.length -= (op1.position + op1.length - op2.position);
    }

    if (op1.length <= 0) return { type: 'noop' };

    return op1;
  }

  return op1;
}

function setStatus(kind, label, meta) {
  statusBadge.className = 'status-pill';
  if (kind === 'online') {
    statusBadge.classList.add('status-online');
    connectionLabel.textContent = 'Online';
  } else if (kind === 'error') {
    statusBadge.classList.add('status-error');
    connectionLabel.textContent = 'Error';
  } else {
    statusBadge.classList.add('status-offline');
    connectionLabel.textContent = 'Offline';
  }
  statusBadge.textContent = label;
  statusMeta.textContent = meta || '';
}

function updateRoomUi(roomId) {
  currentRoomId = roomId || '';
  roomIdLabel.textContent = roomId || 'Not connected';
  roomIdMini.textContent = roomId || '--';
  copyRoomBtn.disabled = !roomId;
  if (roomId) {
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomId);
    window.history.replaceState({}, '', url);
    shareLinkText.textContent = url.toString();
  } else {
    shareLinkText.textContent = 'Create or join a room to get a share link.';
  }
}

function generateRoomId() {
  if (window.crypto && crypto.randomUUID) {
    return crypto.randomUUID().split('-')[0];
  }
  return Math.random().toString(36).slice(2, 10);
}

function resetLocalState() {
  inFlight = null;
  buffer = null;
  serverVersion = 0;
  localOps = 0;
  versionLabel.textContent = '0';
  localOpsLabel.textContent = '0';
}

function joinRoom(roomId) {
  const trimmed = (roomId || '').trim();
  if (!trimmed) {
    setStatus('error', 'Room ID needed', 'Enter a room ID to join.');
    return;
  }
  resetLocalState();
  updateRoomUi(trimmed);
  roomHint.textContent = `Connected to room ${trimmed}. Share the ID to invite others.`;
  if (ws.readyState !== WebSocket.OPEN) {
    pendingRoomId = trimmed;
    setStatus('offline', 'Connecting...', 'Waiting for WebSocket connection.');
  } else {
    ws.send(JSON.stringify({ type: 'join', documentId: trimmed }));
  }
}

ws.onopen = () => {
  setStatus('online', 'Online', 'Connected to WebSocket server.');
  const toJoin = pendingRoomId || currentRoomId;
  if (toJoin) {
    pendingRoomId = '';
    ws.send(JSON.stringify({ type: 'join', documentId: toJoin }));
  }
};

ws.onclose = () => {
  setStatus('offline', 'Offline', 'Connection closed.');
};

ws.onerror = () => {
  setStatus('error', 'Error', 'WebSocket error occurred.');
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);

  if (message.type === 'init') {
    textarea.value = message.text;
    serverVersion  = message.version;
    versionLabel.textContent = String(serverVersion);
    inFlight = null;
    buffer   = null;
  } else if (message.type === 'ack') {
    serverVersion = message.serverVersion;
    versionLabel.textContent = String(serverVersion);
    inFlight = null;
    if (buffer) {
      const toSend = buffer;
      buffer = null;
      sendOp(toSend);
    }
  }
  else if (message.type === "cursor") {
    textarea.setSelectionRange(message.position, message.position);
  } else if (message.type === 'remoteOperation') {

    const op = message.operation;

    if (inFlight) inFlight = transform(inFlight, op);
    if (buffer)   buffer   = transform(buffer, op);

    // Apply remote op to textarea
    if (op.type === 'insert') {
      textarea.value = textarea.value.slice(0, op.position)
                     + op.text
                     + textarea.value.slice(op.position);
    }
    if (op.type === 'delete') {
      textarea.value = textarea.value.slice(0, op.position)
                     + textarea.value.slice(op.position + op.length);
    }

    serverVersion = message.serverVersion;
    versionLabel.textContent = String(serverVersion);
  }
};

existingRoomBtn.addEventListener('click', () => joinRoom(roomInput.value));
createRoomBtn.addEventListener('click', () => {
  const newRoom = generateRoomId();
  roomInput.value = newRoom;
  joinRoom(newRoom);
});
copyRoomBtn.addEventListener('click', async () => {
  if (!currentRoomId) return;
  try {
    await navigator.clipboard.writeText(currentRoomId);
    roomHint.textContent = 'Room ID copied to clipboard.';
  } catch (err) {
    roomHint.textContent = 'Copy failed. Select the room ID and copy manually.';
  }
});

roomInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    joinRoom(roomInput.value);
  }
});

const urlParams = new URLSearchParams(window.location.search);
const roomFromUrl = urlParams.get('room');
if (roomFromUrl) {
  roomInput.value = roomFromUrl;
  joinRoom(roomFromUrl);
}

textarea.addEventListener('beforeinput', (e) => {
  if (e.inputType === 'insertText' && e.data) {
    localOps += 1;
    localOpsLabel.textContent = String(localOps);
    enqueue({ type: 'insert', position: textarea.selectionStart,
              text: e.data, length: e.data.length });
  }
  else if (e.inputType === 'deleteContentBackward') {
    if (textarea.selectionStart === 0) return;
    localOps += 1;
    localOpsLabel.textContent = String(localOps);
    enqueue({ type: 'delete', position: textarea.selectionStart - 1, length: 1 });
  }
});

setStatus('offline', 'Offline', 'Connecting to WebSocket server.');
latencyLabel.textContent = 'Realtime';
