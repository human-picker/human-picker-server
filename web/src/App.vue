<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import type { Decision, DecisionStatus } from '../../src/shared/decision.js'

const token = ref(sessionStorage.getItem('hp_token') ?? '')
const tokenDraft = ref(token.value)
const items = ref<Decision[]>([])
const activeId = ref<string | null>(null)
const filter = ref<'pending' | 'all'>('pending')
const picked = ref<string | null>(null)
const edited = ref('')
const busy = ref(false)
const error = ref('')
const flash = ref('')
const synced = ref(false)
let controller: AbortController | undefined
let reconnectTimer: ReturnType<typeof setTimeout> | undefined

const active = computed(() => items.value.find(x=>x.id===activeId.value) ?? null)
const pendingCount = computed(() => items.value.filter(x=>x.status==='pending').length)
const completeCount = computed(() => items.value.filter(x=>x.status==='confirmed').length)
const visible = computed(() => filter.value==='all' ? items.value : items.value.filter(x=>x.status==='pending'))
const canSubmit = computed(() => active.value?.status === 'pending' && !!picked.value)
const selectedOption = computed(() => active.value?.options.find(o=>o.id===picked.value))

async function api<T>(path:string, init:RequestInit = {}):Promise<T> {
  const response=await fetch(path,{
    ...init,
    headers: {
      'Authorization': `Bearer ${token.value}`,
      ...('body' in init ? {'Content-Type':'application/json'} : {}),
      ...init.headers
    }
  })
  if(!response.ok) {
    const data=await response.json().catch(()=>null) as {error?:string;message?:string} | null
    throw new Error(data?.message ?? data?.error ?? `HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}
function currentHash():string|null {
  const match=location.hash.match(/^#\/d\/([0-9a-f-]{36})$/i)
  return match?.[1] ?? null
}
async function refresh() {
  if (!token.value) return
  try {
    const response=await api<{items:Decision[]}>('/api/v1/decisions')
    items.value=response.items
    synced.value=true
    error.value=''
    const wanted=currentHash()
    const choice=wanted ?? activeId.value
    if (choice && response.items.some(d=>d.id===choice)) activeId.value=choice
    else activeId.value=(response.items.find(d=>d.status==='pending') ?? response.items[0])?.id ?? null
  } catch(e) { synced.value=false; error.value=(e as Error).message }
}
function open(id:string) {
  activeId.value=id
  location.hash=`/d/${id}`
}
function startSession() {
  if (controller) controller.abort()
  if (reconnectTimer) clearTimeout(reconnectTimer)
  void refresh()
  void subscribe()
}
function authenticate() {
  const v=tokenDraft.value.trim()
  if(!v) return
  token.value=v
  sessionStorage.setItem('hp_token',v)
  startSession()
}
function signOut() {
  controller?.abort()
  if(reconnectTimer) clearTimeout(reconnectTimer)
  sessionStorage.removeItem('hp_token')
  token.value=''
  tokenDraft.value=''
  synced.value=false
  items.value=[]
  activeId.value=null
}
async function subscribe() {
  if(!token.value) return
  const ctrl=new AbortController()
  controller=ctrl
  try {
    const response=await fetch('/api/v1/events',{headers:{Authorization:`Bearer ${token.value}`},signal:ctrl.signal})
    if(!response.ok||!response.body) throw new Error(`Events unavailable (${response.status})`)
    const reader=response.body.getReader()
    const decoder=new TextDecoder()
    let buffer=''
    while(!ctrl.signal.aborted) {
      const {value,done}=await reader.read()
      if(done) break
      buffer+=decoder.decode(value,{stream:true})
      const events=buffer.split('\n\n')
      buffer=events.pop() ?? ''
      if(events.some(event=>event.includes('event: decision'))) await refresh()
    }
  }catch(e){if(!ctrl.signal.aborted) error.value=`实时连接暂时中断：${(e as Error).message}`}
  if(!ctrl.signal.aborted && token.value) {
    reconnectTimer=setTimeout(()=>{void refresh();void subscribe()},2000)
  }
}
async function act(path:string,body?:object) {
  busy.value=true
  error.value=''
  try {
    await api(path,{method:'POST',body:JSON.stringify(body ?? {})})
    flash.value='DECISION RECORDED'
    picked.value=null
    edited.value=''
    await refresh()
  }catch(e){error.value=(e as Error).message}
  finally{busy.value=false}
}
async function confirm() {
  if(!active.value || !picked.value) return
  await act(`/api/v1/decisions/${active.value.id}/resolve`, {
    option_id:picked.value,
    ...(edited.value.trim() ? {text:edited.value.trim()} : {})
  })
}
async function cancelDecision() {
  if(active.value && active.value.status==='pending') await act(`/api/v1/decisions/${active.value.id}/cancel`)
}
async function copyResult() {
  if(!active.value) return
  const text=active.value.selection?.text ?? (edited.value.trim() || selectedOption.value?.text)
  if(!text) return
  try {await navigator.clipboard.writeText(text); flash.value='COPIED TO CLIPBOARD'}
  catch {error.value='浏览器未授权剪贴板访问，请手动复制文本。'}
}
async function createDemo() {
  busy.value=true
  error.value=''
  try {
    const result=await api<Decision>('/api/v1/decisions',{
      method:'POST',body:JSON.stringify({
        type:'text',title:'选择系统事件标题',source:'demo',
        context:{project:'Personal OS',summary:'演示请求：SQLite 数据持久化和活动日志。'},
        options:[
          {id:'a',text:'feat(storage): [DATA VAULT ONLINE] 本地数据核心已接入'},
          {id:'b',text:'feat(storage): [MEMORY CORE ONLINE] 数据存档协议已激活'},
          {id:'c',text:'feat(storage): [STORAGE READY] 建立 SQLite 持久化基础'}
        ]
      })
    })
    await refresh();open(result.id)
    flash.value='DEMO REQUEST CREATED'
  } catch(e){error.value=(e as Error).message}finally{busy.value=false}
}
watch(activeId,()=>{picked.value=null;edited.value='';flash.value=''})
watch(picked,()=>{edited.value=''})
function onHashChange(){ const id=currentHash();if(id && items.value.some(d=>d.id===id))activeId.value=id }
onMounted(()=>{window.addEventListener('hashchange',onHashChange);if(token.value)startSession()})
onUnmounted(()=>{controller?.abort();if(reconnectTimer)clearTimeout(reconnectTimer);window.removeEventListener('hashchange',onHashChange)})
const label=(status:DecisionStatus)=>({pending:'AWAITING',confirmed:'CONFIRMED',cancelled:'CANCELLED',expired:'EXPIRED'}[status])
const fmt=(iso:string)=>new Date(iso).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})
</script>

<template>
  <div v-if="!token" class="gate">
    <div class="gate-grid"></div>
    <section class="gate-panel">
      <div class="eyebrow"><span class="signal"></span> HUMAN / PICKER <span class="muted">// ACCESS GATE</span></div>
      <div class="gate-mark">H<span>·</span>P</div>
      <h1>HUMAN DECISION<br/><em>REQUIRED.</em></h1>
      <p>AI 可以提出选项。但最终选择，属于人类。</p>
      <form @submit.prevent="authenticate" class="gate-form">
        <label for="token">LOCAL ACCESS TOKEN</label>
        <input id="token" v-model="tokenDraft" type="password" placeholder="粘贴服务端打印的 Access Token" autocomplete="off" autofocus/>
        <button class="primary" type="submit">CONNECT TO SERVER <span>↗</span></button>
      </form>
      <footer>WEB-FIRST <span>◆</span> LOCAL-FIRST <span>◆</span> HUMAN-IN-THE-LOOP</footer>
    </section>
  </div>

  <div v-else class="shell">
    <aside class="sidebar">
      <div class="brand"><div class="brand-icon">H<span>P</span></div><div><strong>human-picker</strong><small>DECISION INFRASTRUCTURE</small></div></div>
      <div class="side-label">WORKSPACE / 01</div>
      <button class="nav" :class="{active:filter==='pending'}" @click="filter='pending'">◈ &nbsp; Inbox <span>{{pendingCount.toString().padStart(2,'0')}}</span></button>
      <button class="nav" :class="{active:filter==='all'}" @click="filter='all'">▧ &nbsp; All decisions <span>{{items.length.toString().padStart(2,'0')}}</span></button>
      <div class="side-label second-label">TRANSPORT / 02</div>
      <div class="source"><span class="signal"></span> REST API <small>READY</small></div>
      <div class="source"><span class="signal"></span> MCP SERVER <small>READY</small></div>
      <div class="source"><span class="signal"></span> LIVE EVENTS <small>READY</small></div>
      <div class="sidebar-bottom"><div>HUMAN AUTHORITY</div><strong>MAXIMUM</strong><button @click="signOut">↪ &nbsp; Disconnect</button></div>
    </aside>

    <main class="workspace">
      <header class="topbar"><span>HUMAN PICKER <b>/</b> DECISIONS</span><span class="topright"><i class="signal"></i> {{ synced ? 'CONNECTED' : 'RECONNECTING' }} <span class="top-sep">|</span> V0.1</span></header>
      <div class="heading"><div class="section-id">01 / DECISION INBOX</div><h1>Human judgment.<br/><em>Machine velocity.</em></h1><p>Agents propose options. You make the call. Work continues.</p></div>
      <div class="metrics">
        <div><small>AWAITING DECISIONS</small><strong>{{pendingCount.toString().padStart(2,'0')}}</strong><span>Waiting for your input</span></div>
        <div><small>CONFIRMED</small><strong>{{completeCount.toString().padStart(2,'0')}}</strong><span>Human-approved outputs</span></div>
        <div><small>TOTAL REQUESTS</small><strong>{{items.length.toString().padStart(2,'0')}}</strong><span>Persisted to local SQLite</span></div>
      </div>
      <div class="inbox-heading"><div><span class="section-id">REQUEST QUEUE</span><h2>{{filter==='pending'?'Pending decisions':'Decision history'}}</h2></div><button class="ghost" :disabled="busy" @click="createDemo">+ &nbsp; Create demo request</button></div>
      <div v-if="error" class="error">[ ERROR ] {{error}}</div>
      <div v-if="flash" class="success">[ SYSTEM ] {{flash}}</div>
      <div v-if="visible.length" class="request-list">
        <button v-for="item in visible" :key="item.id" class="request" :class="{chosen:activeId===item.id}" @click="open(item.id)">
          <div class="request-icon">{{item.type==='text'?'T':'?'}}</div>
          <div class="request-copy"><strong>{{item.title}}</strong><small>{{item.context.project||item.source}} <span>·</span> {{item.options.length}} options</small></div>
          <div class="request-status" :class="item.status">{{label(item.status)}}<small>{{fmt(item.created_at)}}</small></div>
          <div class="chevron">↗</div>
        </button>
      </div>
      <div v-else class="empty"><div>◇</div><strong>ALL CLEAR</strong><p>当前没有{{filter==='pending'?'待处理':'已存储'}}决策。<br/>Agent 创建请求后，这里将自动更新。</p></div>
      <div class="footer-text">HUMAN PICKER / THE FINAL DECISION IS YOURS.</div>
    </main>

    <section class="detail">
      <template v-if="active">
        <div class="detail-head"><span>DECISION DETAIL</span><span>#{{active.id.slice(0,8)}}</span></div>
        <div class="detail-body">
          <div class="detail-meta">{{active.type.toUpperCase()}} PICKER <span>/</span> {{label(active.status)}}</div>
          <h2>{{active.title}}</h2>
          <div class="detail-context"><span>CONTEXT</span><p>{{active.context.summary||'尚未提供上下文。'}}</p><small>{{active.source}} / {{active.context.project||'Unknown project'}}</small></div>
          <div class="detail-options-header"><span>SELECT ONE</span><small>{{active.options.length}} CANDIDATES</small></div>
          <div class="options">
            <button v-for="(option,index) in active.options" :key="option.id" class="option" :class="{picked:picked===option.id,locked:active.status!=='pending'}" :disabled="active.status!=='pending'" @click="picked=option.id">
              <span class="option-index">{{String(index+1).padStart(2,'0')}}</span>
              <span class="option-text">{{option.text}}</span>
              <span class="option-mark">{{picked===option.id?'●':'○'}}</span>
            </button>
          </div>
          <template v-if="active.status==='pending'">
            <label class="edit-label">OPTIONAL EDIT <span>— YOUR WORDS</span></label>
            <textarea v-model="edited" :disabled="!picked" rows="3" placeholder="选择候选后，可在这里修改最终文字"></textarea>
            <button class="primary confirm" :disabled="!canSubmit||busy" @click="confirm">CONFIRM SELECTION <span>↗</span></button>
            <div class="secondary-actions"><button :disabled="busy" @click="cancelDecision">Cancel request</button><button :disabled="!canSubmit" @click="copyResult">Copy draft</button></div>
          </template>
          <template v-else>
            <div class="resolved"><strong>{{label(active.status)}}</strong><p v-if="active.selection">{{active.selection.text}}</p><p v-else>没有产生选择结果。</p></div>
            <button v-if="active.selection" class="primary confirm" @click="copyResult">COPY RESULT ↗</button>
          </template>
        </div>
      </template>
      <div v-else class="detail-empty"><div class="orbit">◇</div><span>NO ACTIVE DECISION</span><p>从左侧选择一个请求以继续。</p></div>
    </section>
  </div>
</template>
