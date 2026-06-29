// session_analyzer.mjs
// Analisa sessões do Claude Code (JSONL em ~/.claude/projects/) para calcular
// custos reais por rodada, modelo e agente/subagente.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";

/**
 * Converte o caminho de configuração (ex: ~/.claude) no caminho completo de projetos.
 * Expande o caractere tilde (~) para a pasta home do usuário.
 */
function getProjectsDir(claudeConfigDir) {
  const configDir = claudeConfigDir || join(homedir(), ".claude");
  let resolvedDir = configDir;
  if (configDir.startsWith("~/")) {
    resolvedDir = join(homedir(), configDir.slice(2));
  } else if (configDir === "~") {
    resolvedDir = homedir();
  }
  return join(resolvedDir, "projects");
}

// Valida um segmento de caminho (id de projeto ou sessão) recebido do cliente.
// Bloqueia separadores e ".." para impedir directory traversal fora de projects/.
function assertSafeSegment(segment, label) {
  if (typeof segment !== "string" || segment.length === 0) {
    throw new Error(`${label} inválido`);
  }
  if (
    segment.includes("/") ||
    segment.includes("\\") ||
    segment.includes("\0") ||
    segment === "." ||
    segment === ".." ||
    segment.includes("..")
  ) {
    throw new Error(`${label} contém caracteres não permitidos`);
  }
}

// Preço por 1M tokens, por FAMILIA: [input, output, cacheWrite5m, cacheWrite1h, cacheRead].
const PRICING = {
  fable:  [10.0, 50.0, 12.50, 20.0, 1.00],
  opus:   [5.0,  25.0, 6.25,  10.0, 0.50],
  sonnet: [3.0,  15.0, 3.75,  6.0,  0.30],
  haiku:  [1.0,  5.0,  1.25,  2.0,  0.10],
};

function familyOf(modelId) {
  if (!modelId) return null;
  const s = modelId.toLowerCase();
  if (s.includes("fable"))  return "fable";
  if (s.includes("opus"))   return "opus";
  if (s.includes("sonnet")) return "sonnet";
  if (s.includes("haiku"))  return "haiku";
  return null;
}

/**
 * Calcula custo de uma única resposta assistant a partir de usage.
 */
function computeEntryCost(usage, model) {
  const family = familyOf(model);
  if (!family || !PRICING[family]) return 0;

  const [pIn, pOut, pCw5, _pCw1h, pCr] = PRICING[family];

  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  const cacheWriteTokens = usage.cache_creation_input_tokens || 0;
  const cacheReadTokens = usage.cache_read_input_tokens || 0;

  const cost =
    (inputTokens * pIn +
     cacheWriteTokens * pCw5 +
     cacheReadTokens * pCr +
     outputTokens * pOut) / 1e6;

  return cost;
}

/**
 * Lista projetos disponíveis em ~/.claude/projects/
 */
export function listProjects(claudeDir) {
  const dir = getProjectsDir(claudeDir);
  if (!existsSync(dir)) return [];

  return readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const projectPath = join(dir, d.name);
      const sessions = readdirSync(projectPath)
        .filter(f => f.endsWith(".jsonl"));
      // Converte o nome de diretório de volta para o path legível
      const readableName = d.name.replace(/^-/, "/").replace(/-/g, "/");
      return {
        id: d.name,
        name: readableName,
        path: projectPath,
        sessionCount: sessions.length,
      };
    })
    .filter(p => p.sessionCount > 0);
}

/**
 * Lista sessões de um projeto específico.
 */
