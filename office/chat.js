// Office chat: relays messages from the web panel to Claude Code (`claude -p`)
// and streams replies back. Follow-ups reuse the same Claude session via
// --resume, so the conversation keeps its context. Messages sent while Claude
// is busy are queued and run in order. History lives in .office/chat.json so it
// survives page reloads and server restarts until "New chat" is pressed.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

// Variables that would make the child think it is part of the parent's
// Claude Code session (only present when the server is started from inside one).
const SESSION_ENV = ['CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_REMOTE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_PID', 'CLAUDE_CODE_ENTRYPOINT'];
const MAX_MESSAGES = 500;

const DEFAULTS = {
  command: 'claude',
  permissionMode: 'acceptEdits',
  allowedTools: ['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite'],
  maxTurns: 40,
  systemPrompt: 'The user is talking to you from the chat panel of the AI Marketing Office web page. Keep replies concise and skimmable, and name every file you create or change.',
};

class Chat {
  constructor({ root, stateFile, broadcast, getConfig, describeTool }) {
    this.root = root;
    this.stateFile = stateFile;
    this.broadcast = broadcast;
    this.getConfig = getConfig;
    this.describeTool = describeTool;
    this.queue = [];
    this.proc = null;
    this.current = null; // { userMsg, assistantMsg }
    this.state = this.load();
  }

  settings() {
    const c = (this.getConfig() || {}).chat || {};
    return { ...DEFAULTS, ...c, command: process.env.OFFICE_CLAUDE_BIN || c.command || DEFAULTS.command };
  }

