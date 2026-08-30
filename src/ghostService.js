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

module.exports = { publicarRelatorioNoGhost };
