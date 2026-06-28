document.addEventListener('DOMContentLoaded', () => {
    // ==================== TOP NAVIGATION ====================
    const navBtns = document.querySelectorAll('.nav-btn');
    const pages = document.querySelectorAll('.page');

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            navBtns.forEach(b => b.classList.remove('active'));
            pages.forEach(p => p.classList.remove('active'));

            btn.classList.add('active');
            const targetPage = btn.getAttribute('data-page');
            document.getElementById(targetPage).classList.add('active');

            // Load projects when switching to sessions tab for the first time
            if (targetPage === 'page-sessions' && !projectsLoaded) {
                loadProjects();
            }
        });
    });

    // ==================== CALCULATOR PAGE ====================
    const tabs = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    let currentInputMode = 'text';

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            
            tab.classList.add('active');
            const targetId = tab.getAttribute('data-tab');
            document.getElementById(targetId).classList.add('active');
            
            currentInputMode = targetId === 'tab-text' ? 'text' : 'file';
        });
    });

    // Advanced Settings Toggle
    const toggleBtn = document.getElementById('toggleAdvanced');
    const advancedSettings = document.getElementById('advancedSettings');
    
    toggleBtn.addEventListener('click', () => {
        toggleBtn.classList.toggle('open');
        advancedSettings.classList.toggle('hidden');
    });

    // File Search Autocomplete
    const fileSearch = document.getElementById('fileSearch');
    const fileDropdown = document.getElementById('fileDropdown');
    const selectedFileInfo = document.getElementById('selectedFileInfo');
    const selectedFileName = document.getElementById('selectedFileName');
    const clearFileBtn = document.getElementById('clearFileBtn');
    
    let allFiles = [];
    let selectedFilePath = null;

    fetch('/api/files')
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                allFiles = data.files.filter(f => !f.isDirectory);
            }
        })
        .catch(console.error);

    fileSearch.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        fileDropdown.innerHTML = '';
        
        if (!query) {
            fileDropdown.classList.remove('show');
            return;
        }

        const matches = allFiles.filter(f => f.name.toLowerCase().includes(query));
        
        if (matches.length > 0) {
            matches.forEach(file => {
                const li = document.createElement('li');
                li.className = 'autocomplete-item';
                li.innerHTML = `📄 <span>${file.name}</span>`;
                li.addEventListener('click', () => selectFile(file));
                fileDropdown.appendChild(li);
            });
            fileDropdown.classList.add('show');
        } else {
            fileDropdown.classList.remove('show');
        }
    });

    document.addEventListener('click', (e) => {
        if (!fileSearch.contains(e.target) && !fileDropdown.contains(e.target)) {
            fileDropdown.classList.remove('show');
        }
    });

    function selectFile(file) {
        selectedFilePath = file.path;
        selectedFileName.textContent = file.name;
        selectedFileInfo.classList.remove('hidden');
        fileSearch.value = '';
        fileDropdown.classList.remove('show');
        fileSearch.parentElement.classList.add('hidden');
    }

    clearFileBtn.addEventListener('click', () => {
        selectedFilePath = null;
        selectedFileInfo.classList.add('hidden');
        fileSearch.parentElement.classList.remove('hidden');
        fileSearch.value = '';
        fileSearch.focus();
    });

    // Form Submission
    const calculateBtn = document.getElementById('calculateBtn');
    const btnText = calculateBtn.querySelector('.btn-text');
    const spinner = calculateBtn.querySelector('.spinner');
    const resultsPanel = document.getElementById('resultsPanel');
    const resultsBody = document.getElementById('resultsBody');
    const metaInfo = document.getElementById('metaInfo');
    const resultsFooter = document.getElementById('resultsFooter');
    const errorToast = document.getElementById('errorMessage');

    function showError(msg) {
        errorToast.textContent = msg;
        errorToast.classList.remove('hidden');
        setTimeout(() => errorToast.classList.add('hidden'), 5000);
    }

    function showSuccess(msg) {
        // Create a temporary success toast
        const toast = document.createElement('div');
        toast.className = 'success-toast';
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    calculateBtn.addEventListener('click', async () => {
        let rawInput = '';

        if (currentInputMode === 'text') {
            rawInput = document.getElementById('promptText').value.trim();
            if (!rawInput) {
                showError('Por favor, insira um texto/prompt.');
                return;
            }
        } else {
            if (!selectedFilePath && !fileSearch.value.trim()) {
                showError('Por favor, selecione um arquivo ou digite um caminho.');
                return;
            }
            rawInput = selectedFilePath || fileSearch.value.trim();
        }

        const payload = {
            rawInput,
            systemStr: document.getElementById('systemPrompt').value.trim(),
            out: document.getElementById('outTokens').value,
            varIn: document.getElementById('varInTokens').value,
            n: document.getElementById('numRequests').value,
            ttl: document.getElementById('ttlCache').value,
            context: document.getElementById('contextName').value.trim() || undefined,
            offline: document.getElementById('offlineMode').checked
        };

        calculateBtn.disabled = true;
        btnText.textContent = 'Calculando...';
        spinner.classList.remove('hidden');
        resultsPanel.classList.add('hidden');

        try {
            const res = await fetch('/api/calculate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (!data.success) {
                throw new Error(data.error || 'Erro desconhecido');
            }

            renderResults(data.data);
            
        } catch (err) {
            showError(`Erro: ${err.message}`);
        } finally {
            calculateBtn.disabled = false;
            btnText.textContent = 'Calcular Custos';
            spinner.classList.add('hidden');
        }
    });

    function renderResults(data) {
        metaInfo.innerHTML = `
            <div><strong>Modo:</strong> ${data.mode}</div>
            <div><strong>Contexto:</strong> ${data.context}</div>
            <div><strong>Input:</strong> ${data.promptSrc}</div>
            <div><strong>Params:</strong> ${data.requests} reqs, ${data.output} out/req</div>
        `;

        resultsBody.innerHTML = '';
        
        data.results.forEach(r => {
            const tr = document.createElement('tr');
            
            if (r.error || !r.family) {
                tr.innerHTML = `
                    <td>${r.name}</td>
                    <td colspan="5" class="td-error">
                        <span class="badge badge-error">${r.error || 'Família Desconhecida'}</span>
                    </td>
                `;
            } else {
                const cacheBadgeClass = r.cacheable ? 'badge-success' : 'badge-warning';
                const cacheText = r.cacheable ? 'SIM' : 'NÃO';
                
                tr.innerHTML = `
                    <td><strong>${r.name}</strong></td>
                    <td class="td-number">${r.prefix.toLocaleString('pt-BR')}</td>
                    <td class="td-number">$${r.noCache.toFixed(3)}</td>
                    <td class="td-number" style="color: var(--success); font-weight: 600;">$${r.cached.toFixed(3)}</td>
                    <td class="td-number">${r.save.toFixed(0)}%</td>
                    <td><span class="badge ${cacheBadgeClass}">${cacheText}</span></td>
                `;
            }
            resultsBody.appendChild(tr);
        });

        const fonte = data.mode === 'OFFLINE' 
            ? "estimado (~3.5 char/token, GROSSEIRO — desative o modo offline para valor exato)"
            : "contado por count_tokens (exato, por-modelo)";
        
        resultsFooter.innerHTML = `<strong>Nota:</strong> 'tokens' = prefixo fixo ${fonte}. <br> Família fable conta mais (~30%) pelo tokenizer novo.`;

        resultsPanel.classList.remove('hidden');
        
        setTimeout(() => {
            resultsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }

    // ==================== SESSIONS PAGE ====================
    let projectsLoaded = false;
    let currentAnalysis = null;
    let currentProjectName = '';
    let showAllTurns = false;

    const sessionProject = document.getElementById('sessionProject');
    const sessionSelect = document.getElementById('sessionSelect');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const analyzeBtnText = analyzeBtn.querySelector('.btn-text');
    const analyzeBtnSpinner = analyzeBtn.querySelector('.spinner');
    const sessionResultsPanel = document.getElementById('sessionResultsPanel');

    async function loadProjects() {
        try {
            const configDir = document.getElementById('claudeConfigDir')?.value || '';
            const url = `/api/sessions/projects${configDir ? '?claudeDir=' + encodeURIComponent(configDir) : ''}`;
            const res = await fetch(url);
            const data = await res.json();

            if (!data.success) throw new Error(data.error);

            sessionProject.innerHTML = '<option value="">Selecione um projeto...</option>';
            
            if (data.projects.length === 0) {
                sessionProject.innerHTML = '<option value="">Nenhum projeto encontrado</option>';
                return;
            }

            data.projects.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = `${p.name} (${p.sessionCount} sessões)`;
                sessionProject.appendChild(opt);
            });

            projectsLoaded = true;
        } catch (err) {
            showError(`Erro ao carregar projetos: ${err.message}`);
            sessionProject.innerHTML = '<option value="">Erro ao carregar</option>';
        }
    }

    document.getElementById('reloadProjectsBtn')?.addEventListener('click', () => {
        sessionSelect.innerHTML = '<option value="">Selecione um projeto primeiro</option>';
        sessionSelect.disabled = true;
        analyzeBtn.disabled = true;
        sessionResultsPanel.classList.add('hidden');
        loadProjects();
    });

    document.getElementById('claudeConfigDir')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('reloadProjectsBtn')?.click();
        }
    });

    sessionProject.addEventListener('change', async () => {
        const projectId = sessionProject.value;
        sessionSelect.innerHTML = '<option value="">Carregando sessões...</option>';
        sessionSelect.disabled = true;
        analyzeBtn.disabled = true;
        sessionResultsPanel.classList.add('hidden');

        if (!projectId) {
            sessionSelect.innerHTML = '<option value="">Selecione um projeto primeiro</option>';
            return;
        }

        currentProjectName = sessionProject.options[sessionProject.selectedIndex].textContent;

        try {
            const configDir = document.getElementById('claudeConfigDir')?.value || '';
            const url = `/api/sessions/list?project=${encodeURIComponent(projectId)}${configDir ? '&claudeDir=' + encodeURIComponent(configDir) : ''}`;
            const res = await fetch(url);
            const data = await res.json();

            if (!data.success) throw new Error(data.error);

            sessionSelect.innerHTML = '<option value="">Selecione uma sessão...</option>';
            
            data.sessions.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.sessionId;
                const date = s.lastTimestamp 
                    ? new Date(s.lastTimestamp).toLocaleDateString('pt-BR') + ' ' + new Date(s.lastTimestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                    : '';
                const sizeKb = (s.fileSize / 1024).toFixed(0);
                opt.textContent = `${s.title} — ${s.model} — ${date} (${sizeKb}KB)`;
                sessionSelect.appendChild(opt);
            });

            sessionSelect.disabled = false;
        } catch (err) {
            showError(`Erro ao carregar sessões: ${err.message}`);
            sessionSelect.innerHTML = '<option value="">Erro ao carregar</option>';
        }
    });

    sessionSelect.addEventListener('change', () => {
        analyzeBtn.disabled = !sessionSelect.value;
    });

    analyzeBtn.addEventListener('click', async () => {
        const projectId = sessionProject.value;
        const sessionId = sessionSelect.value;

        if (!projectId || !sessionId) return;

        analyzeBtn.disabled = true;
        analyzeBtnText.textContent = 'Analisando...';
        analyzeBtnSpinner.classList.remove('hidden');
        sessionResultsPanel.classList.add('hidden');

        try {
            const configDir = document.getElementById('claudeConfigDir')?.value || '';
            const res = await fetch('/api/sessions/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    project: projectId, 
                    sessionId,
                    claudeDir: configDir || undefined
                })
            });

            const data = await res.json();

            if (!data.success) throw new Error(data.error);

            currentAnalysis = data.data;
            showAllTurns = false;
            renderSessionResults(data.data);

        } catch (err) {
            showError(`Erro na análise: ${err.message}`);
        } finally {
            analyzeBtn.disabled = false;
            analyzeBtnText.textContent = 'Analisar Sessão';
            analyzeBtnSpinner.classList.add('hidden');
        }
    });

    function renderSessionResults(data) {
        const s = data.summary;

        // Metrics Cards
        const metricsGrid = document.getElementById('metricsGrid');
        const primaryModel = data.modelBreakdown.length > 0
            ? data.modelBreakdown.sort((a, b) => b.cost - a.cost)[0].model
            : 'N/A';

        metricsGrid.innerHTML = `
            <div class="metric-card mc-cost">
                <span class="metric-label">Custo Total</span>
                <span class="metric-value">$${s.totalCost.toFixed(4)}</span>
                <span class="metric-sub">Média: $${s.avgCostPerTurn.toFixed(4)}/rodada</span>
            </div>
            <div class="metric-card mc-tokens">
                <span class="metric-label">Tokens Total</span>
                <span class="metric-value">${(s.totalInputTokens + s.totalOutputTokens + s.totalCacheWriteTokens + s.totalCacheReadTokens).toLocaleString('pt-BR')}</span>
                <span class="metric-sub">In: ${s.totalInputTokens.toLocaleString('pt-BR')} | Out: ${s.totalOutputTokens.toLocaleString('pt-BR')}</span>
            </div>
            <div class="metric-card mc-cache">
                <span class="metric-label">Cache Hit Rate</span>
                <span class="metric-value">${s.cacheHitRate.toFixed(1)}%</span>
                <span class="metric-sub">Write: ${s.totalCacheWriteTokens.toLocaleString('pt-BR')} | Read: ${s.totalCacheReadTokens.toLocaleString('pt-BR')}</span>
            </div>
            <div class="metric-card mc-turns">
                <span class="metric-label">Rodadas</span>
                <span class="metric-value">${s.totalTurns}</span>
                <span class="metric-sub">Sessão: ${data.title}</span>
            </div>
            <div class="metric-card mc-agent">
                <span class="metric-label">Agente Principal</span>
                <span class="metric-value">${s.mainAgentCalls}</span>
                <span class="metric-sub">Subagentes: ${s.subagentCalls} ($${s.subagentCost.toFixed(4)})</span>
            </div>
            <div class="metric-card mc-model">
                <span class="metric-label">Modelo Principal</span>
                <span class="metric-value" style="font-size: 1rem; word-break: break-all;">${primaryModel}</span>
                <span class="metric-sub">${data.modelBreakdown.length} modelo(s) usado(s)</span>
            </div>
        `;

        // Model Breakdown Table
        const modelBody = document.getElementById('modelBreakdownBody');
        modelBody.innerHTML = '';
        
        data.modelBreakdown.forEach(mb => {
            const tr = document.createElement('tr');
            const familyBadge = mb.family 
                ? `<span class="badge badge-info">${mb.family}</span>` 
                : '<span class="badge badge-muted">?</span>';
            tr.innerHTML = `
                <td><strong>${mb.model}</strong></td>
                <td>${familyBadge}</td>
                <td class="td-number">${mb.calls}</td>
                <td class="td-number">${mb.inputTokens.toLocaleString('pt-BR')}</td>
                <td class="td-number">${mb.outputTokens.toLocaleString('pt-BR')}</td>
                <td class="td-number">${mb.cacheWriteTokens.toLocaleString('pt-BR')}</td>
                <td class="td-number">${mb.cacheReadTokens.toLocaleString('pt-BR')}</td>
                <td class="td-number" style="color: var(--accent-primary); font-weight: 600;">$${mb.cost.toFixed(4)}</td>
                <td class="td-number">${mb.percentOfTotal.toFixed(1)}%</td>
            `;
            modelBody.appendChild(tr);
        });

        // Turns Table
        renderTurns(data);

        // Reset report
        document.getElementById('reportPreview').classList.add('hidden');
        document.getElementById('reportPreview').textContent = '';
        document.getElementById('copyReportBtn').classList.add('hidden');

        sessionResultsPanel.classList.remove('hidden');
        
        setTimeout(() => {
            metricsGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }

    function renderTurns(data) {
        const turnsBody = document.getElementById('turnsBody');
        turnsBody.innerHTML = '';

        const avgCost = data.summary.avgCostPerTurn;
        const turnsToShow = showAllTurns ? data.turns : data.topTurns;
        const toggleBtn = document.getElementById('toggleAllTurns');
        toggleBtn.textContent = showAllTurns ? `Top ${data.topTurns.length} mais caras` : 'Mostrar todas';

        turnsToShow.forEach(t => {
            const tr = document.createElement('tr');
            const isExpensive = t.totalCost > avgCost * 2;
            if (isExpensive) tr.classList.add('turn-expensive');
            if (t.hasSidechain) tr.classList.add('turn-sidechain');

            const costColor = isExpensive ? 'var(--danger)' : 'var(--accent-primary)';
            
            tr.innerHTML = `
                <td class="td-number">${t.turnIndex}</td>
                <td class="td-prompt" style="cursor: pointer;">
                    <span class="expand-icon">▶</span> ${escapeHtml(t.prompt.slice(0, 80))}${t.prompt.length > 80 ? '…' : ''}
                </td>
                <td><span class="badge badge-info">${t.models.join(', ')}</span></td>
                <td class="td-number">${t.totalInputTokens.toLocaleString('pt-BR')}</td>
                <td class="td-number">${t.totalOutputTokens.toLocaleString('pt-BR')}</td>
                <td class="td-number">${t.totalCacheWriteTokens.toLocaleString('pt-BR')}</td>
                <td class="td-number">${t.totalCacheReadTokens.toLocaleString('pt-BR')}</td>
                <td class="td-number" style="color: ${costColor}; font-weight: 600;">$${t.totalCost.toFixed(4)}</td>
                <td>${t.hasSidechain ? '<span class="badge badge-warning">Sim</span>' : '<span class="badge badge-muted">Não</span>'}</td>
            `;

            const detailTr = document.createElement('tr');
            detailTr.className = 'turn-detail-row hidden';
            detailTr.id = `turn-detail-${t.turnIndex}`;

            const accentBorderColor = isExpensive ? 'var(--danger)' : 'var(--accent-primary)';
            let detailsHtml = `
                <td colspan="9" class="turn-detail-cell">
                    <div class="turn-detail-container" style="border-left: 4px solid ${accentBorderColor}">
                        <div class="turn-detail-section">
                            <strong>Prompt Completo:</strong>
                            <pre class="prompt-full">${escapeHtml(t.prompt)}</pre>
                        </div>
            `;

            // Startup Attachments
            if (t.startupAttachments && t.startupAttachments.length > 0) {
                detailsHtml += `
                    <div class="turn-detail-section">
                        <div class="timeline-title">Inicialização / Entrada de Contexto</div>
                        <div class="steps-timeline">
                            <div class="step-container" style="border-left: 4px solid var(--text-muted)">
                                <div class="step-header">
                                    <span class="step-title">Hooks de Inicialização / Contexto Prévio</span>
                                </div>
                                <div class="step-content-section">
                                    <span class="step-content-section-title">Atividades / Arquivos Carregados</span>
                                    <div class="attachments-list" style="display:flex; flex-direction:column; gap:0.5rem;">
                                        ${t.startupAttachments.map(att => {
                                            const sizeFormatted = att.size >= 1024 
                                                ? `${(att.size / 1024).toFixed(1)} KB` 
                                                : `${att.size} caracteres`;
                                            const isBig = att.size > 15 * 1024;
                                            const warningBadge = isBig ? `<span class="badge badge-error" style="font-size:0.7rem; margin-left:8px;">DRENO DE CONTEXTO (>15KB)</span>` : '';
                                            return `
                                                <div class="step-attachment-item ${isBig ? 'warning-item' : ''}">
                                                    <div class="step-attachment-header">
                                                        <span>
                                                            <span class="badge badge-muted" style="font-size:0.7rem; margin-right:4px;">${escapeHtml(att.type)}</span>
                                                            <strong>${escapeHtml(att.name)}</strong>
                                                            ${warningBadge}
                                                        </span>
                                                        <span class="attachment-size">${sizeFormatted}</span>
                                                    </div>
                                                    ${att.preview ? `<pre class="step-attachment-output-pre">${escapeHtml(att.preview)}</pre>` : ''}
                                                </div>
                                            `;
                                        }).join('')}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }

            // Steps Timeline (Chronological steps)
            if (t.steps && t.steps.length > 0) {
                detailsHtml += `
                    <div class="turn-detail-section">
                        <div class="timeline-title">Linha do Tempo de Execução (${t.steps.length} passos)</div>
                        <div class="steps-timeline">
                            ${t.steps.map(step => {
                                const stepCostColor = step.cost > (avgCost / 2) ? 'var(--danger)' : 'var(--accent-primary)';
                                const stepBorderColor = step.isSidechain ? 'var(--warning)' : (step.cost > (avgCost / 2) ? 'var(--danger)' : 'var(--accent-primary)');
                                const roleLabel = step.isSidechain ? 'Subagente' : 'Agente Principal';
                                const roleBadgeClass = step.isSidechain ? 'badge-warning' : 'badge-success';
                                
                                let stepHtml = `
                                    <div class="step-container" style="border-left: 4px solid ${stepBorderColor}">
                                        <div class="step-header">
                                            <span class="step-title">
                                                <span>Passo ${step.stepIndex} — IA (${escapeHtml(step.model)})</span>
                                                <span class="badge ${roleBadgeClass}">${roleLabel}</span>
                                            </span>
                                            <div class="step-meta">
                                                <span>In: ${step.usage ? step.usage.inputTokens.toLocaleString('pt-BR') : 0}</span> |
                                                <span>Out: ${step.usage ? step.usage.outputTokens.toLocaleString('pt-BR') : 0}</span> |
                                                <span>Cache W: ${step.usage ? step.usage.cacheWriteTokens.toLocaleString('pt-BR') : 0}</span> |
                                                <span>Cache R: ${step.usage ? step.usage.cacheReadTokens.toLocaleString('pt-BR') : 0}</span> |
                                                <span class="step-cost" style="color: ${stepCostColor}">$${step.cost.toFixed(4)}</span>
                                            </div>
                                        </div>
                                `;

                                // IA thinking
                                if (step.thinking) {
                                    stepHtml += `
                                        <div class="step-content-section">
                                            <details class="step-details">
                                                <summary>Raciocínio da IA (Thinking Process)</summary>
                                                <pre class="step-thinking-text">${escapeHtml(step.thinking)}</pre>
                                            </details>
                                        </div>
                                    `;
                                }

                                // Tool calls
                                if (step.toolCalls && step.toolCalls.length > 0) {
                                    stepHtml += `
                                        <div class="step-content-section">
                                            <span class="step-content-section-title">Ferramenta(s) Chamada(s)</span>
                                            <div style="display:flex; flex-direction:column; gap:0.5rem;">
                                                ${step.toolCalls.map(tc => {
                                                    let argsStr = '';
                                                    try {
                                                        argsStr = JSON.stringify(tc.input, null, 2);
                                                    } catch {
                                                        argsStr = '[Erro ao serializar argumentos]';
                                                    }
                                                    return `
                                                        <div class="step-tool-use">
                                                            <div class="step-tool-header">
                                                                <span class="badge badge-info" style="font-size:0.7rem;">tool: ${escapeHtml(tc.name)}</span>
                                                            </div>
                                                            <pre class="step-tool-input-pre">${escapeHtml(argsStr)}</pre>
                                                        </div>
                                                    `;
                                                }).join('')}
                                            </div>
                                        </div>
                                    `;
                                }

                                // Attachments (outputs)
                                if (step.attachments && step.attachments.length > 0) {
                                    stepHtml += `
                                        <div class="step-content-section">
                                            <span class="step-content-section-title">Retorno da Ferramenta / Arquivos Lidos</span>
                                            <div style="display:flex; flex-direction:column; gap:0.5rem;">
                                                ${step.attachments.map(att => {
                                                    const sizeFormatted = att.size >= 1024 
                                                        ? `${(att.size / 1024).toFixed(1)} KB` 
                                                        : `${att.size} caracteres`;
                                                    const isBig = att.size > 15 * 1024;
                                                    const warningBadge = isBig 
                                                        ? `<span class="badge badge-error" style="font-size:0.7rem; margin-left:8px;">DRENO DE CONTEXTO (>15KB)</span>` 
                                                        : '';
                                                    return `
                                                        <div class="step-attachment-item ${isBig ? 'warning-item' : ''}">
                                                            <div class="step-attachment-header">
                                                                <span>
                                                                    <span class="badge badge-muted" style="font-size:0.7rem; margin-right:4px;">${escapeHtml(att.type)}</span>
                                                                    <strong>${escapeHtml(att.name)}</strong>
                                                                    ${warningBadge}
                                                                </span>
                                                                <span class="attachment-size">${sizeFormatted}</span>
                                                            </div>
                                                            ${att.preview ? `<pre class="step-attachment-output-pre">${escapeHtml(att.preview)}</pre>` : ''}
                                                        </div>
                                                    `;
                                                }).join('')}
                                            </div>
                                        </div>
                                    `;
                                }

                                stepHtml += `</div>`;
                                return stepHtml;
                            }).join('')}
                        </div>
                    </div>
                `;
            }

            detailsHtml += `
                    </div>
                </td>
            `;
            detailTr.innerHTML = detailsHtml;

            tr.style.cursor = 'pointer';
            tr.addEventListener('click', (e) => {
                if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON' || e.target.classList.contains('badge') || e.target.tagName === 'SUMMARY' || e.target.tagName === 'PRE') {
                    return;
                }
                const isHidden = detailTr.classList.contains('hidden');
                if (isHidden) {
                    detailTr.classList.remove('hidden');
                    tr.querySelector('.expand-icon').textContent = '▼';
                    tr.classList.add('turn-expanded');
                } else {
                    detailTr.classList.add('hidden');
                    tr.querySelector('.expand-icon').textContent = '▶';
                    tr.classList.remove('turn-expanded');
                }
            });

            turnsBody.appendChild(tr);
            turnsBody.appendChild(detailTr);
        });
    }

    document.getElementById('toggleAllTurns').addEventListener('click', () => {
        if (!currentAnalysis) return;
        showAllTurns = !showAllTurns;
        renderTurns(currentAnalysis);
    });

    // Report Generation
    document.getElementById('generateReportBtn').addEventListener('click', async () => {
        if (!currentAnalysis) return;

        const projectId = sessionProject.value;
        const sessionId = sessionSelect.value;
        const btn = document.getElementById('generateReportBtn');

        btn.disabled = true;
        btn.textContent = 'Gerando...';

        try {
            const configDir = document.getElementById('claudeConfigDir')?.value || '';
            const res = await fetch('/api/sessions/report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    project: projectId, 
                    sessionId,
                    projectName: currentProjectName,
                    claudeDir: configDir || undefined
                })
            });

            const data = await res.json();

            if (!data.success) throw new Error(data.error);

            const preview = document.getElementById('reportPreview');
            preview.textContent = data.report;
            preview.classList.remove('hidden');
            
            document.getElementById('copyReportBtn').classList.remove('hidden');

        } catch (err) {
            showError(`Erro ao gerar relatório: ${err.message}`);
        } finally {
            btn.disabled = false;
            btn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                Gerar Relatório
            `;
        }
    });

    document.getElementById('copyReportBtn').addEventListener('click', async () => {
        const preview = document.getElementById('reportPreview');
        const text = preview.textContent;

        try {
            await navigator.clipboard.writeText(text);
            showSuccess('Relatório copiado para a área de transferência!');
        } catch {
            // Fallback
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            showSuccess('Relatório copiado!');
        }
    });

    // Utility
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
});