export function listSessions(projectId, claudeDir) {
  assertSafeSegment(projectId, "project");
  const dir = getProjectsDir(claudeDir);
  const projectPath = join(dir, projectId);
  if (!existsSync(projectPath)) return [];

  const files = readdirSync(projectPath).filter(f => f.endsWith(".jsonl"));

  return files.map(f => {
    const filePath = join(projectPath, f);
    const sessionId = basename(f, ".jsonl");
    const stat = statSync(filePath);

    let title = null;
    let firstTimestamp = null;
    let lastTimestamp = null;
    let model = null;

    try {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n").filter(l => l.trim());

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);

          if (entry.type === "ai-title" && entry.aiTitle) {
            title = entry.aiTitle;
          }

          if (entry.timestamp) {
            if (!firstTimestamp) firstTimestamp = entry.timestamp;
            lastTimestamp = entry.timestamp;
          }

          if (entry.type === "assistant" && entry.message?.model && !model) {
            model = entry.message.model;
          }
        } catch { /* linha malformada */ }
      }
    } catch { /* arquivo ilegível */ }

    return {
      sessionId,
      title: title || "Sem título",
      model: model || "desconhecido",
      firstTimestamp,
      lastTimestamp,
      fileSize: stat.size,
      filePath,
    };
  }).sort((a, b) => {
    if (a.lastTimestamp && b.lastTimestamp) {
      return b.lastTimestamp.localeCompare(a.lastTimestamp);
    }
    return 0;
  });
}

/**
 * Analisa uma sessão completa.
 */
