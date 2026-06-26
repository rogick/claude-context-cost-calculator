#!/usr/bin/env node
// Conta tokens reais via API Anthropic e compara custo entre modelos Claude.
// Zero dependencias — usa fetch nativo (Node 18+).
//
// Uso:
//   node token_cost_calc.mjs (ARQUIVO|TEXTO) [--system F|TEXTO]
//        [--output 700] [--var-input 100] [--requests 5] [--ttl 5m|1h]
//        [--context claude|claude-rgk|...] [--offline]
//
// Config (auth, endpoint, modelos) lida do contexto do Claude Code:
//   ~/.<context>/settings.json  (default context=claude). Tambem settings.local.json.
//   - auth:     env ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN > settings env.*
//   - endpoint: env ANTHROPIC_BASE_URL > settings env.ANTHROPIC_BASE_URL > oficial
//   - modelos:  settings availableModels[] > lista canonica embutida (fallback)
// Env vars sempre vencem o settings. Precos sao referencia embutida (nao ficam em settings).

import { readFileSync, existsSync, statSync } from "node:fs";
import { parseArgs } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";

// Resolve input: se for caminho de arquivo existente, le o arquivo;
// senao, trata como texto literal colado no comando.
function resolveText(input) {
  if (existsSync(input) && statSync(input).isFile()) {
    return { text: readFileSync(input, "utf-8"), source: `arquivo ${input}` };
  }
  return { text: input, source: "texto inline" };
}

const DEFAULT_BASE = "https://api.anthropic.com";

// Lista canonica de fallback — usada so quando o contexto nao tem availableModels.
const FALLBACK_MODELS = [
  "claude-fable-5",
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
];

// Preco por 1M tokens, por FAMILIA: [input, output, cacheWrite5m, cacheWrite1h, cacheRead].
// Referencia embutida (nao consta em settings). Versao nova da familia herda o preco.
const PRICING = {
  fable:  [10.0, 50.0, 12.50, 20.0, 1.00],
  opus:   [5.0,  25.0, 6.25,  10.0, 0.50],
  sonnet: [3.0,  15.0, 3.75,  6.0,  0.30],
  haiku:  [1.0,  5.0,  1.25,  2.0,  0.10],
};

// Prefixo minimo cacheavel (tokens) por familia. Abaixo disso, cache falha silencioso.
const MIN_CACHE = { fable: 2048, opus: 4096, sonnet: 2048, haiku: 4096 };

// Identifica a familia a partir de qualquer ID (canonico ou com prefixo de proxy).
function familyOf(id) {
  const s = id.toLowerCase();
  if (s.includes("fable"))  return "fable";
  if (s.includes("opus"))   return "opus";
  if (s.includes("sonnet")) return "sonnet";
  if (s.includes("haiku"))  return "haiku";
  return null; // desconhecido: conta tokens mas sem preco
}

// Le e mescla settings.json + settings.local.json do contexto escolhido.
// context "claude" (default) -> ~/.claude ; "claude-rgk" -> ~/.claude-rgk ; etc.
function loadContext(contextName) {
  const name = contextName || "claude";
  const dir = join(homedir(), "." + name);
  const files = [join(dir, "settings.json"), join(dir, "settings.local.json")];
  let settings = {}, env = {};
  for (const f of files) {
    try {
      if (existsSync(f)) {
        const j = JSON.parse(readFileSync(f, "utf-8"));
        settings = { ...settings, ...j };
        if (j.env) env = { ...env, ...j.env };
      }
    } catch { /* settings malformado — ignora */ }
  }
  return { name, dir, settings, env };
}