  load() {
    try {
      const s = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      for (const m of s.messages || []) {
        if (m.status === 'running' || m.status === 'queued') m.status = 'interrupted';
      }
      return { sessionId: s.sessionId || null, messages: s.messages || [] };
    } catch (_) {
      return { sessionId: null, messages: [] };
    }
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      const tmp = this.stateFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.state));
      fs.renameSync(tmp, this.stateFile);
    }, 200);
  }

  snapshot() {
    return { messages: this.state.messages, busy: !!this.proc, queued: this.queue.length, sessionId: this.state.sessionId };
  }

  emitState() { this.broadcast('chat-state', { busy: !!this.proc, queued: this.queue.length, sessionId: this.state.sessionId }); }

  add(msg) {
    const m = { id: crypto.randomUUID(), ts: Date.now(), ...msg };
    this.state.messages.push(m);
    if (this.state.messages.length > MAX_MESSAGES) this.state.messages.splice(0, this.state.messages.length - MAX_MESSAGES);
    this.broadcast('chat', m);
    this.save();
    return m;
  }

  update(m, fields) {
    Object.assign(m, fields);
    this.broadcast('chat', m);
    this.save();
  }

  send(text) {
    const userMsg = this.add({ role: 'user', text, status: this.proc ? 'queued' : 'sent' });
    this.queue.push(userMsg);
    if (!this.proc) this.runNext();
    else this.emitState();
    return userMsg;
  }

  stop() {
    for (const m of this.queue) this.update(m, { status: 'cancelled' });
    this.queue = [];
    if (this.proc) {
      this.stopping = true;
      this.proc.kill('SIGINT');
      const p = this.proc;
      setTimeout(() => { if (this.proc === p) p.kill('SIGKILL'); }, 4000);
    }
    this.emitState();
  }

  reset() {
    this.stop();
    this.current = null;
    this.proc = null;
    this.state = { sessionId: null, messages: [] };
    this.save();
    this.broadcast('chat-reset', this.snapshot());
  }

  runNext() {
    const userMsg = this.queue.shift();
    if (!userMsg) { this.emitState(); return; }
    const s = this.settings();
    const args = ['-p', '--output-format', 'stream-json', '--verbose',
      '--permission-mode', s.permissionMode, '--max-turns', String(s.maxTurns)];
    if (s.allowedTools && s.allowedTools.length) args.push('--allowedTools', s.allowedTools.join(','));
    if (s.systemPrompt) args.push('--append-system-prompt', s.systemPrompt);
    if (this.state.sessionId && /^[0-9a-f-]{36}$/i.test(this.state.sessionId)) args.push('--resume', this.state.sessionId);

    const env = { ...process.env };
    for (const k of SESSION_ENV) delete env[k];
    // Tools installed by Homebrew, the Claude Code installer or by hand (e.g. ffmpeg) live here;
    // make sure Claude can find them even if the office was started from a shell without them on PATH.
    if (process.platform !== 'win32') {
      const home = process.env.HOME || '';
      const extra = [path.join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin'];
      const parts = (env.PATH || '').split(':');
      env.PATH = [...parts, ...extra.filter((d) => !parts.includes(d))].join(':');
    }

    this.update(userMsg, { status: 'sent' });
    const assistantMsg = this.add({ role: 'assistant', text: '', status: 'running', tools: [] });
    const run = { userMsg, assistantMsg };
    this.current = run;
    this.stopping = false;

    let proc;
    const win = process.platform === 'win32';
    try {
      // On Windows `claude` is a .cmd shim, which needs a shell; quote args for cmd.exe.
      proc = win
        ? spawn([s.command, ...args.map((a) => `"${a.replace(/"/g, '\\"')}"`)].join(' '), { cwd: this.root, env, shell: true })
        : spawn(s.command, args, { cwd: this.root, env });
    } catch (e) {
      return this.finish(run, `Could not start Claude Code (${e.message}).`, true);
    }
    this.proc = proc;
    this.emitState();

    proc.stdin.on('error', () => {});
    proc.stdin.end(userMsg.text); // prompt goes through stdin: no shell quoting issues

    let buf = '';
    let stderr = '';
    let finalText = null;
    let isError = false;
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line); } catch (_) { continue; }
        if (ev.session_id && ev.type === 'system' && ev.subtype === 'init') this.state.sessionId = ev.session_id;
        if (ev.type === 'assistant' && ev.message && !ev.parent_tool_use_id) {
          for (const block of ev.message.content || []) {
            if (block.type === 'text' && block.text.trim()) {
              const text = assistantMsg.text ? assistantMsg.text + '\n\n' + block.text : block.text;
              this.update(assistantMsg, { text });
            } else if (block.type === 'tool_use') {
              assistantMsg.tools.push(this.describeTool(block.name, block.input || {}));
              this.update(assistantMsg, {});
            }
          }
        }
        if (ev.type === 'result') {
          if (ev.session_id) this.state.sessionId = ev.session_id;
          isError = !!ev.is_error;
          finalText = typeof ev.result === 'string' ? ev.result : null;
          if (isError && !finalText) finalText = `Claude stopped: ${ev.subtype || 'error'}`;
        }
      }
    });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (c) => { stderr = (stderr + c).slice(-2000); });
    proc.on('error', (e) => {
      const hint = e.code === 'ENOENT' ? ' Is Claude Code installed and on your PATH? (npm i -g @anthropic-ai/claude-code)' : '';
      this.finish(run, `Could not start Claude Code: ${e.message}.${hint}`, true);
    });
    proc.on('close', (code) => {
      if (this.stopping) return this.finish(run, 'Stopped by you.', false, 'stopped');
      if (finalText != null) return this.finish(run, finalText, isError);
      this.finish(run, code === 0 ? '' : `Claude Code exited with code ${code}. ${stderr.trim().split('\n').slice(-3).join(' ')}`, code !== 0);
    });
  }

  finish(run, text, isError, status) {
    if (this.current !== run) return; // already finished, or chat was reset
    const { assistantMsg } = run;
    this.current = null;
    this.proc = null;
    // The final result usually repeats the last text block; only add what's new.
    let body = assistantMsg.text;
    if (text && !(body && body.trim().endsWith(text.trim()))) body = body ? `${body}\n\n${text}` : text;
    this.update(assistantMsg, { text: body || '(no reply)', status: status || (isError ? 'error' : 'done') });
    this.save();
    this.runNext();
  }
}

module.exports = { Chat };
