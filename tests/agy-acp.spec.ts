import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticateAgy, listAgyModels, promptAgy } from '../src/agy-acp.js'

const state = vi.hoisted(() => ({ home: '' }))
vi.mock('node:os', async importOriginal => ({ ...await importOriginal<typeof import('node:os')>(), homedir: () => state.home }))

// Exercise real child-process pipes without network access or user credentials.
const fixture = `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const log = value => fs.appendFileSync(path.join(__dirname,'trace'), JSON.stringify(value)+'\\n');
const send = value => process.stdout.write(JSON.stringify({jsonrpc:'2.0', ...value})+'\\n');
const update = (sessionId,sessionUpdate,text) => send({method:'session/update',params:{sessionId,update:{sessionUpdate,content:{type:'text',text}}}});
let prompt;
log({cwd:process.cwd(),args:process.argv.slice(2),agent:fs.readFileSync('.agents/agents/dsh-text.md','utf8')});
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const msg=JSON.parse(line); if(msg.method==='session/new') msg.params.cwd=fs.realpathSync(msg.params.cwd); log(msg); const {id, method, params}=msg;
  switch(method) {
    case 'initialize': return send({id,result:{protocolVersion:1,authMethods:[{id:'oauth-personal'}]}});
    case 'authenticate': return send({id,result:{}});
    case 'session/new': return send({id,result:{sessionId:'our-session',models:{availableModels:[{modelId:'flash',name:'Flash'}]}}});
    case 'session/set_model': return send({id,result:{}});
    case 'session/prompt': {
      prompt=id; const text=params.prompt[0].text;
      if(text==='error') return send({id,error:{code:-32000,message:'example private credential'}});
      if(text==='malformed') return process.stdout.write('bad frame\\n');
      if(text==='tool') return update('our-session','tool_call','');
      if(text==='cancel') return update('our-session','agent_message_chunk','started');
      send({id:71,method:'session/request_permission',params:{}});
      send({id:72,method:'fs/read_text_file',params:{}});
      update('other-session','agent_message_chunk','foreign');
      update('our-session','agent_thought_chunk','thought');
      update('our-session','agent_message_chunk','hello');
      break;
    }
    case undefined: if(id===72) {update('our-session','agent_message_chunk',' world'); send({id:prompt,result:{stopReason:'end_turn'}});} break;
  }
});`
async function trace() { return (await readFile(join(state.home, '.local/bin/trace'), 'utf8')).trim().split('\n').map(l => JSON.parse(l)) }

describe('official agy ACP stdio', () => {
  beforeEach(async () => {
    state.home = await mkdtemp(join(tmpdir(), 'agy-fixture-'))
    const bin = join(state.home, '.local/bin'); await mkdir(bin, { recursive: true })
    await writeFile(join(bin, 'agy'), fixture, { mode: 0o700 })
  })
  afterEach(async () => { await rm(state.home, { recursive: true, force: true }) })
  it('selects an advertised model, forwards only its text, and denies client requests', async () => {
    const parts: string[] = []
    await promptAgy({ model: 'flash', prompt: 'hi', onText: s => parts.push(s) })
    expect(parts).toEqual(['hello', ' world'])
    const [start, ...messages] = await trace()
    expect(start.args).toEqual(['acp', '--stdio', '--sandbox', '--agent', 'dsh-text', '--include-default-customizations=false'])
    expect(start.agent).toContain('tools: []'); expect(start.cwd).not.toBe(process.cwd())
    await expect(access(start.cwd)).rejects.toThrow()
    expect(messages.filter(m => m.method).map(m => m.method)).toEqual(['initialize','session/new','session/set_model','session/prompt'])
    expect(messages[0].params.clientCapabilities).toEqual({}); expect(messages[1].params).toEqual({cwd:start.cwd,mcpServers:[]})
    expect(messages[2].params.modelId).toBe('flash'); expect(messages[3].params.prompt).toEqual([{type:'text',text:'hi'}])
    expect(messages.find(m=>m.id===71)?.result).toEqual({outcome:{outcome:'cancelled'}})
    expect(messages.find(m=>m.id===72)?.error.code).toBe(-32601)
  })
  it('authenticates only on explicit request and uses personal OAuth', async () => {
    expect(await listAgyModels()).toEqual([{id:'flash',name:'Flash'}])
    expect((await trace()).some(m=>m.method==='authenticate')).toBe(false)
    await authenticateAgy(); expect((await trace()).at(-1).params).toEqual({methodId:'oauth-personal'})
  })
  it('rejects an unadvertised model without sending a prompt', async () => {
    await expect(promptAgy({model:'wrong',prompt:'hi',onText:vi.fn()})).rejects.toThrow('catalog')
    expect((await trace()).some(m=>m.method==='session/prompt')).toBe(false)
  })
  it.each([['error','sign-in required'],['malformed','Malformed ACP'],['tool','tool in a text-only']])('fails closed on %s', async (prompt, message) => {
    await expect(promptAgy({model:'flash',prompt,onText:vi.fn()})).rejects.toThrow(message)
  })
  it('sends session/cancel, rejects and removes the temporary workspace', async () => {
    const controller = new AbortController()
    await expect(promptAgy({model:'flash',prompt:'cancel',signal:controller.signal,onText:()=>controller.abort()})).rejects.toMatchObject({name:'AbortError'})
    const messages=await trace(); expect(messages.at(-1)).toMatchObject({method:'session/cancel',params:{sessionId:'our-session'}})
    await expect(access(messages[0].cwd)).rejects.toThrow()
  })
})
