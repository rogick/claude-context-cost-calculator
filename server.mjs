#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';

import { calculateCosts } from './token_cost_calc.mjs';
import { listProjects, listSessions, analyzeSession, generateReport } from './session_analyzer.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Parse port from command line arguments or environment variable
let customPort = null;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--port' || args[i] === '-p') && args[i + 1]) {
    const val = parseInt(args[i + 1], 10);
    if (!isNaN(val)) {
      customPort = val;
    }
    break;
  }
}

const DEFAULT_PORT = 8675;
const PORT = customPort || process.env.PORT || DEFAULT_PORT;

// Bind only to loopback by default. This server exposes the local filesystem
// (file listing, file reads, ~/.claude session contents), so it must not be
// reachable from the network unless the operator explicitly opts in via HOST.
const HOST = process.env.HOST || '127.0.0.1';

// Limit request body size to avoid unbounded memory growth (DoS) from large POSTs.
const MAX_BODY_SIZE = 5 * 1024 * 1024; // 5 MB

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

// Reads and parses a JSON request body, enforcing a maximum size.
function readJsonBody(req, limit = MAX_BODY_SIZE) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('corpo da requisição excede o limite permitido'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('JSON inválido no corpo da requisição'));
      }
    });
    req.on('error', reject);
  });
}

async function handleApiCalculate(req, res) {
  let data;
  try {
    data = await readJsonBody(req);
  } catch (e) {
    return sendJson(res, 400, { success: false, error: e.message });
  }
  try {
    // Calls the refactored function
    const results = await calculateCosts({
      rawInput: data.rawInput,
      systemStr: data.systemStr,
      out: data.out,
      varIn: data.varIn,
      n: data.n,
      ttl: data.ttl,
      context: data.context,
      offline: data.offline
    });
    sendJson(res, 200, { success: true, data: results });
  } catch (error) {
    sendJson(res, 400, { success: false, error: error.message });
  }
}

async function handleApiFiles(req, res) {
  try {
    const cwd = process.cwd();
    const entries = await fs.readdir(cwd, { withFileTypes: true });
    
    const files = entries
      .filter(entry => !entry.name.startsWith('.') && entry.name !== 'node_modules')
      .map(entry => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        path: path.join(cwd, entry.name)
      }));

    sendJson(res, 200, { success: true, files });
  } catch (error) {
    sendJson(res, 500, { success: false, error: error.message });
  }
}

// --- Session Analysis Endpoints ---

function handleSessionsProjects(req, res, url) {
  try {
    const claudeDir = url.searchParams.get('claudeDir');
    const projects = listProjects(claudeDir);
    sendJson(res, 200, { success: true, projects });
  } catch (error) {
    sendJson(res, 500, { success: false, error: error.message });
  }
}

function handleSessionsList(req, res, url) {
  try {
    const projectId = url.searchParams.get('project');
    const claudeDir = url.searchParams.get('claudeDir');
    if (!projectId) {
      return sendJson(res, 400, { success: false, error: 'Parâmetro "project" é obrigatório' });
    }
    const sessions = listSessions(projectId, claudeDir);
    sendJson(res, 200, { success: true, sessions });
  } catch (error) {
    sendJson(res, 400, { success: false, error: error.message });
  }
}

async function handleSessionsAnalyze(req, res) {
  let data;
  try {
    data = await readJsonBody(req);
  } catch (e) {
    return sendJson(res, 400, { success: false, error: e.message });
  }
  try {
    const { project, sessionId, claudeDir } = data;
    if (!project || !sessionId) {
      return sendJson(res, 400, { success: false, error: 'project e sessionId são obrigatórios' });
    }
    const analysis = analyzeSession(project, sessionId, claudeDir);
    sendJson(res, 200, { success: true, data: analysis });
  } catch (error) {
    sendJson(res, 400, { success: false, error: error.message });
  }
}

async function handleSessionsReport(req, res) {
  let data;
  try {
    data = await readJsonBody(req);
  } catch (e) {
    return sendJson(res, 400, { success: false, error: e.message });
  }
  try {
    const { project, sessionId, projectName, claudeDir } = data;
    if (!project || !sessionId) {
      return sendJson(res, 400, { success: false, error: 'project e sessionId são obrigatórios' });
    }
    const analysis = analyzeSession(project, sessionId, claudeDir);
    const report = generateReport(analysis, projectName);
    sendJson(res, 200, { success: true, report });
  } catch (error) {
    sendJson(res, 400, { success: false, error: error.message });
  }
}

const server = http.createServer(async (req, res) => {
  console.log(`[${req.method}] ${req.url}`);

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === 'POST' && pathname === '/api/calculate') {
    return handleApiCalculate(req, res);
  }

  if (req.method === 'GET' && pathname === '/api/files') {
    return handleApiFiles(req, res);
  }

  // Session Analysis Endpoints
  if (req.method === 'GET' && pathname === '/api/sessions/projects') {
    return handleSessionsProjects(req, res, url);
  }

  if (req.method === 'GET' && pathname === '/api/sessions/list') {
    return handleSessionsList(req, res, url);
  }

  if (req.method === 'POST' && pathname === '/api/sessions/analyze') {
    return handleSessionsAnalyze(req, res);
  }

  if (req.method === 'POST' && pathname === '/api/sessions/report') {
    return handleSessionsReport(req, res);
  }

  // Serve static files
  const reqPath = pathname === '/' ? '/index.html' : pathname;
  const publicDir = path.join(__dirname, 'public');
  const filePath = path.join(publicDir, reqPath);

  // Defense-in-depth against path traversal: ensure the resolved path stays
  // inside the public directory regardless of how reqPath was crafted.
  const resolved = path.resolve(filePath);
  if (resolved !== publicDir && !resolved.startsWith(publicDir + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const extname = String(path.extname(resolved)).toLowerCase();
  const contentType = MIME_TYPES[extname] || 'application/octet-stream';

  try {
    const stat = await fs.stat(resolved);
    if (stat.isFile()) {
      res.writeHead(200, { 'Content-Type': contentType });
      createReadStream(resolved).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  } catch (err) {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n==============================================`);
  console.log(`🚀 Servidor visual rodando em: http://${HOST}:${PORT}`);
  console.log(`==============================================\n`);
});
