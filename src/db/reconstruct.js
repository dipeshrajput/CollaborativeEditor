const {getOperations } = require('./operations');



function applyOperation(doc, op) {
 
  if (op.type === 'insert') {
    return doc.slice(0,op.position) + op.text + doc.slice(op.position);
  }
  else if (op.type === 'delete') {
    return doc.slice(0,op.position) + doc.slice(op.position + op.length);   
  }
  return doc;  


 
}    


async function reconstruction(document_id) {
 const data = await getOperations(document_id);   
  let text = '';
  let version = 0;
  let history = [];
 for (let op of data) {
     text = applyOperation(text, op);
    version = op.committed_version;
    history.push(op);
 }
   return { text, version, history };
 
}
module.exports = {
    reconstruction
};