export function analyzeSession(projectId, sessionId, claudeDir) {
  assertSafeSegment(projectId, "project");
  assertSafeSegment(sessionId, "sessionId");
  const dir = getProjectsDir(claudeDir);
  const filePath = join(dir, projectId, `${sessionId}.jsonl`);

  if (!existsSync(filePath)) {
    throw new Error(`Sessão não encontrada: ${filePath}`);
  }

  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter(l => l.trim());

  let sessionTitle = null;
  const entries = [];

  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch { /* ignora linhas malformadas */ }
  }

  for (const e of entries) {
    if (e.type === "ai-title" && e.aiTitle) {
      sessionTitle = e.aiTitle;
    }
  }

  // Agrupar em rodadas (turns)
  const turns = [];
  let currentTurn = {
    turnIndex: 0,
    prompt: "Inicialização / Hooks de Entrada",
    timestamp: null,
    assistantEntries: [],
    attachments: [],
    toolCalls: [],
    steps: [],
    startupAttachments: [],
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheWriteTokens: 0,
    totalCacheReadTokens: 0,
    models: new Set(),
    hasSidechain: false,
  };

  for (const e of entries) {
    if (e.type === "user" && e.message?.role === "user") {
      let promptText = "";
      if (Array.isArray(e.message.content)) {
        for (const c of e.message.content) {
          if (c.type === "text" && c.text && !c.text.startsWith("<ide_")) {
            promptText += c.text + " ";
          }
        }
      } else if (typeof e.message.content === "string") {
        promptText = e.message.content;
      }

      const isToolResult = Array.isArray(e.message.content) &&
        e.message.content.every(c => c.type === "tool_result");

      if (!isToolResult && promptText.trim()) {
        if (currentTurn && (currentTurn.turnIndex > 0 || currentTurn.attachments.length > 0 || currentTurn.assistantEntries.length > 0)) {
          turns.push(currentTurn);
        }
        currentTurn = {
          turnIndex: turns.length + 1,
          prompt: promptText.trim(),
          timestamp: e.timestamp,
          assistantEntries: [],
          attachments: [],
          toolCalls: [],
          steps: [],
          startupAttachments: [],
          totalCost: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCacheWriteTokens: 0,
          totalCacheReadTokens: 0,
          models: new Set(),
          hasSidechain: false,
        };
      }
    }

    if (e.type === "attachment" && currentTurn) {
      const att = e.attachment;
      if (att) {
        let name = att.type || "unknown";
        let detail = "";
        let size = 0;
        let preview = "";

        if (att.type === "file") {
          name = `Leitura de arquivo: ${basename(att.filename || "")}`;
          detail = att.filename || "";
          if (att.content?.file?.content) {
            const c = att.content.file.content;
            size = c.length;
            preview = c.length > 500 ? c.slice(0, 500) + "\n... [truncado]" : c;
          }
        } else if (att.type === "hook_success" || att.type === "hook_failure") {
          name = `Hook: ${att.hookName || "unknown"}`;
          detail = att.command || "";
          if (att.content) {
            size = att.content.length;
            preview = att.content.length > 500 ? att.content.slice(0, 500) + "\n... [truncado]" : att.content;
          }
        } else if (att.type === "command") {
          name = `Comando: ${att.command || "unknown"}`;
          detail = att.stdout || "";
          const combined = (att.stdout || "") + (att.stderr || "");
          size = combined.length;
          preview = combined.length > 500 ? combined.slice(0, 500) + "\n... [truncado]" : combined;
        } else {
          const serialized = att.content ? JSON.stringify(att.content) : "";
          size = serialized.length;
          preview = serialized.length > 500 ? serialized.slice(0, 500) + "\n... [truncado]" : serialized;
          if (att.hookName) name = `Hook: ${att.hookName}`;
        }

        const item = {
          type: att.type || "unknown",
          name,
          detail,
          size,
          preview,
        };

        if (currentTurn.steps.length > 0) {
          currentTurn.steps[currentTurn.steps.length - 1].attachments.push(item);
        } else {
          currentTurn.startupAttachments.push(item);
        }

        currentTurn.attachments.push(item);
      }
    }

    if (e.type === "assistant" && currentTurn) {
      const stepIndex = currentTurn.steps.length + 1;
      const step = {
        stepIndex,
        model: e.message?.model || "unknown",
        thinking: "",
        toolCalls: [],
        attachments: [],
        usage: null,
        cost: 0,
        isSidechain: !!e.isSidechain,
        timestamp: e.timestamp
      };

      if (e.message?.content) {
        for (const block of e.message.content) {
          if (block.type === "thinking" && block.thinking) {
            step.thinking += block.thinking + "\n";
          } else if (block.type === "tool_use") {
            step.toolCalls.push({
              name: block.name,
              input: block.input || {},
            });
            currentTurn.toolCalls.push({
              name: block.name,
              input: block.input || {},
            });
          }
        }
        step.thinking = step.thinking.trim();
      }

      if (e.message?.usage) {
        const usage = e.message.usage;
        const model = e.message.model || "unknown";
        const cost = computeEntryCost(usage, model);
        const isSidechain = !!e.isSidechain;

        step.usage = {
          inputTokens: usage.input_tokens || 0,
          outputTokens: usage.output_tokens || 0,
          cacheWriteTokens: usage.cache_creation_input_tokens || 0,
          cacheReadTokens: usage.cache_read_input_tokens || 0,
        };
        step.cost = cost;

        currentTurn.assistantEntries.push({
          model,
          cost,
          inputTokens: usage.input_tokens || 0,
          outputTokens: usage.output_tokens || 0,
          cacheWriteTokens: usage.cache_creation_input_tokens || 0,
          cacheReadTokens: usage.cache_read_input_tokens || 0,
          isSidechain,
          timestamp: e.timestamp,
        });

        currentTurn.totalCost += cost;
        currentTurn.totalInputTokens += (usage.input_tokens || 0);
        currentTurn.totalOutputTokens += (usage.output_tokens || 0);
        currentTurn.totalCacheWriteTokens += (usage.cache_creation_input_tokens || 0);
        currentTurn.totalCacheReadTokens += (usage.cache_read_input_tokens || 0);
        currentTurn.models.add(model);
        if (isSidechain) currentTurn.hasSidechain = true;
      }

      currentTurn.steps.push(step);
    }
  }

  if (currentTurn && (currentTurn.turnIndex > 0 || currentTurn.attachments.length > 0 || currentTurn.assistantEntries.length > 0)) {
    turns.push(currentTurn);
  }

  for (const t of turns) {
    t.models = [...t.models];
  }

  // Agregar métricas globais
  let totalCost = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheWrite = 0;
  let totalCacheRead = 0;
  const modelBreakdown = {};
  let sidechainCost = 0;
  let mainCost = 0;
  let sidechainCount = 0;
  let mainCount = 0;

  for (const t of turns) {
    totalCost += t.totalCost;
    totalInput += t.totalInputTokens;
    totalOutput += t.totalOutputTokens;
    totalCacheWrite += t.totalCacheWriteTokens;
    totalCacheRead += t.totalCacheReadTokens;

    for (const a of t.assistantEntries) {
      if (!modelBreakdown[a.model]) {
        modelBreakdown[a.model] = {
          model: a.model,
          family: familyOf(a.model),
          cost: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheWriteTokens: 0,
          cacheReadTokens: 0,
          calls: 0,
        };
      }
      const mb = modelBreakdown[a.model];
      mb.cost += a.cost;
      mb.inputTokens += a.inputTokens;
      mb.outputTokens += a.outputTokens;
      mb.cacheWriteTokens += a.cacheWriteTokens;
      mb.cacheReadTokens += a.cacheReadTokens;
      mb.calls += 1;

      if (a.isSidechain) {
        sidechainCost += a.cost;
        sidechainCount++;
      } else {
        mainCost += a.cost;
        mainCount++;
      }
    }
  }

  const topTurns = [...turns]
    .sort((a, b) => b.totalCost - a.totalCost)
    .slice(0, 10);

  const totalCacheableInput = totalInput + totalCacheWrite + totalCacheRead;
  const cacheHitRate = totalCacheableInput > 0
    ? (totalCacheRead / totalCacheableInput) * 100
    : 0;

  const firstTs = turns.length > 0 ? turns[0].timestamp : null;
  const lastTs = turns.length > 0 ? turns[turns.length - 1].timestamp : null;

  return {
    sessionId,
    title: sessionTitle || "Sem título",
    firstTimestamp: firstTs,
    lastTimestamp: lastTs,
    summary: {
      totalCost,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalCacheWriteTokens: totalCacheWrite,
      totalCacheReadTokens: totalCacheRead,
      totalTurns: turns.length,
      avgCostPerTurn: turns.length > 0 ? totalCost / turns.length : 0,
      cacheHitRate,
      mainAgentCost: mainCost,
      mainAgentCalls: mainCount,
      subagentCost: sidechainCost,
      subagentCalls: sidechainCount,
    },
    modelBreakdown: Object.values(modelBreakdown).map(mb => ({
      ...mb,
      percentOfTotal: totalCost > 0 ? (mb.cost / totalCost) * 100 : 0,
    })),
    topTurns,
    turns,
  };
}

