import Fastify from 'fastify'
import staticFiles from '@fastify/static'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { tokenMatches } from './auth.js'
import { registerMcp } from './mcp.js'
import type { DecisionService } from './service.js'

const option = z.object({ id:z.string().min(1).max(64), text:z.string().min(1).max(4000) })
const createSchema = z.object({
  type:z.literal('text'),
  title:z.string().trim().min(1).max(160),
  source:z.string().max(120).optional(),
  context:z.object({project:z.string().max(200).optional(),summary:z.string().max(2000).optional()}).optional(),
  options:z.array(option).min(2).max(9),
  expires_in_seconds:z.number().int().min(60).max(86400).optional()
}).refine(data => new Set(data.options.map(o=>o.id)).size === data.options.length, {message:'Duplicate option IDs'})
const resolveSchema = z.object({option_id:z.string().min(1), text:z.string().max(4000).optional()})
const idSchema = z.object({id:z.string().uuid()})

export function createApp(service:DecisionService, token:string, port:number) {
  const app = Fastify({logger:true, bodyLimit:131072})
  app.addHook('onRequest', async (req,reply) => {
    const host = req.headers.host ?? ''
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`, '127.0.0.1:5173', 'localhost:5173']
    if (!allowedHosts.includes(host)) { reply.code(403).send({error:'invalid_host'}); return }
    const origin = req.headers.origin
    if (origin && ![`http://127.0.0.1:${port}`,`http://localhost:${port}`,'http://127.0.0.1:5173','http://localhost:5173'].includes(origin)) {
      reply.code(403).send({error:'invalid_origin'}); return
    }
    if (req.url.startsWith('/api/') || req.url.startsWith('/mcp')) {
      if (req.url === '/api/v1/health') return
      const authorization = req.headers.authorization
      const given = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined
      if (!tokenMatches(given,token)) reply.code(401).send({error:'unauthorized'})
    }
  })
  app.setErrorHandler((error,req,reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({error:'bad_request',details:error.issues})
    const message = error instanceof Error ? error.message : 'Unknown error'
    if (/Decision is |Unknown option|Selection text|already resolved/.test(message)) {
      return reply.code(409).send({error:'conflict',message})
    }
    req.log.error(error)
    return reply.code(500).send({error:'internal_error'})
  })

  app.get('/api/v1/health', async ()=>({status:'ok',name:'human-picker-server',version:'0.1.0'}))
  app.post('/api/v1/decisions', async (req,reply)=>{
    const parsed=createSchema.parse(req.body)
    const record=service.create(parsed)
    return reply.code(201).send({...record, url:`http://127.0.0.1:${port}/#/d/${record.id}`})
  })
  app.get('/api/v1/decisions', async req=>{
    const query=z.object({status:z.enum(['pending','confirmed','cancelled','expired']).optional()}).parse(req.query)
    return {items:service.list(query.status)}
  })
  app.get('/api/v1/decisions/:id',async (req,reply)=>{
    const {id}=idSchema.parse(req.params)
    return service.get(id) ?? reply.code(404).send({error:'not_found'})
  })
  app.get('/api/v1/decisions/:id/wait', async (req,reply)=>{
    const {id}=idSchema.parse(req.params)
    const {timeout_ms}=z.object({timeout_ms:z.coerce.number().int().min(1000).max(25000).default(15000)}).parse(req.query)
    const record=await service.wait(id,timeout_ms)
    return record ?? reply.code(404).send({error:'not_found'})
  })
  app.post('/api/v1/decisions/:id/resolve',async (req,reply)=>{
    const {id}=idSchema.parse(req.params)
    const {option_id,text}=resolveSchema.parse(req.body)
    return service.resolve(id,option_id,text) ?? reply.code(404).send({error:'not_found'})
  })
  app.post('/api/v1/decisions/:id/cancel',async (req,reply)=>{
    const {id}=idSchema.parse(req.params)
    return service.cancel(id) ?? reply.code(404).send({error:'not_found'})
  })
  app.get('/api/v1/events',(req,reply)=>{
    reply.hijack()
    reply.raw.writeHead(200,{
      'Content-Type':'text/event-stream; charset=utf-8',
      'Cache-Control':'no-cache, no-transform',
      'Connection':'keep-alive',
      'X-Accel-Buffering':'no'
    })
    reply.raw.write('event: ready\ndata: {}\n\n')
    const publish=(event:object)=>{
      if (!reply.raw.destroyed) reply.raw.write(`event: decision\ndata: ${JSON.stringify(event)}\n\n`)
    }
    service.events.on('change',publish)
    const heartbeat=setInterval(()=>{if(!reply.raw.destroyed) reply.raw.write(': heartbeat\n\n')},15000)
    reply.raw.on('close',()=>{clearInterval(heartbeat);service.events.off('change',publish)})
  })
  registerMcp(app,service)
  const webDist=resolve(process.cwd(),'dist/web')
  if (existsSync(webDist)) {
    void app.register(staticFiles,{root:webDist,prefix:'/'})
  } else {
    app.get('/',async (_req,reply)=>reply.type('text/html').send('<h1>Human Picker Server</h1><p>UI not built. Run <code>npm run dev</code> or <code>npm run build</code>.</p>'))
  }
  return app
}
