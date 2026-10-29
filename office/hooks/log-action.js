#!/usr/bin/env node
// Claude Code hook: appends ONE line per event to .office/activity.log.
// Privacy contract: we record only the event, the tool name, the file name
// being touched, the sub-agent role acting (e.g. "researcher"), and (for side
// effects outside this folder) a short category label such as "git-push".
// File contents, command text, and prompts are read from stdin only to derive
// those fields and are never written anywhere.
// Reliability contract: never print to stdout, never block, always exit 0.
'use strict';
const fs = require('fs');
const path = require('path');

const MAX_LOG_BYTES = 5 * 1024 * 1024;

function done() { process.exit(0); }
setTimeout(done, 1500).unref(); // hard stop no matter what

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => { try { handle(JSON.parse(raw)); } catch (_) {} done(); });
process.stdin.on('error', done);

function handle(input) {
  const project = path.resolve(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
  const event = input.hook_event_name;
  if (!['PreToolUse', 'Stop', 'UserPromptSubmit'].includes(event)) return;

  const entry = { ts: Date.now(), event };
  if (input.session_id) entry.session = String(input.session_id).slice(0, 8);
  if (typeof input.agent_type === 'string' && /^[\w-]{1,40}$/.test(input.agent_type)) entry.agent = input.agent_type; // sub-agent role name only

  if (event === 'PreToolUse') {
    const tool = String(input.tool_name || 'unknown');
    const ti = input.tool_input || {};
    entry.tool = tool;
    const target = ti.file_path || ti.notebook_path || ti.path;
    if (typeof target === 'string' && target) {
      const abs = path.resolve(project, target);
      const rel = path.relative(project, abs);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        entry.file = rel.split(path.sep).join('/');
      } else if (!rel) {
        entry.file = '.';
      } else {
        entry.file = path.basename(abs); // outside project: name only, no path
        entry.outside = true;
        if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool)) entry.flag = 'outside-project-write';
      }
    }
    const flag = classify(tool, ti);
    if (flag) entry.flag = flag;
  }

  const dir = path.join(project, '.office');
  const file = path.join(dir, 'activity.log');
  fs.mkdirSync(dir, { recursive: true });
  try {
    if (fs.statSync(file).size > MAX_LOG_BYTES) fs.renameSync(file, file + '.1');
  } catch (_) {}
  fs.appendFileSync(file, JSON.stringify(entry) + '\n');
}

// Returns a category label for actions with effects beyond this folder, or null.
// Only the label is stored; the command itself is discarded.
function classify(tool, ti) {
  if (tool === 'Bash' && typeof ti.command === 'string') {
    const c = ti.command;
    const rules = [
      ['git-push', /\bgit\s+push\b/],
      ['deploy', /\b(deploy|vercel|netlify|heroku|fly\s+(deploy|launch)|kubectl\s+(apply|rollout|delete)|terraform\s+(apply|destroy)|serverless|wrangler\s+publish|aws\s+s3\s+(cp|sync|rm))\b/i],
      ['publish', /\b(npm|yarn|pnpm)\s+publish\b|\btwine\s+upload\b/],
      ['send-email', /\b(sendmail|mailx?|mutt|swaks|smtp|sendgrid|mailgun|postmark)\b/i],
      ['http-write', /\bcurl\b[^|;&]*(-X\s*(POST|PUT|PATCH|DELETE)|--data\b|-d\s|-F\s|--form\b)|\bwget\b[^|;&]*--post/i],
      ['remote-shell', /\b(ssh|scp|rsync)\s/],
    ];
    for (const [label, re] of rules) if (re.test(c)) return label;
    return null;
  }
  if (tool.startsWith('mcp__')) {
    const action = tool.split('__').pop();
    if (/send|email|mail|message|post|publish|deploy|push|merge|create|update|delete|write|comment|trigger|upload/i.test(action)) {
      return /send|email|mail|message/i.test(action) ? 'send-message' : 'external-write';
    }
  }
  return null;
}