// Resolve credencial: env vence settings. API key usa x-api-key; auth token usa Bearer.
function resolveAuth(ctx) {
  const e = ctx.env;
  const apiKey  = process.env.ANTHROPIC_API_KEY   || e.ANTHROPIC_API_KEY;
  const authTok = process.env.ANTHROPIC_AUTH_TOKEN || e.ANTHROPIC_AUTH_TOKEN;
  const baseUrl = (process.env.ANTHROPIC_BASE_URL || e.ANTHROPIC_BASE_URL || DEFAULT_BASE)
                    .replace(/\/+$/, "");

  if (apiKey)  return { kind: "api-key (x-api-key)", header: "x-api-key", value: apiKey, baseUrl };
  if (authTok) return { kind: "auth-token (Bearer)", header: "authorization", value: `Bearer ${authTok}`, baseUrl };
  return null;
}

// Modelos a avaliar: availableModels do contexto, senao fallback canonico.
function resolveModels(ctx) {
  const am = ctx.settings.availableModels;
  if (Array.isArray(am) && am.length) return { models: am, source: "availableModels (settings)" };
  return { models: FALLBACK_MODELS, source: "lista canonica (fallback)" };
}

// Estimativa offline: ~3.5 char/token. Familia fable conta ~30% mais (tokenizer novo).
// Grosseira — so pra testar a tabela sem chave. Use count_tokens p/ numero real.
const CHARS_PER_TOKEN = 3.5;
function estimateTokens(family, system, prompt) {
  const chars = (system ? system.length : 0) + prompt.length;
  const base = Math.ceil(chars / CHARS_PER_TOKEN);
  return family === "fable" ? Math.ceil(base * 1.3) : base;
}

