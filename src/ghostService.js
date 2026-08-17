'use strict';

const GhostAdminAPI = require('@tryghost/admin-api');

/**
 * Publica o relatório da rodada como post no Ghost.
 * Responsabilidade única: publicar. Nunca decide SE deve publicar
 * (isso é decidido antes, no orquestrador do cron) nem formata conteúdo
 * (isso já vem pronto do relatorioBuilder).
 *
 * Requer as env vars: GHOST_API_URL, GHOST_ADMIN_API_KEY
 */
function criarClienteGhost() {
  const url = process.env.GHOST_API_URL;
  const key = process.env.GHOST_ADMIN_API_KEY;

  if (!url || !key) {
    throw new Error('GHOST_API_URL e/ou GHOST_ADMIN_API_KEY ausentes nas variáveis de ambiente.');
  }

  return new GhostAdminAPI({ url, key, version: 'v5.0' });
}

/**
 * Converte markdown simples (o que o relatorioBuilder gera) em HTML básico.
 * Mantido deliberadamente simples — não é um parser de markdown completo,
 * só cobre os padrões que o relatorioBuilder efetivamente produz
 * (##, ###, **negrito**, > citação, --- como separador, quebras de parágrafo).
 */
function markdownParaHtmlBasico(markdown) {
  return markdown
    .split('\n\n')
    .map((bloco) => {
      const linha = bloco.trim();
      if (linha.startsWith('## ')) return `<h2>${linha.slice(3)}</h2>`;
      if (linha.startsWith('### ')) return `<h3>${linha.slice(4)}</h3>`;
      if (linha === '---') return '<hr>';
      if (linha.startsWith('> ')) return `<blockquote>${linha.slice(2)}</blockquote>`;
      const comNegrito = linha.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      return `<p>${comNegrito.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');
}

/**
 * publicarRelatorioNoGhost({ titulo, markdown })
 * @returns {Promise<{ id: string, url: string }>}
 */
async function publicarRelatorioNoGhost({ titulo, markdown }, opcoes = {}) {
  const api = criarClienteGhost();
  const html = markdownParaHtmlBasico(markdown);

  const post = await api.posts.add(
    {
      title: titulo,
      html,
      status: opcoes.status || process.env.GHOST_POST_STATUS || 'draft', // draft por padrão — publish é decisão explícita
      tags: opcoes.tags || ['relatorio-rodada'],
    },
    { source: 'html' }
  );

  return { id: post.id, url: post.url };
}

/** Escapa texto simples pra dentro de HTML — evita quebrar o card com aspas/tags vindas do LLM. */
function escaparHtml(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const COR_POR_CLASSIFICACAO = {
  'Alto Valor': '#10b981',
  'Bom Valor': '#22c55e',
  'Valor Moderado': '#f59e0b',
  'Valor Marginal': '#f97316',
  'Sem Valor': '#ef4444',
};

function corParaClassificacao(classificacao) {
  return COR_POR_CLASSIFICACAO[classificacao] || '#6b7280';
}

/** Monta o card HTML de um mercado avaliado (um item de analise_completa). */
function montarCardMercado(item) {
  const cor = corParaClassificacao(item.classificacao_valor);
  const ev =
    item.expected_value != null
      ? `<span style="font-size:12px;font-weight:600;color:${Number(item.expected_value) >= 0 ? '#10b981' : '#ef4444'}">EV ${Number(item.expected_value) >= 0 ? '+' : ''}${item.expected_value}</span>`
      : '';
  const robustez =
    item.robustez_score != null
      ? `<span style="font-size:12px;color:#6b7280;margin-left:8px;">Robustez ${item.robustez_score}/100</span>`
      : '';

  return `
<div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin:10px 0;">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
    <strong>${escaparHtml(item.mercado)}</strong>
    <span style="font-size:11px;font-weight:700;color:#fff;background:${cor};padding:3px 8px;border-radius:999px;">${escaparHtml(item.classificacao_valor || '—')}</span>
  </div>
  <div style="font-size:18px;font-weight:800;margin-top:4px;">${escaparHtml(item.aposta_sugerida || '—')}</div>
  <div style="margin-top:4px;">${ev}${robustez}</div>
  <p style="font-size:13px;color:#6b7280;margin-top:8px;">${escaparHtml(item.motivo_estatistico || '')}</p>
</div>`.trim();
}

/**
 * publicarPalpiteNoGhost(resultado)
 *
 * Publica o resultado de UM jogo (saída de gerarPalpitePartida, palpiteOrchestrator.js)
 * como post no Ghost — card por mercado avaliado, ordenado do maior EV pro menor.
 *
 * @param {Object} resultado - objeto com sucesso:true de gerarPalpitePartida
 * @returns {Promise<{ id: string, url: string }>}
 */
async function publicarPalpiteNoGhost(resultado, opcoes = {}) {
  if (!resultado?.sucesso) {
    throw new Error('publicarPalpiteNoGhost só aceita um resultado com sucesso:true.');
  }

  const api = criarClienteGhost();
  const { casa, visitante, liga, esporte, resumo_tecnico: resumoTecnico, analise_completa: analiseCompleta = [] } = resultado;

  const ordenada = [...analiseCompleta].sort(
    (a, b) => (b.expected_value ?? -Infinity) - (a.expected_value ?? -Infinity)
  );

  const titulo = `${casa} x ${visitante}${liga ? ` — ${liga}` : ''}`;
  const html = `
<p style="font-style:italic;color:#4b5563;">${escaparHtml(resumoTecnico || '')}</p>
${ordenada.length === 0 ? '<p>Nenhum mercado avaliado.</p>' : ordenada.map(montarCardMercado).join('\n')}
<p style="font-size:11px;color:#9ca3af;margin-top:16px;">Análise estatística gerada por IA — não é garantia de resultado.</p>
`.trim();

  const post = await api.posts.add(
    {
      title: titulo,
      html,
      status: opcoes.status || process.env.GHOST_POST_STATUS || 'draft',
      tags: opcoes.tags || [esporte, 'palpite'].filter(Boolean),
    },
    { source: 'html' }
  );

  return { id: post.id, url: post.url };
}

module.exports = { publicarRelatorioNoGhost, publicarPalpiteNoGhost };
