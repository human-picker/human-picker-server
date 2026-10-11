import type { FastifyInstance } from 'fastify'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import type { DecisionService } from './service.js'

function makeMcpServer(service: DecisionService): McpServer {
  const mcp = new McpServer({ name: 'human-picker-server', version: '0.1.0' })
  const options = z.array(z.object({id:z.string().min(1).max(64), text:z.string().min(1).max(4000)})).min(2).max(9)
  const respond = (value:unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })
  mcp.registerTool('human_picker_create', {
    description:'Create a text choice in the human decision inbox; return id and URL. User confirmation is required.',
    inputSchema: {
      title:z.string().min(1).max(160),
      options,
      source:z.string().max(120).optional(),
      project:z.string().max(200).optional(),
      summary:z.string().max(2000).optional()
    }
  }, async args => {
    const decision = service.create({type:'text', title:args.title, options:args.options,
      source:args.source, context:{project:args.project, summary:args.summary}})
    return respond({id:decision.id,status:decision.status,url:`http://127.0.0.1:${process.env.HP_PORT ?? 4173}/#/d/${decision.id}`})
  })
  mcp.registerTool('human_picker_get_result', {
    description:'Read the status and selected text of a previously created decision.',
    inputSchema:{ id:z.string().uuid() }
  }, async ({id}) => respond(service.get(id) ?? {error:'not_found'}))
  mcp.registerTool('human_picker_wait_result', {
    description:'Wait up to 25 seconds for human confirmation; if still pending, call again. Cancellation is not confirmation.',
    inputSchema:{id:z.string().uuid(),timeout_ms:z.number().int().min(1000).max(25000).default(15000)}
  }, async ({id,timeout_ms}) => respond(await service.wait(id,timeout_ms) ?? {error:'not_found'}))
  return mcp
}

export function registerMcp(app:FastifyInstance, service:DecisionService):void {
  app.post('/mcp', async (req, reply) => {
    const mcp = makeMcpServer(service)
    const transport = new StreamableHTTPServerTransport({sessionIdGenerator:undefined, enableJsonResponse:true})
    reply.hijack()
    try {
      await mcp.connect(transport)
      await transport.handleRequest(req.raw, reply.raw, req.body)
    } catch (error) {
      req.log.error(error, 'MCP request failed')
      if (!reply.raw.headersSent) { reply.raw.statusCode=500; reply.raw.end('MCP error') }
    } finally {
      await transport.close()
      await mcp.close()
    }
  })
  app.get('/mcp', async (_req, reply) => reply.code(405).send({error:'POST required for stateless MCP'}))
  app.delete('/mcp', async (_req, reply) => reply.code(405).send({error:'Sessionless MCP server'}))
}
