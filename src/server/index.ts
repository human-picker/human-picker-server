import { resolve } from 'node:path'
import { DecisionDatabase } from './db.js'
import { getAccessToken } from './auth.js'
import { DecisionService } from './service.js'
import { createApp } from './app.js'

process.umask(0o077)
const host=process.env.HP_HOST ?? '127.0.0.1'
if (host !== '127.0.0.1') throw new Error('V0.1 supports only HP_HOST=127.0.0.1')
const port=Number(process.env.HP_PORT ?? '4173')
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid HP_PORT')
const directory=resolve(process.env.HP_DATA_DIR ?? '.data')
const token=getAccessToken(directory)
const db=new DecisionDatabase(directory)
const service=new DecisionService(db)
const app=createApp(service,token,port)

try {
  await app.listen({host,port})
  console.log(`\n[ HUMAN PICKER // ONLINE ]`)
  console.log(`Web inbox: http://${host}:${port}`)
  console.log(`MCP endpoint: http://${host}:${port}/mcp`)
  console.log(`Access token: ${token}`)
  console.log(`Data directory: ${directory}\n`)
} catch(error) {
  console.error(error)
  db.close()
  process.exit(1)
}

for(const signal of ['SIGINT','SIGTERM'] as const) {
  process.once(signal,async()=>{
    await app.close()
    db.close()
    process.exit(0)
  })
}
