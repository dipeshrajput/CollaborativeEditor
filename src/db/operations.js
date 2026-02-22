
const pool = require('./connection');
const {v4: uuidv4} = require('uuid');


async function saveOperation(op) {
  await pool.query(
    `INSERT INTO operations 
      (id, document_id, type, position, text, length, client_id, base_version, committed_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      uuidv4(),
      op.documentId,
      op.type,
      op.position,
      op.text || null,
      op.length || null,
      op.clientId,
      op.baseVersion,
      op.committedVersion
    ]
  );
}

async function getOperations(documentId) {
 const res = await pool.query(
        `SELECT *FROM operations WHERE document_id = $1 ORDER BY committed_version ASC`,
        [documentId]
 )
 return res.rows;
}    
module.exports = {
    saveOperation,
    getOperations
};