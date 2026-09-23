// stamps public/version.json so the running app can detect a newer deployment
const fs = require('fs'), path = require('path')
const out = path.join(__dirname, '..', 'public', 'version.json')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify({ build: Date.now().toString(36), built: new Date().toISOString() }) + '\n')
