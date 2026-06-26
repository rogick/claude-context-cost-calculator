# Claude Token Cost Calculator

Uma ferramenta de linha de comando (CLI) em Node.js (sem dependências externas) para contar tokens reais usando a API da Anthropic e comparar custos de contexto, uso e *prompt-caching* entre diferentes famílias de modelos Claude (Fable, Opus, Sonnet e Haiku).

## Características

- **Zero Dependências:** Usa apenas recursos nativos do Node 18+ (como `fetch`).
- **Contagem Real de Tokens:** Faz requisições para o endpoint `count_tokens` da API da Anthropic para obter o número exato de tokens do prompt (sem processar uma resposta completa).
- **Análise de Custos e Cache:** Estima o custo de requisições com e sem *prompt caching*, permitindo avaliar a economia gerada por caches baseados em tempo (TTL).
- **Integração com o Claude Code:** Lê automaticamente configurações (como chave da API, endpoint e modelos disponíveis) a partir de contextos locais (ex: `~/.claude/settings.json` ou `~/.claude-rgk/settings.json`).
- **Modo Offline:** Estima a contagem de tokens de forma heurística (~3.5 chars/token) para simulações rápidas locais sem usar a chave de API.

## Pré-requisitos

- **Node.js:** Versão `>= 18.3.0` (para suporte à `fetch` API nativa).

## Instalação

Como não há dependências de pacotes de terceiros, o projeto está pronto para uso. Se quiser registrar como um comando global `claude-cost` (definido no `package.json`), você pode instalar globalmente via npm na pasta do projeto:

```bash
npm install -g .
```

Ou rodar localmente de forma direta:

```bash
node token_cost_calc.mjs --help
```

## Configuração

O script busca credenciais e modelos baseados no contexto configurado do Claude Code. Por padrão, ele verifica as configurações em `~/.claude/`.

Você pode passar as configurações de API e credencial de duas maneiras principais:

1. **Variáveis de Ambiente:**
   - `ANTHROPIC_API_KEY`: Chave de API da Anthropic (`x-api-key`).
   - `ANTHROPIC_AUTH_TOKEN`: Autenticação alternativa caso use token do tipo Bearer.
   - `ANTHROPIC_BASE_URL`: (Opcional) Modifica a URL de base da API (útil para uso através de Proxies). O padrão é `https://api.anthropic.com`.

2. **Arquivo de Configurações (`settings.json` ou `settings.local.json`):**
   - Configurado dentro do diretório de contexto (ex: `~/.claude/`) com as mesmas informações encapsuladas na propriedade `env` do JSON.

## Uso

A sintaxe básica para utilização da ferramenta via terminal é:

```bash
node token_cost_calc.mjs (ARQUIVO|TEXTO) [--system F|TEXTO] \
    [--output 700] [--var-input 100] [--requests 5] [--ttl 5m|1h] \
    [--context NOME_DO_CONTEXTO] [--offline]
```

### Exemplos de Uso

1. **Testando um arquivo de texto local (prompt):**
   ```bash
   node token_cost_calc.mjs meu_prompt.txt
   ```

2. **Avaliando um texto passado via terminal (inline):**
   ```bash
   node token_cost_calc.mjs "Descreva a revolução industrial em três parágrafos."
   ```

3. **Definindo um contexto customizado e especificando simulação de acessos ao cache:**
   ```bash
   node token_cost_calc.mjs system_prompt.txt --context claude-rgk --requests 10 --output 1000
   ```

4. **Modo Offline (Estimativa baseada em contagem de caracteres sem fazer chamadas para a API):**
   ```bash
   node token_cost_calc.mjs grande_arquivo_de_dados.txt --offline
   ```

### Opções Disponíveis

- `--text`: Especifica explicitamente o texto de input. Alternativo ao primeiro argumento posicional.
- `--system`: Define o caminho de um arquivo ou texto de instrução de sistema (*system prompt*).
- `--output`: Define a quantidade estimada de tokens de saída esperados por cada requisição na simulação (Padrão: `700`).
- `--var-input`: Tokens de input extras variáveis por requisição (não abrangidos pelo prefixo contável) (Padrão: `100`).
- `--requests`: Quantidade de requisições subsequentes que acessarão o mesmo prefixo armazenado em cache (Padrão: `5`).
- `--ttl`: Tempo de vida do *prompt caching*, podendo ser `5m` ou `1h` (Padrão: `5m`).
- `--context`: Altera a pasta de onde as configurações serão lidas. Por exemplo, passar `--context meu_bot` fará o script procurar credenciais em `~/.meu_bot/` (Padrão: `claude`).
- `--offline`: Ativa a estimativa heurística local de contagem em vez de consultar a API da Anthropic. Ideal para testar a ferramenta quando sem internet ou sem as chaves cadastradas.

## Licença

Distribuído sob a licença [MIT](./package.json).
