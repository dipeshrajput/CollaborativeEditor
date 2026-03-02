const { getOperations, getLatestSnapshot } = require('./operations');

function applyOperation(doc, op) {
    if (op.type === 'insert') {
        return doc.slice(0, op.position) + op.text + doc.slice(op.position);
    }
    else if (op.type === 'delete') {
        return doc.slice(0, op.position) + doc.slice(op.position + op.length);
    }
    return doc;
}

async function reconstruction(document_id) {
 
    const snapshot = await getLatestSnapshot(document_id);
   // tradeoff for 100 instead of 50 is that we save snapshots less frequently, which can lead to longer reconstruction times, but it reduces the overhead of saving snapshots and can improve performance for documents with a large number of operations.
    let text = snapshot ? snapshot.content : '';
    let version = snapshot ? snapshot.version : 0;
    let history = [];

    const data = await getOperations(document_id);
    const opsAfterSnapshot = data.filter(op => op.committed_version > version);

    for (let op of opsAfterSnapshot) {
        text = applyOperation(text, op);
        version = op.committed_version;
        history.push(op);
    }

    return { text, version, history };
}

module.exports = { reconstruction };  