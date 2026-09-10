import { test, expect } from "bun:test"
import { startAntigravityProcess } from "./antigravity-process"

const fake = `
const readline = require('node:readline');
const emit = x => console.log(JSON.stringify(x));
emit({event:'init',conversation_id:'c',init:{cwd:process.cwd(),model:'fake',tools:[],permission_mode:'request-review'}});
let turns=0;
readline.createInterface({input:process.stdin}).on('line',line=>{
 JSON.parse(line); turns++;
 emit({event:'step_update',step_update:{conversation_id:'c',step_index:turns,state:'DONE',step_type:'agent_response',text_delta:'hello'}});
 emit({event:'result',result:{conversation_id:'c',status:'SUCCESS',response:'hello',duration_seconds:turns,num_turns:turns,usage:{input_tokens:turns,output_tokens:turns,thinking_tokens:0,cache_read_tokens:0,total_tokens:turns*2}}});
});`

const start = (script = fake, timeoutMs = 5000) =>
  startAntigravityProcess({
    command: [process.execPath, "-e", script],
    cwd: process.cwd(),
    model: "fake",
    env: { PATH: process.env.PATH ?? "" },
    timeoutMs,
    onRecord: async () => {},
  })

test("official conversation stays alive across two turns and closes only on finish", async () => {
  const worker = start()
  try {
    expect((await worker.send("one")).num_turns).toBe(1)
    expect((await worker.send("two")).num_turns).toBe(2)
    worker.finish()
    expect((await worker.done).exitCode).toBe(0)
  } finally {
    worker.cancel()
    await worker.done.catch(() => {})
  }
})

test("malformed output stops the process", async () => {
  const worker = start("console.log('not-json'); setInterval(()=>{},1000)")
  await expect(worker.done).rejects.toThrow()
})

test("zero exit without a result never succeeds", async () => {
  const worker = start("setTimeout(()=>process.exit(0),50)")
  const turn = worker.send("hello")
  await expect(turn).rejects.toThrow()
  await expect(worker.done).rejects.toThrow()
})

test("cancellation and timeout terminate a worker ignoring TERM", async () => {
  const script = "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"
  const cancelled = start(script)
  cancelled.cancel()
  await expect(cancelled.done).rejects.toThrow("cancelled")
  const timed = start(script, 300)
  await expect(timed.done).rejects.toThrow("timed out")
})

test("ownership pipe kills the worker after abrupt DAX parent death", async () => {
  const modulePath = new URL("./antigravity-process.ts", import.meta.url).pathname
  const child = `console.log(JSON.stringify({event:'init',conversation_id:'c',init:{cwd:process.cwd(),model:'fake',tools:[String(process.pid)],permission_mode:'request-review'}})); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)`
  const parentScript = `import { startAntigravityProcess } from ${JSON.stringify(modulePath)};
    const worker = startAntigravityProcess({command:[${JSON.stringify(process.execPath)},'-e',${JSON.stringify(child)}],cwd:process.cwd(),model:'fake',env:{},timeoutMs:5000,onRecord:async r=>{if(r.event==='init')console.log(r.init.tools[0])}});
    worker.done.catch(()=>{});`
  const parent = Bun.spawn([process.execPath, "-e", parentScript], { stdout: "pipe", stderr: "pipe" })
  let pid: number | undefined
  try {
    const reader = parent.stdout.getReader()
    const first = await reader.read()
    pid = Number(new TextDecoder().decode(first.value).trim())
    expect(Number.isSafeInteger(pid) && pid > 1).toBe(true)
    parent.kill("SIGKILL")
    await parent.exited
    const alive = () => {
      try {
        process.kill(pid!, 0)
        return true
      } catch {
        return false
      }
    }
    for (let attempt = 0; attempt < 40 && alive(); attempt++) await Bun.sleep(50)
    expect(alive()).toBe(false)
  } finally {
    parent.kill("SIGKILL")
    if (pid && pid > 1) {
      try {
        process.kill(pid, "SIGKILL")
      } catch {}
    }
  }
})
