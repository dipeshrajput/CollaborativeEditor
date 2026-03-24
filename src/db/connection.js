const {Pool} = require("pg");

const pool = new Pool({
    user: 'postgres',
    password: 'abc123',
    host: 'postgres',  
    port: 5432,
    database: 'collab_editor'
})

module.exports = pool;