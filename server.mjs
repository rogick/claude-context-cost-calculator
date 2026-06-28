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

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

async function handleApiCalculate(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });
  req.on('end', async () => {
    try {
      const data = JSON.parse(body);
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
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: results }));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: error.message }));
    }
  });
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

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, files }));
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: error.message }));
  }
}

// --- Session Analysis Endpoints ---

function handleSessionsProjects(req, res, url) {
  try {
    const claudeDir = url.searchParams.get('claudeDir');
    const projects = listProjects(claudeDir);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, projects }));
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: error.message }));
  }
}

function handleSessionsList(req, res, url) {
  try {
    const projectId = url.searchParams.get('project');
    const claudeDir = url.searchParams.get('claudeDir');
    if (!projectId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Parâmetro "project" é obrigatório' }));
      return;
    }
    const sessions = listSessions(projectId, claudeDir);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, sessions }));
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: error.message }));
  }
}

function handleSessionsAnalyze(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });
  req.on('end', () => {
    try {
      const { project, sessionId, claudeDir } = JSON.parse(body);
      if (!project || !sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'project e sessionId são obrigatórios' }));
        return;
      }
      const analysis = analyzeSession(project, sessionId, claudeDir);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: analysis }));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: error.message }));
    }
  });
}

function handleSessionsReport(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });
  req.on('end', () => {
    try {
      const { project, sessionId, projectName, claudeDir } = JSON.parse(body);
      if (!project || !sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'project e sessionId são obrigatórios' }));
        return;
      }
      const analysis = analyzeSession(project, sessionId, claudeDir);
      const report = generateReport(analysis, projectName);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, report }));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: error.message }));
    }
  });
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
  let reqPath = pathname === '/' ? '/index.html' : pathname;
  // Prevent path traversal
  reqPath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
  
  const filePath = path.join(__dirname, 'public', reqPath);
  const extname = String(path.extname(filePath)).toLowerCase();
  const contentType = MIME_TYPES[extname] || 'application/octet-stream';

  try {
    const stat = await fs.stat(filePath);
    if (stat.isFile()) {
      res.writeHead(200, { 'Content-Type': contentType });
      createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  } catch (err) {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`\n==============================================`);
  console.log(`🚀 Servidor visual rodando em: http://localhost:${PORT}`);
  console.log(`==============================================\n`);
});