/**
 * Gera relatório Markdown otimizado para IA analisar e sugerir melhorias.
 */
export function generateReport(analysis, projectName) {
  const s = analysis.summary;
  const dur = analysis.firstTimestamp && analysis.lastTimestamp
    ? formatDuration(new Date(analysis.lastTimestamp) - new Date(analysis.firstTimestamp))
    : "N/A";

  const primaryModel = analysis.modelBreakdown.length > 0
    ? analysis.modelBreakdown.sort((a, b) => b.cost - a.cost)[0].model
    : "N/A";

  let md = `# Relatório de Consumo — Sessão Claude Code

## Contexto
- **Projeto:** ${projectName || "N/A"}
- **Sessão:** ${analysis.title}
- **Modelo principal:** ${primaryModel}
- **Duração:** ${dur}
- **Período:** ${fmtTs(analysis.firstTimestamp)} → ${fmtTs(analysis.lastTimestamp)}

## Métricas Resumo

| Métrica | Valor |
|---------|-------|
| Custo total | $${s.totalCost.toFixed(4)} |
| Tokens input (preço cheio) | ${s.totalInputTokens.toLocaleString("pt-BR")} |
| Tokens output | ${s.totalOutputTokens.toLocaleString("pt-BR")} |
| Tokens cache write | ${s.totalCacheWriteTokens.toLocaleString("pt-BR")} |
| Tokens cache read | ${s.totalCacheReadTokens.toLocaleString("pt-BR")} |
| Cache hit rate | ${s.cacheHitRate.toFixed(1)}% |
| Rodadas total | ${s.totalTurns} |
| Custo médio por rodada | $${s.avgCostPerTurn.toFixed(4)} |

## Breakdown por Modelo

| Modelo | Família | Chamadas | Input | Output | Cache Write | Cache Read | Custo | % Total |
|--------|---------|----------|-------|--------|-------------|------------|-------|---------|
`;

  for (const mb of analysis.modelBreakdown) {
    md += `| ${mb.model} | ${mb.family || "?"} | ${mb.calls} | ${mb.inputTokens.toLocaleString("pt-BR")} | ${mb.outputTokens.toLocaleString("pt-BR")} | ${mb.cacheWriteTokens.toLocaleString("pt-BR")} | ${mb.cacheReadTokens.toLocaleString("pt-BR")} | $${mb.cost.toFixed(4)} | ${mb.percentOfTotal.toFixed(1)}% |\n`;
  }

  md += `
## Uso de Agentes

| Tipo | Chamadas | Custo | % do Total |
|------|----------|-------|------------|
| Agente principal | ${s.mainAgentCalls} | $${s.mainAgentCost.toFixed(4)} | ${s.totalCost > 0 ? ((s.mainAgentCost / s.totalCost) * 100).toFixed(1) : 0}% |
| Subagentes | ${s.subagentCalls} | $${s.subagentCost.toFixed(4)} | ${s.totalCost > 0 ? ((s.subagentCost / s.totalCost) * 100).toFixed(1) : 0}% |

## Top ${Math.min(10, analysis.topTurns.length)} Rodadas Mais Caras

| # | Prompt (resumo) | Modelos | Tokens (total) | Custo | Subagente? |
|---|----------------|---------|----------------|-------|------------|
`;

  for (const t of analysis.topTurns) {
    const promptSnippet = t.prompt.slice(0, 80).replace(/\|/g, "\\|").replace(/\n/g, " ");
    const totalTokens = t.totalInputTokens + t.totalOutputTokens + t.totalCacheWriteTokens + t.totalCacheReadTokens;
    md += `| ${t.turnIndex} | ${promptSnippet}${t.prompt.length > 80 ? "..." : ""} | ${t.models.join(", ")} | ${totalTokens.toLocaleString("pt-BR")} | $${t.totalCost.toFixed(4)} | ${t.hasSidechain ? "Sim" : "Não"} |\n`;
  }

  md += `
## Dados por Rodada (todas)

| # | Prompt (resumo) | Input | Output | Cache W | Cache R | Custo |
|---|----------------|-------|--------|---------|---------|-------|
`;

  for (const t of analysis.turns) {
    const promptSnippet = t.prompt.slice(0, 60).replace(/\|/g, "\\|").replace(/\n/g, " ");
    md += `| ${t.turnIndex} | ${promptSnippet}${t.prompt.length > 60 ? "..." : ""} | ${t.totalInputTokens.toLocaleString("pt-BR")} | ${t.totalOutputTokens.toLocaleString("pt-BR")} | ${t.totalCacheWriteTokens.toLocaleString("pt-BR")} | ${t.totalCacheReadTokens.toLocaleString("pt-BR")} | $${t.totalCost.toFixed(4)} |\n`;
  }

  md += `
---

## Instruções para Análise por IA

Analise o relatório acima e forneça recomendações detalhadas sobre:

1. **Rodadas caras:** Identifique quais rodadas tiveram custo desproporcional. O que o usuário pode fazer diferente nos prompts para reduzir consumo?

2. **Oportunidades de cache:** Onde há prompts longos que não estão aproveitando cache? Há padrões de cache write sem reads subsequentes?

3. **Seleção de modelo:** O modelo atual é o mais adequado para as tarefas observadas? Em quais rodadas um modelo mais barato (ex: haiku em vez de sonnet) seria suficiente?

4. **Subagentes:** Se há uso de subagentes, os custos são justificados? Há oportunidades de consolidar chamadas?

5. **Padrões de uso:** Identifique padrões que desperdiçam tokens (prompts muito longos, muitas rodadas curtas, contexto acumulando).

6. **Estimativa de economia:** Calcule uma estimativa de quanto o usuário poderia economizar aplicando suas sugestões.
`;

  return md;
}

function formatDuration(ms) {
  if (ms < 0) ms = 0;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function fmtTs(ts) {
  if (!ts) return "N/A";
  try {
    return new Date(ts).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  } catch {
    return ts;
  }
}