async function countTokens(auth, model, system, prompt) {
  const body = { model, messages: [{ role: "user", content: prompt }] };
  if (system) body.system = system;

  const res = await fetch(`${auth.baseUrl}/v1/messages/count_tokens`, {
    method: "POST",
    headers: {
      [auth.header]: auth.value,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt}`);
  }
  return (await res.json()).input_tokens;
}

function cost(family, prefix, varIn, out, n, ttl) {
  const [pIn, pOut, pCw5, pCw1h, pCr] = PRICING[family];
  const pCw = ttl === "1h" ? pCw1h : pCw5;

  // Sem cache: todo request reprocessa prefixo + variavel a preco cheio
  const noCache = (n * ((prefix + varIn) * pIn + out * pOut)) / 1e6;

  // Com cache: req1 escreve prefixo, req2..N leem
  const req1 = (prefix * pCw + varIn * pIn + out * pOut) / 1e6;
  const rest = ((n - 1) * (prefix * pCr + varIn * pIn + out * pOut)) / 1e6;
  const cached = req1 + rest;

  return { noCache, cached, cacheable: prefix >= MIN_CACHE[family] };
}

const pad = (s, w) => String(s).padStart(w);
const padR = (s, w) => String(s).padEnd(w);
// Rotulo legivel: remove prefixo de proxy p/ caber na coluna.
const label = (id) => id.replace(/^global\.anthropic\./, "");

export async function calculateCosts({ rawInput, systemStr, out = 700, varIn = 100, n = 5, ttl = "5m", context, offline = false }) {
  const ctx = loadContext(context);
  const auth = offline ? null : resolveAuth(ctx);
  if (!auth && !offline) {
    throw new Error(`erro: credencial nao encontrada (context=${ctx.name}, dir=${ctx.dir}). defina ANTHROPIC_API_KEY ou ANTHROPIC_AUTH_TOKEN`);
  }

  const { models, source: modelSrc } = resolveModels(ctx);
  const { text: prompt, source: promptSrc } = resolveText(rawInput);
  const sys = systemStr ? resolveText(systemStr) : null;
  const system = sys ? sys.text : null;
  out = Number(out);
  varIn = Number(varIn);
  n = Number(n);

  const results = [];
  for (const id of models) {
    const name = label(id);
    const family = familyOf(id);
    if (!family) {
      results.push({ id, name, family: null, error: "familia desconhecida" });
      continue;
    }

    let prefix;
    let error = null;
    if (offline) {
      prefix = estimateTokens(family, system, prompt);
    } else {
      try {
        prefix = await countTokens(auth, id, system, prompt);
      } catch (e) {
        error = e.message;
      }
    }

    if (error) {
      results.push({ id, name, family, error });
      continue;
    }

    const { noCache, cached, cacheable } = cost(family, prefix, varIn, out, n, ttl);
    const save = noCache ? (1 - cached / noCache) * 100 : 0;
    
    results.push({ id, name, family, prefix, noCache, cached, cacheable, save });
  }

  return {
    mode: offline ? "OFFLINE" : `API auth=${auth.kind} endpoint=${auth.baseUrl}`,
    context: ctx.name,
    dir: ctx.dir,
    modelSrc,
    promptSrc,
    sysSource: sys ? sys.source : null,
    requests: n,
    output: out,
    varInput: varIn,
    ttl,
    results
  };
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      text:       { type: "string" },
      system:     { type: "string" },
      output:     { type: "string", default: "700" },
      "var-input":{ type: "string", default: "100" },
      requests:   { type: "string", default: "5" },
      ttl:        { type: "string", default: "5m" },
      context:    { type: "string" },
      offline:    { type: "boolean", default: false },
    },
  });

  const rawInput = values.text ?? positionals[0];
  if (!rawInput) {
    console.error("uso: node token_cost_calc.mjs (ARQUIVO|TEXTO) [--system F|TEXTO]");
    console.error("       [--output N] [--requests N] [--ttl 5m|1h] [--context NOME] [--offline]");
    console.error('exemplos:');
    console.error('  node token_cost_calc.mjs prompt.txt --offline');
    console.error('  node token_cost_calc.mjs "meu prompt colado aqui"');
    console.error('  node token_cost_calc.mjs --text "meu prompt" --context claude-rgk');
    process.exit(1);
  }

  let data;
  try {
    data = await calculateCosts({
      rawInput,
      systemStr: values.system,
      out: values.output,
      varIn: values["var-input"],
      n: values.requests,
      ttl: values.ttl,
      context: values.context,
      offline: values.offline
    });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const { mode, context, dir, modelSrc, promptSrc, sysSource, requests, output, varInput, ttl, results } = data;
  
  console.log(`modo=${mode}`);
  console.log(`context=${context}  dir=${dir}`);
  console.log(`modelos=${modelSrc}`);
  console.log(`input=${promptSrc}${sysSource ? `  system=${sysSource}` : ""}`);
  console.log(`requests=${requests}  output=${output}/req  var_input=${varInput}/req  ttl=${ttl}\n`);

  const W = 34;
  const header = padR("modelo", W) + pad("tokens", 9) + pad("sem cache", 12) +
                 pad("com cache", 12) + pad("economia", 10) + pad("cacheia?", 9);
  console.log(header);
  console.log("-".repeat(header.length));

  for (const r of results) {
    if (!r.family) {
      console.log(`${padR(r.name, W)}  familia desconhecida (sem tabela de preco) — pulado`);
      continue;
    }
    if (r.error) {
      console.log(`${padR(r.name, W)}  erro: ${r.error}`);
      continue;
    }
    console.log(
      padR(r.name, W) +
      pad(r.prefix.toLocaleString("en-US"), 9) +
      pad("$" + r.noCache.toFixed(3), 12) +
      pad("$" + r.cached.toFixed(3), 12) +
      pad(r.save.toFixed(0) + "%", 10) +
      pad(r.cacheable ? "sim" : "NAO", 9)
    );
  }

  const fonte = values.offline
    ? "estimado (~3.5 char/token, GROSSEIRO — use sem --offline p/ exato)"
    : "contado por count_tokens (exato, por-modelo)";
  console.log(`\nNota: 'tokens' = prefixo fixo ${fonte}. ` +
              "Familia fable conta mais (~30%) pelo tokenizer novo.");
}

// Executar main somente se for chamado diretamente pelo CLI
if (process.argv[1] && (process.argv[1] === new URL(import.meta.url).pathname || process.argv[1].endsWith('token_cost_calc.mjs'))) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
